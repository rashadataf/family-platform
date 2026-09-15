# Data Model: Calendar (spec 009)

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

Three new tables, all family-scoped, all under `ENABLE` and `FORCE ROW LEVEL SECURITY`
([ADR-017](../../adr/ADR-017-tenant-isolation-at-the-database.md)). One new published port on the
Family context. No new database role, no new external dependency, no change to spec 008's tables.

The one thing to hold in mind while reading: **`calendar_event` is authored and
`event_occurrence` is derived** — with exactly one exception, an occurrence's individual
cancellation, and that exception is why the rebuild is a reconcile rather than a regenerate.

## Branded identifiers

Added to `@fp/kernel`'s `branded-id.ts` alongside the family set, so that passing an event id where
an occurrence id is expected is a compile error (Principle I).

| Identifier | Constructor |
|---|---|
| `CalendarEventId` | `asCalendarEventId` |
| `EventOccurrenceId` | `asEventOccurrenceId` |

`FamilyId` and `FamilyMemberId` are imported, never redefined. Calendar holds `FamilyMemberId`
values and nothing else about the people they name — no display name, no kind, no date of birth.

## Aggregates and their tables

### `CalendarEvent` — aggregate root

The record of truth. Every occurrence is derived from it.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `CalendarEventId` |
| `family_id` | `uuid` NOT NULL | The tenant key. RLS predicate; FK to `family` |
| `title` | `text` NOT NULL | Personal data. Free text, never parsed, never logged |
| `description` | `text` NULL | Personal data. Same treatment |
| `kind` | `event_kind` NOT NULL | `'timed' \| 'all_day'` — the discriminant |
| `starts_at` | `timestamptz` NULL | Set for `timed`, null for `all_day` |
| `ends_at` | `timestamptz` NULL | Set for `timed`, null for `all_day` |
| `start_date` | `date` NULL | Set for `all_day`, null for `timed` |
| `end_date` | `date` NULL | Set for `all_day`, null for `timed` |
| `time_zone` | `text` NOT NULL | IANA identifier. Validated against the runtime's zone set |
| `location` | `text` NULL | Personal data — where a member will physically be |
| `category` | `event_category` NULL | Platform-defined enum, not family-authored text |
| `recurrence_rule` | `text` NULL | The serialised RRULE. Null for a one-off |
| `status` | `event_status` NOT NULL | `'confirmed' \| 'cancelled'`, default `'confirmed'` |
| `materialised_through` | `timestamptz` NULL | How far this event's occurrences reach. Null for a one-off |
| `created_by_member_id` | `uuid` NULL | Tombstoned on member erasure, never dangling |
| `created_at` / `updated_at` | `timestamptz` NOT NULL | UTC with time zone, per the constitution |

**The discriminated union is enforced in the database as well as the domain**, because a nullable
time plus a boolean is the modelling Principle I names specifically:

```sql
CONSTRAINT event_shape CHECK (
  (kind = 'timed'   AND starts_at IS NOT NULL AND ends_at IS NOT NULL
                    AND start_date IS NULL AND end_date IS NULL)
  OR
  (kind = 'all_day' AND start_date IS NOT NULL AND end_date IS NOT NULL
                    AND starts_at IS NULL AND ends_at IS NULL)
)
CONSTRAINT event_order CHECK (
  (kind = 'timed'   AND ends_at >= starts_at) OR
  (kind = 'all_day' AND end_date >= start_date)
)
```

An all-day event with a start time is unrepresentable rather than validated. FR-002's ordering rule
is a constraint rather than only a domain check, so a raw query cannot violate it either.

**Why `time_zone` is NOT NULL even for all-day events.** The constitution requires that anything a
user sees a date for records the zone it was authored in. An all-day event never passes through
offset arithmetic (FR-004), but a family that moves house still wants to know the birthday was
entered in London, and Reminders will eventually need it to decide what "the morning of" means.

### `EventOccurrence` — derived, with one authored attribute

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `EventOccurrenceId` |
| `family_id` | `uuid` NOT NULL | Denormalised from the event so RLS applies without a join |
| `event_id` | `uuid` NOT NULL | FK, `ON DELETE CASCADE` |
| `starts_at` | `timestamptz` NOT NULL | The resolved instant |
| `ends_at` | `timestamptz` NOT NULL | |
| `cancelled_at` | `timestamptz` NULL | **The one authored field** (FR-022) |

