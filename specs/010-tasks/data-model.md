# Data Model: Tasks (spec 010)

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

Two new tables, both family-scoped, both under `ENABLE` and `FORCE ROW LEVEL SECURITY`
([ADR-017](../../adr/ADR-017-tenant-isolation-at-the-database.md)). One additive function in
`@fp/kernel/recurrence`. **No change to the Family context, the Calendar context, or any existing
table.** No new database role and no new external dependency.

Keep one thing in mind while reading: **every instance of a recurring chore is its own `task`
row.** There is no series table and no materialised future. A series is a shared `series_id`, a
`predecessor_id` chain, and one row flagged as head.

## Branded identifiers

Added to `@fp/kernel`'s `branded-id.ts` (Principle I).

| Identifier | Constructor |
|---|---|
| `TaskId` | `asTaskId` |
| `TaskSeriesId` | `asTaskSeriesId` |

`FamilyId` and `FamilyMemberId` are imported, never redefined.

## Aggregates and their tables

### `Task`, the aggregate root

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `TaskId` |
| `family_id` | `uuid` NOT NULL | Tenant key, RLS predicate; FK to `family`. `UNIQUE (id, family_id)` for the composite FK below |
| `title` | `text` NOT NULL | Personal data. Never parsed, logged or put in an outbox payload. 1–200 chars |
| `notes` | `text` NULL | Personal data, same treatment. Up to 4,000 chars |
| `priority` | `task_priority` NOT NULL | `'low' \| 'normal' \| 'high'`, default `'normal'` |
| `category` | `task_category` NULL | `'household' \| 'school' \| 'health' \| 'finance' \| 'admin' \| 'other'`. Platform-defined, not family text |
| `status` | `task_status` NOT NULL | `'open' \| 'completed' \| 'cancelled'`, default `'open'` |
| `due_kind` | `task_due_kind` NOT NULL | `'none' \| 'date' \| 'date_time'`, the discriminant ([research.md §4](research.md)) |
| `due_date` | `date` NULL | Set for `date` and `date_time` |
| `due_local_time` | `time` NULL | Set for `date_time` only |
| `time_zone` | `text` NULL | IANA identifier; set whenever `due_kind <> 'none'` |
| `due_at` | `timestamptz` NULL | **Derived** due moment, written by the domain. End of `due_date` for `date`; the resolved instant for `date_time` |
| `recurrence_rule` | `text` NULL | Serialised RRULE, the kernel's declared subset. Requires `due_kind <> 'none'` |
| `recurrence_anchor` | `timestamp` NULL | Local date-time (no zone) the rule is counted from ([research.md §2](research.md)). Set iff `recurrence_rule` is |
| `series_id` | `uuid` NULL | `TaskSeriesId`. Set iff `recurrence_rule` is, or the task was once part of a series |
| `predecessor_id` | `uuid` NULL **UNIQUE** | The instance this one succeeded. FK to `task(id)` `ON DELETE SET NULL`. The uniqueness is FR-022 |
| `is_series_head` | `boolean` NOT NULL | Default `false`. Partial `UNIQUE (series_id) WHERE is_series_head`, which is FR-019 |
| `completed_at` / `completed_by_member_id` | `timestamptz` / `uuid` NULL | Set iff `status = 'completed'` |
| `cancelled_at` / `cancelled_by_member_id` | `timestamptz` / `uuid` NULL | Set iff `status = 'cancelled'` |
| `closed_at` | `timestamptz` NULL | `coalesce(completed_at, cancelled_at)`, a generated stored column, indexed for history |
| `overdue_reported_for` | `timestamptz` NULL | The `due_at` last reported overdue ([research.md §5](research.md)) |
| `created_by_member_id` | `uuid` NULL | Tombstoned on member erasure |
| `version` | `integer` NOT NULL | Default 1, incremented on every change (FR-011, [research.md §9](research.md)) |
| `created_at` / `updated_at` | `timestamptz` NOT NULL | |

**Shape constraints.** The discriminated unions are enforced in the database, not only the domain:

