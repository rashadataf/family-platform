---

description: "Task list template for feature implementation"
---

# Tasks: Calendar

**Input**: Design documents from `/specs/009-calendar/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/calendar-api.md](contracts/calendar-api.md),
[quickstart.md](quickstart.md) — all present.

**No ADR gate.** Unlike spec 008, plan.md's Constitution Check passes with no gating item —
[research.md §1](research.md) argues explicitly why publishing `MemberVisibilityPort` needs no ADR.
Nothing here blocks on a merge outside this feature.

**Tests**: Included throughout, not optional. The constitution requires it directly — "integration
tests MUST run against a real database, because row-level security and constraints are the thing
being verified" and "authorization MUST have dedicated tests per route." The recurrence kernel adds
a third reason: it is pure by construction, so its unit suite is where DST correctness (SC-003) is
actually proven, not merely exercised.

**Organization**: Grouped by user story (spec.md's P1–P5). Foundational is lighter than spec 008's —
the tenant machinery (guards, RLS pattern, `withFamilyContext`) already exists and this feature
reuses it; what Foundational builds here is Calendar's own schema and its own unit of work,
constructed the same way. `MemberVisibilityPort`, the one deliberate change to the Family context,
is **not** foundational — it is scoped to User Story 2, which is the only story that needs it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5, mapped to spec.md's priorities (P1–P5)
- Every task names an exact file path

## Path Conventions

Paths follow plan.md's Project Structure exactly:

- `packages/kernel/src/` — branded ids, error taxonomy, and the `recurrence/` subpath
- `packages/core/src/calendar/{domain,application}/` — the bounded context
- `packages/core/src/family/application/ports/` — `MemberVisibilityPort` (US2, extends spec 008)
- `packages/contracts/src/v1/calendar.contract.ts` — the wire boundary (ADR-006)
- `packages/persistence/{prisma,src/repositories/calendar,src/repositories/family}/`
- `apps/api/src/calendar/` — controller, module, DI wiring (reuses spec 008's two guards)
- `apps/worker/src/sweeps/` — occurrence materialisation

---

## Phase 1: Setup

**Purpose**: the boundary rule in place before the code it governs exists, and the context scaffold
it needs to attach to — the same fail-closed discipline spec 008's T003 established.

- [X] T001 [P] Create the context scaffold `packages/core/src/calendar/index.ts` (empty barrel), and
      re-export it from `packages/core/src/index.ts` as `export * as calendar from
      './calendar/index.js';` alongside `identity`, `family` and `compliance`.
- [X] T002 Add a `calendar-repositories-are-private` rule to `.dependency-cruiser.cjs`, forbidding
      anything outside `packages/persistence/src/` from importing
      `packages/persistence/src/repositories/calendar/**` — the same argument
      `family-repositories-are-private` already makes, one context over. FR-027 makes Calendar's own
      tables reachable only through its own application layer, exactly as FR-020 does for Family's.

**Checkpoint**: the context namespace exists and builds, and the boundary rule is in force before
there is anything for it to catch.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Calendar's own tenant machinery — schema, RLS, scoped unit of work, ports and events —
built the same way spec 008 built Family's, reusing the pattern rather than the code (a different
context cannot reuse `withFamilyContext` itself, which is wired to Family's own repositories).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Kernel and shared primitives

- [X] T003 [P] Add `CalendarEventId` and `EventOccurrenceId` and their `as*` constructors to
      `packages/kernel/src/branded-id.ts`, and export them from `packages/kernel/src/index.ts`.
- [X] T004 [P] Add the calendar-specific error kinds to `packages/kernel/src/errors.ts`'s
      `DomainError` union: `InvalidTimeRange`, `UnknownTimeZone`, `RecurrenceInvalid`,
      `RecurrenceUnsupported` (carrying which part was unsupported), `RecurrenceTooDense`,
      `RangeTooWide`, `OccurrenceNotMovable`, `ParticipantInvalid`. `CapabilityRequired` and
      `NotFound` already exist from spec 008 and are reused as-is — FR-028's non-disclosure rule is
      exactly the reasoning `NotFound`'s doc comment already states, one context over.

### Schema, and row-level security on three more tables (ADR-017, unchanged)

- [X] T005 Add the `calendar_event`, `event_occurrence` and `event_participant` models plus the
      `event_kind`, `event_category` and `event_status` enums to
      `packages/persistence/prisma/schema.prisma`, per [data-model.md](data-model.md). Include the
      `event_shape` and `event_order` `CHECK` constraints in the model's `@@` block, and the
      composite `UNIQUE (id, family_id)` on `calendar_event` that `event_occurrence` and
      `event_participant`'s composite foreign keys reference.
- [X] T006 Generate the migration as
      `packages/persistence/prisma/migrations/<timestamp>_calendar/migration.sql`, then hand-write
      into it: `ENABLE` **and** `FORCE ROW LEVEL SECURITY` on all three tables, one policy each
      (`USING (family_id = current_setting('app.family_id', true)::uuid)`), and the composite foreign
      keys `(event_id, family_id) REFERENCES calendar_event (id, family_id) ON DELETE CASCADE` on
      `event_occurrence` and `event_participant` — Prisma's schema language cannot express a
      composite FK against a non-primary unique key, so this half is raw SQL, which ADR-003 permits.
      Grant the existing `family_platform_app` role full DML on all three; no new role.
- [X] T007 Hand-write, into the same migration file, `UNIQUE (event_id, starts_at)` on
      `event_occurrence` — the identity the sweep's idempotence rests on
      ([research.md §5, §8](research.md)) — and the range-query index
      `(family_id, starts_at, ends_at)`.

### The scoped unit of work — Calendar's own, mirroring the pattern

- [X] T008 [P] Declare `CalendarUnitOfWork` and `CalendarUnitOfWorkPort` in
      `packages/core/src/calendar/application/ports/calendar-unit-of-work.port.ts`: `familyId`,
      `events`, `occurrences`, `participants`, `outbox`. Mirrors
      `family-unit-of-work.port.ts`'s shape; no method on the repositories it names takes a family
      parameter (ARCHITECTURE §9 layer 4).
- [X] T009 Implement `withCalendarFamilyContext(familyId, work)` in
      `packages/persistence/src/calendar-context.ts`: one `$transaction`,
      `SELECT set_config('app.family_id', $1, true)` as its first statement, every Calendar
      repository constructed against that transaction client. This is `family-context.ts`'s pattern
      applied to a second context — not a shared function, because `withFamilyContext` is wired to
      Family's own repositories and Calendar's transaction constructs different ones.
- [X] T010 [P] Integration test `packages/persistence/src/calendar-context.integration.spec.ts`:
      connected as the application role with no context set, all three tables return zero rows while
      rows plainly exist; inside `withCalendarFamilyContext` only that family's rows appear;
      connected as the **owner** role, `FORCE ROW LEVEL SECURITY` still filters — the assertion that
      proves ADR-017 is doing something a second time, not merely once.
- [X] T011 [P] Integration test in `calendar-context.integration.spec.ts`: `set_config(..., true)`
      does not survive its transaction — open a scoped transaction, commit, then query the same
      pooled connection with no context and assert zero rows. The single worst failure this
      mechanism can have, and the one a functional test would never notice.

### Ports and events

- [X] T012 [P] Declare `CalendarReadPort` in
      `packages/core/src/calendar/application/ports/calendar-read.port.ts`: the range-query
      signature (`familyId`, `from`, `to`, `readerMemberId`) returning `OccurrenceView[]`, published
      now so the dashboard endpoint and the AI read path can depend on it later without this context
      changing shape for them (§7.1).
- [X] T013 [P] Declare `ErasurePort.eraseForFamily(familyId)` and `eraseForMember(memberId)` in
      `packages/core/src/calendar/application/ports/erasure.port.ts`, mirroring family's — declared
      now, implemented in Polish (T085), per Principle XI: "a new context is not complete without
      them."
- [X] T014 [P] Implement the four versioned event builders in
      `packages/core/src/calendar/domain/events.ts` (`calendar.EventCreated.v1`,
      `calendar.EventUpdated.v1`, `calendar.EventCancelled.v1`,
      `calendar.OccurrenceMaterialised.v1`), with `events.spec.ts` asserting each payload carries
      identifiers only — no title, description or location — per Principle VI and VIII and
      [research.md §6](research.md).
- [X] T015 [P] Declare the three repository port interfaces —
      `packages/core/src/calendar/application/ports/calendar-event.repository.ts`,
      `event-occurrence.repository.ts`, `event-participant.repository.ts` — each scoped by
      construction, no method taking a family id, per [data-model.md](data-model.md).

### Testing infrastructure and wiring

- [X] T016 [P] Add calendar factories to `packages/testing/src/calendar-factories.ts`: a one-off
      timed event, an all-day event, and a weekly recurring event, each seedable into an existing
      family from `family-factories.ts`. Export from `packages/testing/src/index.ts`.
- [X] T017 [P] Add a fixed-clock test helper and the two UK transition fixtures (spring forward
      2026-03-29, fall back 2026-10-25) to `packages/testing/src/calendar-factories.ts`, since every
      recurrence test in US3 and the sweep test in US5 needs to control "now" deterministically —
      the same reasoning `sweep-retention.ts`'s injected `Clock` already establishes for the other
      sweeps.
- [X] T018 Create `apps/api/src/calendar/calendar.module.ts` and `calendar.tokens.ts`, wiring the
      clock, `withCalendarFamilyContext`, and reusing spec 008's existing `FamilyMembershipGuard` and
      `CapabilityGuard` unchanged — Calendar adds no new guard, only a new
      `@RequiresCapability('calendar:read' | 'calendar:write')` usage.
- [X] T019 Create `packages/contracts/src/v1/calendar.contract.ts` with the `/v1` router skeleton and
      the shared shapes (the discriminated `CreateEventRequest`, `OccurrenceResponse`, the
      problem-format error types from [contracts/calendar-api.md](contracts/calendar-api.md)),
      exported from `packages/contracts/src/index.ts`. Routes are added by the story that owns them.

**Checkpoint**: row-level security is provably in force on all three tables, the scoped unit of work
exists, and the ports and events are declared. User story implementation can now begin.

---

## Phase 3: User Story 1 - Put something on the family's calendar and see it there (Priority: P1) 🎯 MVP

**Goal**: a member records a one-off event and it appears when the family asks what is happening
over a range of dates.

**Independent Test**: create an event and query a date range covering it, confirming it comes back;
confirm a member of a different family querying the same range gets nothing and querying the event
directly gets a not-found response.

### Tests for User Story 1

- [X] T020 [P] [US1] Unit test `packages/core/src/calendar/domain/calendar-event.aggregate.spec.ts`:
      the timed/all-day discriminated union rejects a mixed shape at construction; `end` before
      `start` is rejected with a specific reason (FR-002); an unrecognised IANA zone is rejected
      (FR-002).
- [X] T021 [P] [US1] Unit test `packages/core/src/calendar/domain/materialisation.ts`'s reconcile,
      in `materialisation.spec.ts`, for the **non-recurring** case only: a one-off event produces
      exactly one occurrence at its own instant, and re-running the reconcile against the same event
      inserts nothing (idempotence, the simple case of FR-025).
- [X] T022 [P] [US1] Integration test `apps/api/src/calendar/create-event.integration.spec.ts`:
      `POST /v1/families/:familyId/events` returns 201 for a timed event, rejects `end` before
      `start` with `422 calendar/invalid_time_range`, and rejects an unrecognised zone with
      `422 calendar/unknown_time_zone` (US1 Scenarios 3, 5, 6). Covers `Idempotency-Key` replay
      producing no duplicate.
- [X] T023 [P] [US1] Integration test `apps/api/src/calendar/create-event.integration.spec.ts`:
      an all-day event is created from `startDate`/`endDate` and its occurrence falls on the intended
      calendar date regardless of the requesting reader's time zone header (FR-004).
- [X] T024 [P] [US1] Integration test `apps/api/src/calendar/range-query.integration.spec.ts`:
      `GET …/occurrences?from=&to=` returns an event whose window overlaps the query range —
      including one that starts before `from` and ends after `to` (overlap, not containment,
      [research.md §7](research.md)) — and excludes one entirely outside it.
- [X] T025 [P] [US1] Integration test `apps/api/src/calendar/capability.integration.spec.ts`: a
      member holding only `calendar:read` is denied `POST …/events` with
      `403 calendar/capability_required`; an `extended` member (who holds `calendar:write` per spec
      008's existing map) succeeds.
- [X] T026 [P] [US1] Integration test `apps/api/src/calendar/cross-family-access.integration.spec.ts`
      (the seed for T089's full sweep): a member of a different family gets
      `404 calendar/not_found` from both the range query and the direct event read.

### Implementation for User Story 1

- [X] T027 [US1] Implement the `CalendarEvent` aggregate in
      `packages/core/src/calendar/domain/calendar-event.aggregate.ts`: `kind: 'timed' | 'all_day'`
      as a discriminated union (Principle I), `title`, optional `description`, `location`,
      `category`, `timeZone`, `status`, with the ordering and shape invariants enforced in the
      constructor, not only by T005's database constraints.
- [X] T028 [US1] Implement `EventOccurrence` as a plain derived value in
      `packages/core/src/calendar/domain/event-occurrence.ts` — `startsAt`, `endsAt`,
      `cancelledAt | null` — with no behaviour of its own beyond what the reconcile in
      `materialisation.ts` produces.
- [X] T029 [US1] Implement the materialisation reconcile in
      `packages/core/src/calendar/domain/materialisation.ts` for the non-recurring case: given an
      event with no recurrence rule, its single occurrence is its own instant (or, for an all-day
      event, the day's bounds in its time zone). Pure — takes the event and existing occurrences as
      arguments, returns the occurrences to insert/update/delete, per
      [data-model.md](data-model.md)'s reconcile description. The recurring case is US3's extension
      of this same function.
- [X] T030 [US1] Implement `calendar-event.repository.ts` and `event-occurrence.repository.ts` in
      `packages/persistence/src/repositories/calendar/`, constructed from the transaction
      `withCalendarFamilyContext` opens. No method takes a family id.
- [X] T031 [US1] Implement `createEvent` in
      `packages/core/src/calendar/application/commands/create-event.command.ts`: validate via the
      aggregate, run the reconcile for the (non-recurring, in this story) case, write the event, its
      occurrence and an `EventCreated` outbox row in one transaction.
- [X] T032 [P] [US1] Implement `listOccurrences` in
      `packages/core/src/calendar/application/queries/list-occurrences.query.ts`: the range query
      over `event_occurrence` joined to `calendar_event` for the denormalised fields
      `OccurrenceResponse` needs. **No participant filter yet** — every occurrence a `calendar:read`
      holder's family owns is visible in this story, since participants do not exist until US2.
- [X] T033 [P] [US1] Implement `getEvent` in
      `packages/core/src/calendar/application/queries/get-event.query.ts`.
- [X] T034 [US1] Add the three routes to `packages/contracts/src/v1/calendar.contract.ts`:
      `POST /v1/families/:familyId/events`, `GET …/occurrences`, `GET …/events/:eventId`, with
      `Idempotency-Key` honoured on the first (Principle IX). `CreateEventRequest`'s `kind`
      discriminant carries `startsAt`/`endsAt` on `'timed'` and `startDate`/`endDate` on
      `'all_day'`, mutually exclusive on the wire.
- [X] T035 [US1] Implement `apps/api/src/calendar/calendar.controller.ts` binding those three routes,
      with `FamilyMembershipGuard` and `CapabilityGuard` applied exactly as spec 008's controller
      applies them. Register `CalendarModule` into `apps/api/src/app.module.ts`.

**Checkpoint**: quickstart Scenario 1 passes. An event exists, it is readable in its range, and it is
invisible and unreachable to any other family.

---

## Phase 4: User Story 2 - Say who an event is for and where it is (Priority: P2)

**Goal**: an event records which family members it concerns — including children, who have no
account — with a location and a category, and an event involving a child is reachable only by that
child's guardians.

**Independent Test**: add both an adult and a child as participants on an event; confirm the event
records them as family member references with no dependency on either holding an account; confirm
the child's participation is reachable only under the guardian visibility rule.

**This is the feature's hardest requirement** — the story where `MemberVisibilityPort` is built.

### Tests for User Story 2

- [X] T036 [P] [US2] Add a fake implementation of `MemberVisibilityPort` to
      `packages/core/src/family/application/member-visibility.fake.ts`, mirroring the existing
      `family-unit-of-work.fake.ts` pattern — a plain in-memory map from member to their visible set.
      This is what lets Calendar's own application-layer command and query unit tests (T046, T047)
      run without a database; the port's real behaviour against real guardianship data is proven by
      T041's integration test instead.
- [X] T037 [P] [US2] Unit test `packages/core/src/calendar/domain/event-participant.spec.ts`: a
      participant is a bare `FamilyMemberId` reference with no other field — asserting the type
      carries no `kind`, `dateOfBirth` or `guardianId`, so a later change cannot accidentally widen
      it ([data-model.md](data-model.md)'s design point, enforced as a test rather than left as prose).
- [X] T038 [P] [US2] Integration test `apps/api/src/calendar/participants.integration.spec.ts`: an
      event with an adult participant and a separate event with a child participant are both created
      successfully; the child's event records the same shape of reference (FR-015). Adding a
      participant who is a member of a **different** family returns
      `422 calendar/participant_invalid` and discloses nothing about that member (FR-018).
- [X] T039 [P] [US2] Integration test
      `apps/api/src/calendar/child-visibility.integration.spec.ts` — the test this story exists for.
      **A guardian reads the child's event and gets 200; a non-guardian adult with `calendar:read`
      gets 404, not 403** (contrast with spec 008's `family/guardianship_required`, deliberate and
      noted in [contracts/calendar-api.md](contracts/calendar-api.md)). Both directions against role:
      an **owner** who is not a guardian is denied, a **viewer** who is a guardian is allowed.
- [X] T040 [P] [US2] Integration test in `child-visibility.integration.spec.ts`: the range query's
      **result count**, not only its content, is identical whether or not the child's event exists,
      for a non-guardian reader — the numeric assertion FR-016's "or infer its existence" demands
      (SC-011). Also: an event with two child participants, one guarded by the reader and one not, is
      hidden entirely.
- [X] T041 [P] [US2] Integration test
      `packages/persistence/src/repositories/family/member-visibility.integration.spec.ts`: the
      adapter returns every adult member plus the children a given member actively guards, and
      **excludes** a child the member does not guard; revoking a guardianship changes the result on
      the very next call, with no caching (FR-016's read-time requirement).
- [X] T042 [P] [US2] Integration test `apps/api/src/calendar/child-audit.integration.spec.ts`: a
      permitted read of an event with a child participant writes one `audit_log` row (actor, subject,
      outcome); a denied read writes one too (FR-017). One row per event read, not per occurrence —
      matching spec 008's own reasoning for auditing at read-granularity, not render-granularity.

### Implementation for User Story 2

- [X] T043 [US2] Declare `MemberVisibilityPort` in
      `packages/core/src/family/application/ports/member-visibility.port.ts`
      ([research.md §1](research.md)): `resolveVisibleMemberIds(viewerMemberId, familyId)` returning
      every adult member plus the children the viewer actively guards. Export it from
      `packages/core/src/family/index.ts` alongside `FamilyContextPort` — this is a change to the
      **Family** context, made here because Calendar's requirement is what surfaces the need, and
      reviewed as such.
- [X] T044 [US2] Implement the adapter in
      `packages/persistence/src/repositories/family/member-visibility.ts`, composing the member
      roster with the existing `GuardianshipRepository.listActiveChildIdsGuardedBy`
      (spec 008) inside one `withFamilyContext` call. No new query pattern, no new index.
- [X] T045 [US2] Implement the `EventParticipant` value in
      `packages/core/src/calendar/domain/event-participant.ts` and
      `event-participant.repository.ts` in `packages/persistence/src/repositories/calendar/` —
      `member_id` and `added_at` only.
- [X] T046 [US2] Extend `createEvent` and add `updateEvent`'s participant handling in
      `packages/core/src/calendar/application/commands/create-event.command.ts` to accept
      `participants: FamilyMemberId[]`, validating each against the family's own roster (via the
      unit of work, not a second Family read) and rejecting a foreign member with
      `ParticipantInvalid` (FR-018).
- [X] T047 [US2] Extend `listOccurrences` and `getEvent` to apply the guardian filter: resolve the
      reader's visible-member set via `MemberVisibilityPort` in a separate transaction, then exclude
      (list) or reject-as-not-found (get) any event with a participant outside that set — the
      `NOT EXISTS` shape from [research.md §7](research.md), applied **in** the query, not after it.
- [X] T048 [US2] Wire the audit write into `getEvent` and `listOccurrences`: one `AuditLogPort.append`
      call per event that carries a child participant and was read or denied, reusing spec 008's
      `AuditLogPort` from `packages/core/src/compliance`.
- [X] T049 [US2] Extend `packages/contracts/src/v1/calendar.contract.ts` and
      `calendar.controller.ts`: `CreateEventRequest` and `UpdateEventRequest` gain `participants`,
      `location` and `category`; `OccurrenceResponse` and the event-read response gain the resolved
      participant list, present only for a reader who may see them (the filter already refused the
      whole event otherwise, so no per-field redaction is needed here — contrast with spec 008's
      per-field `dateOfBirth` omission, which this story does not need).

**Checkpoint**: quickstart Scenario 3 passes, audit rows included. The platform's privacy rule now
applies to a second context.

---

## Phase 5: User Story 3 - Schedule something that repeats, and have every occurrence be right (Priority: P3)

**Goal**: a repeating event materialises correct occurrences, including across both UK clock
changes, and a recurrence rule outside the supported subset or of pathological density is rejected
rather than accepted.

**Independent Test**: create a weekly recurring event spanning the last Sunday in October, query
ranges on either side, and confirm every occurrence holds the same local wall-clock time.

**This is the shared kernel** — the one piece of this feature Tasks inherits unchanged.

### Tests for User Story 3 — the recurrence kernel, pure and exhaustive

- [X] T050 [P] [US3] Unit test `packages/kernel/src/recurrence/rrule.vo.spec.ts`: every rule in the
      declared supported subset (`FREQ` × `DAILY/WEEKLY/MONTHLY/YEARLY`, `INTERVAL`, `COUNT`,
      `UNTIL`, `BYDAY`, `BYMONTHDAY`, `BYMONTH`, `WKST`) round-trips through parse and serialise;
      every rule in the declared rejected set (`BYSETPOS`, `BYWEEKNO`, `BYYEARDAY`, `BYHOUR`,
      `BYMINUTE`, `BYSECOND`, `FREQ=HOURLY/MINUTELY/SECONDLY`, `RDATE`) is rejected with a
      `RecurrenceUnsupported` error **naming the offending part** ([research.md §2](research.md)). A
      malformed string (not RFC 5545 at all) is rejected as `RecurrenceInvalid`, a different kind.
- [X] T051 [P] [US3] Unit test `packages/kernel/src/recurrence/zoned-time.spec.ts`: local-to-instant
      conversion is correct across both UK transitions — 2026-03-29 (a local time that does not
      exist resolves forward across the gap) and 2026-10-25 (a local time that occurs twice resolves
      to the **first**, pre-transition offset) — per the disambiguation rule in
      [research.md §3](research.md). Also: an all-day date never passes through offset arithmetic at
      all — asserted by constructing one in a zone with a large offset and confirming the calendar
      date is unchanged when read from another zone.
- [X] T052 [P] [US3] Unit test `packages/kernel/src/recurrence/expand.spec.ts`: a weekly rule
      expanded across both transition weekends produces occurrences at the same **local** wall-clock
      time on both sides, with UTC instants differing by exactly the transition offset (SC-003). An
      indefinite rule expanded against a window stops at the window's edge rather than attempting to
      expand in full (FR-010). A rule whose expansion within the window would exceed 1,000
      occurrences is rejected as `RecurrenceTooDense` rather than truncated (FR-012).
- [X] T053 [P] [US3] Unit test `packages/kernel/src/recurrence/expand.spec.ts`: two calls to `expand`
      with identical arguments return identical results (purity, SC-010's consumability claim), and
      results are **identical** whether or not a `PublicHolidayProvider` is supplied — the assertion
      that keeps FR-014 honest (SC-013). No I/O, clock or randomness anywhere in the module: asserted
      by a lint-visible import check as well as by these tests, in T002's sibling rule (T088).
- [X] T054 [P] [US3] Integration test `apps/api/src/calendar/recurrence.integration.spec.ts`:
      `POST …/events` with a `recurrenceRule` materialises occurrences within the horizon and
      publishes `OccurrenceMaterialised` **once** — a single outbox row carrying the window bounds
      and a count, not one row per occurrence (FR-030, [research.md §6](research.md)).
- [X] T055 [P] [US3] Integration test in `recurrence.integration.spec.ts`: an all-day recurring event
      (an annual birthday) produces occurrences that fall on the intended calendar date when read
      from a reader in a different time zone (FR-004 applied to recurrence).
- [X] T056 [P] [US3] Integration test in `recurrence.integration.spec.ts`: a malformed or unsupported
      rule is rejected by the route with the specific error type from T050, and no event is created
      (transactional — a rejected rule leaves nothing behind).

### Implementation for User Story 3

- [X] T057 [US3] Add the `"./recurrence"` subpath to `packages/kernel/package.json`'s `exports`, and
      create `packages/kernel/src/recurrence/index.ts` as its public surface. No change to the root
      `"."` export.
- [X] T058 [US3] Implement `RecurrenceRule` parsing and serialisation in
      `packages/kernel/src/recurrence/rrule.vo.ts`: the declared supported subset only, with every
      other RFC 5545 keyword rejected at parse time naming the offending keyword
      ([research.md §2](research.md)).
- [X] T059 [US3] Implement local-instant conversion and the DST disambiguation rule in
      `packages/kernel/src/recurrence/zoned-time.ts`, using `Intl.DateTimeFormat` with an explicit
      `timeZone` and `formatToParts` — no runtime dependency
      ([research.md §3](research.md)).
- [X] T060 [US3] Declare `PublicHolidayProvider` in
      `packages/kernel/src/recurrence/public-holiday.port.ts` — a pure lookup interface, threaded
      through `expand`'s signature but consulted by nothing inside it, per FR-014's resolved
      clarification. This is the seam Reference and Locale fills later.
- [X] T061 [US3] Implement `expand(rule, window, timeZone, holidays?)` in
      `packages/kernel/src/recurrence/expand.ts`: pure, no I/O, no clock, no randomness — the window
      is an argument, never derived from `Date.now()` inside the module. Enforces the 1,000-occurrence
      cap during expansion (FR-012).
- [X] T062 [US3] Extend the materialisation reconcile in
      `packages/core/src/calendar/domain/materialisation.ts` for the recurring case: call
      `expand` over the horizon, `INSERT … ON CONFLICT (event_id, starts_at) DO UPDATE` the end
      instant only (never `cancelledAt`), delete occurrences at instants the rule no longer produces
      — the shape [data-model.md](data-model.md) specifies. This is the same function T029 built;
      this task is its recurring-case branch, not a new file.
- [X] T063 [US3] Extend `createEvent` to accept an optional `recurrenceRule`, parse it via
      `rrule.vo.ts`, run the reconcile over the initial horizon (400 days,
      [research.md §4](research.md)), and set `materialised_through` in the same transaction.
- [X] T064 [US3] Publish `OccurrenceMaterialised` per (event, window) rather than per occurrence, in
      the same command — one outbox row carrying `eventId`, the window bounds and a count
      ([research.md §6](research.md)).
- [X] T065 [US3] Extend `packages/contracts/src/v1/calendar.contract.ts`'s `CreateEventRequest` with
      an optional `recurrenceRule: string`, and map `RecurrenceInvalid`, `RecurrenceUnsupported` and
      `RecurrenceTooDense` to their wire error types in the controller.

**Checkpoint**: quickstart Scenario 2 passes on both UK transition weekends. The shared kernel is
complete, pure, and ready for Tasks to import unchanged.

---

## Phase 6: User Story 4 - Change your mind: move it, edit it, or call it off (Priority: P4)

**Goal**: an event can be edited or cancelled; a single occurrence of a recurring series can be
cancelled independently but not moved; a cancelled event remains visible as cancelled.

**Independent Test**: create a recurring event, change its recurrence rule, and confirm occurrences
matching the old rule but not the new one are gone while new-rule occurrences are present; cancel the
event and confirm it still appears, marked cancelled.

### Tests for User Story 4

- [X] T066 [P] [US4] Integration test `apps/api/src/calendar/update-event.integration.spec.ts`:
      `PATCH …/events/:eventId` changes title, location, category and participants, publishing
      `EventUpdated`; any writer may edit any event in the family, not only its author (spec.md
      Assumptions).
- [X] T067 [P] [US4] Integration test in `update-event.integration.spec.ts`: changing a recurring
      event's `recurrenceRule` rebuilds its occurrences so that none contradicting the new rule
      survives, and occurrences matching **both** the old and new rule are updated in place, not
      deleted and reinserted (FR-020) — asserted by their `id` being stable across the edit.
- [X] T068 [P] [US4] Integration test `apps/api/src/calendar/cancel-event.integration.spec.ts`:
      `POST …/events/:eventId/cancel` marks the event cancelled, publishes `EventCancelled`, and the
      event remains readable and present in its range query, distinguishable as cancelled (FR-021,
      FR-008 applied). Idempotent: cancelling twice returns the same state, not an error.
- [X] T069 [P] [US4] Integration test
      `apps/api/src/calendar/cancel-occurrence.integration.spec.ts`: cancelling one occurrence leaves
      every other occurrence in the series untouched, and the cancellation **survives** a subsequent
      rebuild triggered by an unrelated field edit (FR-022, SC-012).
- [X] T070 [P] [US4] Integration test in `cancel-occurrence.integration.spec.ts`: cancelling one
      occurrence, then editing the series' **time** (not just its rule), causes the cancellation to
      be **dropped** rather than carried across — the deliberate boundary from
      [research.md §5](research.md), asserted so the behaviour is a tested decision rather than an
      emergent one.
- [X] T071 [P] [US4] Integration test in `cancel-occurrence.integration.spec.ts`: attempting to
      change a single occurrence's `startsAt` directly (rather than cancelling it) is rejected with
      `422 calendar/occurrence_not_movable`, pointing the caller at editing the series (FR-022).
- [X] T072 [P] [US4] Integration test `apps/api/src/calendar/idempotency.integration.spec.ts`:
      `Idempotency-Key` is honoured on `POST …/events` and both cancel routes, with a replay
      producing no duplicate event, occurrence or participation (FR-023).

### Implementation for User Story 4

- [X] T073 [US4] Implement `updateEvent` in
      `packages/core/src/calendar/application/commands/update-event.command.ts`: `PATCH` semantics
      over the authored fields, re-running the materialisation reconcile whenever a change affects
      which occurrences the rule produces (time, zone, or the rule itself), and publishing
      `EventUpdated` with which field groups changed.
- [X] T074 [US4] Implement `cancelEvent` in
      `packages/core/src/calendar/application/commands/cancel-event.command.ts`: sets `status =
      'cancelled'`, publishes `EventCancelled` with no `occurrenceId`, idempotent on an
      already-cancelled event.
- [X] T075 [US4] Implement `cancelOccurrence` in
      `packages/core/src/calendar/application/commands/cancel-occurrence.command.ts`: sets that one
      occurrence's `cancelledAt`, publishes `EventCancelled` **with** an `occurrenceId`, rejects a
      request to change `startsAt` on an occurrence with `OccurrenceNotMovable`.
- [X] T076 [US4] Add, to `packages/contracts/src/v1/calendar.contract.ts` and
      `apps/api/src/calendar/calendar.controller.ts`: `PATCH …/events/:eventId`,
      `POST …/events/:eventId/cancel`, `POST …/events/:eventId/occurrences/:occurrenceId/cancel`, all
      behind `calendar:write`, `Idempotency-Key` honoured on all three.

**Checkpoint**: quickstart Scenarios 4 and 5 pass. Households can correct and call off plans, and the
reconcile's exact boundary (cancel survives a rule change, not a time change) is proven rather than
assumed.

---

## Phase 7: User Story 5 - The calendar keeps looking ahead on its own (Priority: P5)

**Goal**: an indefinitely repeating event's occurrences keep being materialised as time passes,
without anyone re-saving it, and a horizon falling behind is observable before a family notices a
missing occurrence.

**Independent Test**: create an indefinitely repeating event, advance the clock past the point the
original horizon would have been exhausted, run the sweep, and confirm occurrences now exist beyond
the original horizon.

### Tests for User Story 5

- [X] T077 [P] [US5] Integration test
      `apps/worker/src/sweeps/materialise-occurrences.sweep.integration.spec.ts`: with the clock
      advanced past an event's `materialised_through` minus the horizon, running the sweep extends
      its occurrences so `materialised_through` is again at least 400 days ahead of the injected
      "now" (FR-024).
- [X] T078 [P] [US5] Integration test in the same file: running the sweep **twice** in succession
      inserts zero additional rows the second time — idempotence from the `(event_id, starts_at)`
      unique index, not from a guard the sweep remembers to check (FR-025).
- [X] T079 [P] [US5] Integration test in the same file: a family with no recurring events, or whose
      events have all ended, is skipped — the sweep performs no writes and takes no meaningfully
      nonzero time for it.
- [X] T080 [P] [US5] Integration test in the same file: occurrences older than the 400-day trailing
      window are pruned by the same sweep pass that extends the forward horizon
      ([research.md §4](research.md)), and the event and its recurrence rule remain intact — pruning
      is derived-data cleanup, never touching the authored record.

### Implementation for User Story 5

- [X] T081 [US5] Implement `materialiseHorizon` in
      `packages/core/src/calendar/application/commands/materialise-horizon.command.ts`: select
      events whose `materialised_through` is closer than the horizon, extend via the reconcile,
      prune occurrences outside the trailing window, advance the marker — all inside one
      family-scoped transaction per event.
- [X] T082 [US5] Implement `apps/worker/src/sweeps/materialise-occurrences.sweep.ts`, taking an
      injected `Clock` exactly as the other five sweeps do, returning a result the caller logs.
- [X] T083 [US5] Wire `runMaterialiseOccurrencesSweep` into `apps/worker/src/sweep-retention.ts`'s
      `main()`, alongside the existing five sweeps.
- [X] T084 [US5] Implement the horizon-lag observation: `min(materialised_through) - now()` across a
      family's events, exposed as `calendar_horizon_lag_seconds`
      ([contracts/calendar-api.md](contracts/calendar-api.md)) — a structured `console.warn` line
      when it falls below the horizon, the same "alert means a searchable log line" convention spec
      008's `guardian-coverage.sweep.ts` already established for this codebase (FR-026).

**Checkpoint**: quickstart Scenario 6 passes. An indefinitely repeating event keeps producing
occurrences without any further user action, and a stalled horizon is detectable before a family
notices a missing occurrence.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T085 Implement `ErasurePort.eraseForFamily` and `eraseForMember` in
      `packages/persistence/src/repositories/calendar/erasure.ts`, with an integration test asserting
      that after `eraseForFamily` no row in any of the three tables references the family (a single
      `DELETE FROM calendar_event` cascades the rest), and that after `eraseForMember` no
      `event_participant` row references the member while the events themselves — and their
      free-text titles — survive untouched, per [data-model.md](data-model.md)'s stated limitation.
- [X] T086 [P] Add `apps/api/src/calendar/no-personal-data-in-telemetry.integration.spec.ts`,
      mirroring spec 008's own test: exercise the create, update, range-query and child-visibility
      routes and assert no event `title`, `description` or `location` value appears in any log line,
      metric label, span attribute or outbox payload (Principle VI, VIII) — this feature holds more
      free text than any before it, so the assertion earns its own test rather than trusting T014's
      unit-level check alone.
- [X] T087 Add
      `packages/core/src/calendar/reads-family-only-through-published-ports.spec.ts`, an AST walk
      asserting every import in `packages/core/src/calendar` naming a path under `core/family`
      resolves to `family-context.port.js` or `member-visibility.port.js` and nothing else —
      `no-cross-context-internals` cannot express this because it admits everything under
      `application/ports/`, including a repository interface ([research.md §1](research.md)). Mirrors
      spec 008's `family-owns-the-relationship.spec.ts` and
      `checks-capabilities-not-roles.spec.ts` in construction.
- [X] T088 [P] Add a purity-import lint check for `packages/kernel/src/recurrence/`: no import
      outside the directory and `@fp/kernel`'s own primitives, and `packages/kernel/package.json`
      declares no new runtime dependency — asserted by a test reading `package.json` directly, since
      `pnpm ls` would not catch a dependency added and immediately unused.
- [X] T089 Run the parameterised cross-family sweep, extending spec 008's existing table in
      `apps/api/src/family/cross-family-access.integration.spec.ts` (or a sibling file, whichever
      keeps the single-table property spec 008's own T087 established) with Calendar's six routes,
      asserting `404 calendar/not_found` with an identical body to a genuinely missing event, and
      that the route list matches `calendarContract`'s own registered routes — a route added later
      without a test fails by being absent from the table (SC-004).
- [X] T090 [P] Implement the observability signals from
      [contracts/calendar-api.md](contracts/calendar-api.md) not already covered by earlier tasks:
      `calendar_range_query_duration`, `calendar_materialisation_duration`,
      `calendar_occurrences_written_total{op}`, `member_visibility_resolve_duration` — structured log
      lines, the same convention spec 008 established for a platform with no metrics pipeline yet.
- [X] T091 [P] Apply the rate limits from [contracts/calendar-api.md](contracts/calendar-api.md) in
      `apps/api/src/calendar/calendar.module.ts` via the existing rate-limit guard: 120 requests per
      user per minute on the range query, 120 per user per hour on event creation.
- [X] T092 Run `pnpm verify` — typecheck, lint, boundaries, unit, integration, format, build — and
      then the full [quickstart.md](quickstart.md), all nine scenarios, against a fresh
      `docker compose up`. Scenario 8 (row-level security, owner-role case) and Scenario 9 (boundary
      and purity discipline) are the two that cannot be inferred from a green pipeline alone.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. T001 and T002 are both parallel.
- **Foundational (Phase 2)**: depends on Setup. Blocks every user story. T005–T007 are one migration
  and must land in order; T008 depends on nothing new (ports are declarations); T009 depends on
  T005–T007; T010–T011 depend on T009; T018–T019 depend on T008 and T015.
- **User Stories (Phases 3–7)**: all depend on Foundational, written in priority order.
- **Polish (Phase 8)**: depends on all five stories. T089 depends on every route existing, which is
  the point of running it last.

### User Story Dependencies

Unlike spec 008's fan-out from one root, these largely **layer**: each story extends the same
handful of files the previous one built, rather than adding independent new ones.

- **US1** has no dependency on another story. The floor: an event exists and is readable in range.
- **US2** needs US1's `CalendarEvent`, `listOccurrences` and `getEvent` to extend with participants
  and the guardian filter. It also touches the **Family** context (T043–T044), which no other story
  does.
- **US3** needs US1's `materialisation.ts` to extend with the recurring case, but the recurrence
  kernel itself (T057–T061) is genuinely independent and could be built in parallel with US2 by a
  second person — only T062 (wiring the kernel into the reconcile) depends on US1's T029.
- **US4** needs US1's `createEvent`/`updateEvent` shape and US3's reconcile (a rebuild is meaningless
  without recurrence to rebuild against) — it is written after US3 for that reason, though its
  non-recurring edit and cancel paths (T073–T074) do not themselves need recurrence.
- **US5** needs US3's reconcile and horizon concept in full. It is last because every other story is
  demonstrable on the day it is built and this one is not — it needs time, or a moved clock, to
  observe.

So **US2 and US3's kernel half are the parallelisable pair**; everything else has a real sequential
dependency on the reconcile function growing the capability the next story needs.

### Within Each User Story

- Tests are written first and MUST fail before implementation.
- Domain → application → persistence → contract → controller, the same dependency-inversion order
  spec 008 used.

### Parallel Opportunities

- Foundational: T003–T004 (kernel); T012–T015 (ports and events); T016–T017 (testing). The schema
  block T005–T007 is strictly sequential, and T009–T011 depend on it.
- Every story's test block is fully parallel within itself.
- US3's recurrence-kernel tasks (T050–T061) are independent of US2's guardian-filter tasks
  (T036–T048) and can proceed on separate branches once Foundational lands.
- Polish: T086–T088 and T090–T091 are independent of each other.

---

## Parallel Example: Foundational

```bash
# Kernel, launched together:
Task: "Add CalendarEventId, EventOccurrenceId in packages/kernel/src/branded-id.ts"
Task: "Add calendar error kinds in packages/kernel/src/errors.ts"

# Ports and events, launched together:
Task: "Declare CalendarReadPort in packages/core/src/calendar/application/ports/calendar-read.port.ts"
Task: "Declare ErasurePort in packages/core/src/calendar/application/ports/erasure.port.ts"
Task: "Implement the four event builders in packages/core/src/calendar/domain/events.ts"
Task: "Declare the three repository ports in packages/core/src/calendar/application/ports/"
```

## Parallel Example: US2 and US3's kernel half, on separate branches

```bash
# Branch A — US2, the guardian filter:
Task: "Declare MemberVisibilityPort in packages/core/src/family/application/ports/member-visibility.port.ts"
Task: "Implement the adapter in packages/persistence/src/repositories/family/member-visibility.ts"

# Branch B — US3, the recurrence kernel, independent of Branch A entirely:
Task: "Implement RecurrenceRule parsing in packages/kernel/src/recurrence/rrule.vo.ts"
Task: "Implement zoned-time conversion in packages/kernel/src/recurrence/zoned-time.ts"
Task: "Implement expand() in packages/kernel/src/recurrence/expand.ts"
```

---

## Implementation Strategy

### MVP: User Story 1 alone

An event exists, is readable in its own family's range query, and is invisible to every other
family. That is a calendar in the minimal sense and is worth reviewing before recurrence,
participants or cancellation are layered on.

1. Phase 1 (Setup).
2. Phase 2 (Foundational). **STOP and VALIDATE**: quickstart Scenario 8 — the RLS check, on three
   new tables this time. If it does not behave as written, nothing built afterward is isolated.
3. Phase 3 (US1) → quickstart Scenario 1.
4. Phase 4 (US2) → quickstart Scenario 3. This is the feature's privacy promise applied to a second
   context; treat its review with the same weight spec 008's US2 review carried.
5. Phase 5 (US3) → quickstart Scenario 2, both UK transition weekends. The shared kernel Tasks will
   depend on; review it as infrastructure, not as one context's feature.
6. Phase 6 (US4) → quickstart Scenarios 4 and 5.
7. Phase 7 (US5) → quickstart Scenario 6.
8. Phase 8 (Polish) → quickstart Scenario 7, then the full run (T092).

### Incremental Delivery

Seven reviewable pull requests: Foundational; then one per user story; then Polish. Unlike spec 008,
there is no ADR PR ahead of Foundational. The US3 PR is the one worth the most review attention — it
is the shared kernel a second context will import verbatim, and a subtle DST bug there is a bug two
contexts inherit at once.