```sql
UNIQUE (event_id, starts_at)
INDEX  (family_id, starts_at, ends_at)   -- the range query
```

**`(event_id, starts_at)` is the identity, and it is why the sweep is idempotent for free.** Re-run
the sweep, expand the same rule, produce the same instants, find the same rows, insert nothing.
FR-025 is a property of the schema rather than a discipline
([research.md §5, §8](research.md)).

**`family_id` is denormalised deliberately.** Without it the RLS policy would need a subquery
against `calendar_event` on every row of a range scan, which is the one query in this feature that
must stay cheap. The cost is a column that must agree with its parent, enforced by a composite FK:

```sql
FOREIGN KEY (event_id, family_id) REFERENCES calendar_event (id, family_id) ON DELETE CASCADE
```

so the two cannot disagree even under a raw write. `calendar_event` carries a
`UNIQUE (id, family_id)` to make that referenceable — redundant against the primary key, and the
price of a denormalisation that cannot drift.

**An all-day event still produces occurrences**, with `starts_at` and `ends_at` resolved to the
day's bounds in the event's zone. Keeping one occurrence shape means the range query is one scan
rather than a union, and the date-versus-instant distinction stays where it belongs — on the event,
which is what a reader is shown.

### `EventParticipant`

| Column | Type | Notes |
|---|---|---|
| `event_id` | `uuid` NOT NULL | FK, `ON DELETE CASCADE` |
| `family_id` | `uuid` NOT NULL | Same denormalisation and same composite FK as above |
| `member_id` | `uuid` NOT NULL | FK to `family_member`. **The only thing Calendar knows about a person** |
| `added_at` | `timestamptz` NOT NULL | |

```sql
PRIMARY KEY (event_id, member_id)
INDEX (member_id)                        -- erasure, and the visibility filter's anti-join
```

**There is no `kind`, `is_child`, `date_of_birth` or `guardian_id` here, and that is the design.**
FR-016 is answered by asking the Family context which members this reader may see
([research.md §1](research.md)), not by caching a classification that would go stale the day a child
is promoted to a linked account. Calendar's participant row is a member id and a timestamp.

**The cross-family rejection of FR-018 is a foreign key, not only a check.** `member_id` references
`family_member`, and the row-level security policy on that table means a member of another family is
not visible to resolve in the first place — the insert fails, and the API maps it to the
non-disclosing error rather than reporting that the member exists elsewhere.

## Row-level security

Identical in shape to spec 008's, which is the point — a context inherits a working mechanism rather
than re-deciding it.

```sql
ALTER TABLE calendar_event    ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_event    FORCE  ROW LEVEL SECURITY;
CREATE POLICY calendar_event_family ON calendar_event
  USING (family_id = current_setting('app.family_id', true)::uuid);
-- and the same for event_occurrence and event_participant
```

Fails closed: absent context yields `NULL`, `family_id = NULL` is `NULL`, which is not `TRUE`, so a
forgotten `withFamilyContext` returns nothing rather than everything. Quickstart Scenario 8 asserts
all three tables including the owner-role case that proves `FORCE` is doing something.

**No Calendar table is outside the policy set.** Spec 008 declared `audit_log` as the one exception;
this feature adds none, which is worth stating because ADR-017 flags a growing exception list as a
pattern needing its own reasoning.

## `MemberVisibilityPort` — the new published port on Family

Placed in `core/family/application/ports/`, because guardianship is Family's to own and publishing
it is Family's decision to make.

```ts
export interface MemberVisibilityPort {
  /**
   * The members of one family whose records `viewerMemberId` may reach:
   * every adult member, plus the children they actively guard.
   */
  resolveVisibleMemberIds(
    viewerMemberId: FamilyMemberId,
    familyId: FamilyId,
  ): Promise<readonly FamilyMemberId[]>;
}
```

| Property | Decision |
|---|---|
| Returns what may be seen, not what may not | Fails closed. An empty result hides everything; a broken "restricted ids" implementation would show everything ([research.md §1](research.md)) |
| Adapter | `packages/persistence/src/repositories/family/member-visibility.ts`, composing the roster with the existing `listActiveChildIdsGuardedBy` inside one `withFamilyContext` |
| Evaluated per read | FR-016 requires guardianship at read time, so nothing here is cached across requests |
| Consumed by | Calendar's range query and single-event read. Nothing else, today |