```sql
CONSTRAINT task_due_shape CHECK (
  (due_kind = 'none'      AND due_date IS NULL     AND due_local_time IS NULL
                          AND time_zone IS NULL    AND due_at IS NULL)
  OR (due_kind = 'date'      AND due_date IS NOT NULL AND due_local_time IS NULL
                          AND time_zone IS NOT NULL AND due_at IS NOT NULL)
  OR (due_kind = 'date_time' AND due_date IS NOT NULL AND due_local_time IS NOT NULL
                          AND time_zone IS NOT NULL AND due_at IS NOT NULL)
)
CONSTRAINT task_recurrence_shape CHECK (
  (recurrence_rule IS NULL AND recurrence_anchor IS NULL)
  OR (recurrence_rule IS NOT NULL AND recurrence_anchor IS NOT NULL
      AND series_id IS NOT NULL AND due_kind <> 'none')
)
CONSTRAINT task_status_shape CHECK (
  (status = 'open'      AND completed_at IS NULL     AND cancelled_at IS NULL)
  OR (status = 'completed' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
  OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND completed_at IS NULL)
)
CONSTRAINT task_head_is_in_a_series CHECK (NOT is_series_head OR series_id IS NOT NULL)
```

`completed_by_member_id` may be null alongside `completed_at` only after a tombstone. The tombstone
is a reference, not a null, so in practice both are set.

**Indexes**

```sql
UNIQUE (predecessor_id)
UNIQUE (series_id) WHERE is_series_head
INDEX  (family_id, due_at NULLS LAST, id) WHERE status = 'open'          -- open list, keyset
INDEX  (family_id, closed_at) WHERE status <> 'open'                     -- history
INDEX  (due_at) WHERE status = 'open'
                  AND due_at IS NOT NULL
                  AND overdue_reported_for IS DISTINCT FROM due_at       -- the overdue sweep
```

### `TaskAssignment`

| Column | Type | Notes |
|---|---|---|
| `task_id` | `uuid` NOT NULL | |
| `family_id` | `uuid` NOT NULL | Denormalised for RLS; composite FK `(task_id, family_id) → task (id, family_id) ON DELETE CASCADE` |
| `member_id` | `uuid` NOT NULL | FK to `family_member`. **The only thing Tasks knows about a person** |
| `assigned_at` | `timestamptz` NOT NULL | |
| `assigned_by_member_id` | `uuid` NULL | Tombstoned on member erasure |

```sql
PRIMARY KEY (task_id, member_id)
INDEX (member_id)                 -- assignee filter, the visibility anti-join, erasure
```

No `kind`, `is_child` or guardian column, for the reasons in [research.md §7](research.md).

## The lifecycle

```text
          complete                cancel (instance | series)
  open ──────────────▶ completed        open ──────────────▶ cancelled   (terminal)
   ▲                      │
   └──────── reopen ──────┘
```

| From | Command | To | Recurring head side-effect |
|---|---|---|---|
| `open` | `complete` | `completed` | Spawn successor unless the rule has ended |
| `open` | `cancel { scope: 'instance' }` | `cancelled` | Spawn successor unless the rule has ended |
| `open` | `cancel { scope: 'series' }` | `cancelled` | None; the series has ended |
| `completed` | `reopen` | `open` | None, ever (FR-019) |
| `cancelled` | anything | rejected | `409 task/invalid_transition` |
| `completed` | edit | rejected | `409 task/invalid_transition`; reopen first |

`cancel { scope: 'series' }` on a non-head instance, or on a non-recurring task, is identical to
`scope: 'instance'`. There is nothing further to stop, and rejecting it would make clients track
head-ness to send the right body.

Overdue is not a row in this table. It is `status = 'open' AND due_at <= :now` (FR-025).

## The successor rule

Stated once because three code paths depend on it: complete, cancel-instance, and their idempotent
retries.

Given the closing head `h` and the closing instant `closedAt`:

1. `next = nextOccurrenceAfter({ rule: h.rule, dtstart: h.recurrence_anchor, timeZone: h.time_zone, after: max(h.due_at, closedAt) })`.
2. If `next` is null, do nothing more. `h` stays the closed head of an ended series.
3. Otherwise set `h.is_series_head = false`, then insert the successor `s`:
   - `series_id`, `recurrence_rule`, `recurrence_anchor`, `time_zone`, `due_kind`, `title`, `notes`,
     `priority`, `category` copied from `h`;
   - `due_date` = `next.local`'s date; `due_local_time` = `h.due_local_time` for `date_time`;
   - `due_at` recomputed; `predecessor_id = h.id`; `is_series_head = true`; `status = 'open'`;
     `version = 1`; `created_by_member_id` = the closing member.