## The materialisation reconcile

The rule FR-020 and FR-022 produce together, stated once because three code paths depend on it —
create, edit, and the sweep.

Given an event, its current rule, and a window:

1. Expand the rule over the window in local terms, resolving each to an instant (`@fp/kernel/recurrence`).
2. For each produced instant, `INSERT … ON CONFLICT (event_id, starts_at) DO UPDATE` the end
   instant only — **never** touching `cancelled_at`.
3. Delete occurrences in the window at instants the rule no longer produces.
4. Set `materialised_through` to the window's end, in the same transaction.

Step 2's exclusion of `cancelled_at` is the whole of FR-022's persistence. An individual
cancellation survives every rebuild that keeps its instant, and is dropped by a rebuild that moves
it — which happens when the series' time changes, and is the correct outcome for the reason
[research.md §5](research.md) gives.

## Relationships

```text
Family (spec 008, tenant root)
└── CalendarEvent                       family_id, every row
    ├── EventOccurrence      (1..n)     derived; unique on (event_id, starts_at)
    └── EventParticipant     (0..n)     member_id → FamilyMember, and nothing more
                                        │
FamilyMember (spec 008) ────────────────┘
└── GuardianshipRelationship (spec 008) ── read only through MemberVisibilityPort
```

Calendar holds no foreign key into guardianship and no copy of it. The only arrow from Calendar into
Family's data is `member_id`, plus the two published ports.

## Domain events

Four, per ARCHITECTURE §5.3 and [FR-030](spec.md), written as outbox rows in the state change's own
transaction (ADR-005 Layer 2). Versioned, and carrying **identifiers only** — no title, no
description, no location, per Principle VI and VIII.

| Event | When | Payload |
|---|---|---|
| `EventCreated` | An event is created | `familyId`, `eventId`, `kind`, whether recurring |
| `EventUpdated` | Any authored field changes | `familyId`, `eventId`, which field groups changed |
| `EventCancelled` | A series is cancelled, or one occurrence is | `familyId`, `eventId`, optional `occurrenceId` |
| `OccurrenceMaterialised` | A window is materialised | `familyId`, `eventId`, window bounds, count |

`OccurrenceMaterialised` is **per window, not per occurrence** — a horizon extension writes one row
rather than hundreds, for the reasons in [research.md §6](research.md) and recorded in the plan's
Complexity Tracking.

No consumer subscribes to any of them yet. Reminders is the eventual consumer, and FR-030 requires
publication regardless.

## Retention and erasure

| Data | On member erasure | On family erasure | Otherwise |
|---|---|---|---|
| `calendar_event` | Retained; `created_by_member_id` tombstoned | Deleted | Retained while the family is active |
| Event title / description | **Not scrubbed** — free text the household authored | Deleted | — |
| `event_participant` | That member's rows deleted | Deleted | — |
| `event_occurrence` | Unaffected | Deleted (cascade) | Pruned behind a 400-day trailing window |
| Attachment references | Unaffected | Deleted | Opaque throughout; never dereferenced |
| Child-read audit entries | Retained | Retained | Platform audit schedule (spec 008) |

**The one honest limitation, restated where an implementer will see it.** Removing a member deletes
their structured references and cannot rewrite an event titled "Emma's dentist". The alternatives
are worse: deleting every event a departing member attended destroys the family's own history, and
running a name-matcher over authored text is a heuristic that fails in both directions on a
compliance path. [spec.md](spec.md)'s Principle XI answer 2 states it to the user as well.

**Family erasure is trivially complete** because every Calendar row carries `family_id` and RLS
enforces it — there is no row the saga cannot reach, which is the payoff for the denormalisation
above.

## Export

A member's export contains the events they are entitled to *read*, evaluated by the same rule — an
export is not a second, more permissive read path.

| Included | Excluded |
|---|---|
| Events they authored or participate in | Any event involving a child they do not guard (FR-016) |
| Their family's shared events with no child participant | Another family's anything |
| Participants, timings, location, category, recurrence rule | Attachment *contents* — references are opaque here |
| Individual occurrence cancellations | — |