4. Copy `h`'s `task_assignment` rows onto `s`.
5. Outbox: `TaskCreated { predecessorId: h.id, seriesId }`.

Steps 1–5 run in the transaction that closes `h`. A reader sees either `h` open or `h` closed with
`s`, never `h` closed alone (FR-020).

**Editing the rule** (FR-010) on an open head sets `recurrence_anchor` to the head's current local
due date-time. **Editing only the due date** leaves the anchor alone.

**Adding a rule to a non-recurring open task** allocates a new `series_id`, sets
`is_series_head = true` and anchors on the task's due. **Removing the rule** from an open head clears
`recurrence_rule` and `recurrence_anchor` and sets `is_series_head = false`, keeping `series_id` so
past instances still read as one series.

## Row-level security

The same shape as spec 008 and 009.

```sql
ALTER TABLE task            ENABLE ROW LEVEL SECURITY;
ALTER TABLE task            FORCE  ROW LEVEL SECURITY;
CREATE POLICY task_family ON task
  USING (family_id = current_setting('app.family_id', true)::uuid);
-- and the same for task_assignment

CREATE POLICY task_sweep_select ON task
  FOR SELECT USING (current_setting('app.is_sweep', true) = 'true');       -- overdue discovery

CREATE POLICY task_assignment_erasure_select ON task_assignment
  FOR SELECT USING (current_setting('app.is_erasure', true) = 'true');     -- member erasure discovery
```

The sweep and erasure flags are the ones earlier migrations introduced, reused rather than
multiplied. Discovery is SELECT-only; every write runs under `app.family_id`. **No Tasks table is
outside the policy set.**

## Relationships

```text
Family (spec 008, tenant root)
└── Task                               family_id, every row
    ├── TaskAssignment    (0..n)       member_id → FamilyMember, and nothing more
    └── predecessor_id    (0..1)       → Task, unique: the successor chain
                                       series_id groups a chain; exactly one row per series is head

FamilyMember (spec 008) ◀── member_id
GuardianshipRelationship (spec 008) ── read only through MemberVisibilityPort
Calendar (spec 009) ── no relationship of any kind
```

## Domain events

Six, written as outbox rows in the state change's own transaction (ADR-005 Layer 2). **Identifiers
and enum values only.** Full table with payloads in [research.md §8](research.md).

`TaskCreated` · `TaskAssigned` · `TaskUpdated` · `TaskCompleted` · `TaskCancelled` · `TaskOverdue`

## Retention and erasure

| Data | On member erasure | On family erasure | Otherwise |
|---|---|---|---|
| `task` | Retained; `created_by`, `completed_by`, `cancelled_by` tombstoned | Deleted | Retained while the family is active, open and closed alike |
| Title / notes | **Not scrubbed**, since it is free text the household wrote | Deleted | — |
| `task_assignment` | That member's rows deleted; the task remains, possibly unassigned | Deleted (cascade) | — |
| `overdue_reported_for` | Unaffected | Deleted | — |
| Child-read audit entries | Retained | Retained | Platform audit schedule (spec 008) |

## Export

Governed by the read rule (spec Principle XI answer 4). A member's export is exactly what
`GET …/tasks` and `GET …/tasks/history` would return to them over all time: open, completed and
cancelled tasks, excluding any task with an assignee outside their visible set.

## Kernel addition

```ts
// packages/kernel/src/recurrence/next-occurrence.ts, re-exported from the subpath index
export function nextOccurrenceAfter(input: {
  rule: RecurrenceRule; dtstart: LocalDateTime; timeZone: string; after: Date;
}): Result<ExpandedOccurrence | null, DomainError>;
```

Pure, built on `expand` by stepping windows forward until an occurrence is found or the expansion
reports `exhausted`, bounded by the kernel's existing `MAX_PERIODS` guard. Additive: `expand` and
every existing export are untouched ([research.md §2](research.md)).
