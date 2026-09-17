---

description: "Task list for implementing the Tasks bounded context (spec 010)"
---

# Tasks: Tasks

**Input**: Design documents from `/specs/010-tasks/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/tasks-api.md](contracts/tasks-api.md),
[quickstart.md](quickstart.md). All present.

**No ADR gate.** plan.md's Constitution Check passes with no gating item. Nothing here blocks on a
merge outside this feature.

**Tests**: Included throughout, not optional. The constitution requires integration tests against a
real database and per-route authorization tests. This feature adds a third reason: its
characteristic failure is a duplicated or missing chore, which only concurrency and invariant tests
against PostgreSQL can catch.

**Organization**: Grouped by user story (spec.md P1–P5). Foundational builds Tasks' own schema and
unit of work, copying Calendar's pattern. **No task in this file edits anything under
`packages/core/src/family/` or `packages/core/src/calendar/`.** If implementation seems to need that,
stop: it is a design regression (plan.md, Structure Decision).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5, mapped to spec.md's priorities
- Every task names an exact file path

## Path Conventions

- `packages/kernel/src/`: branded ids, error kinds, and `recurrence/next-occurrence.ts` (the one kernel addition)
- `packages/core/src/tasks/{domain,application}/`: the bounded context
- `packages/contracts/src/v1/tasks.contract.ts`: the wire boundary (ADR-006)
- `packages/persistence/{prisma,src/repositories/tasks}/` and `packages/persistence/src/tasks-context.ts`
- `apps/api/src/tasks/`: controller, module, DI wiring (reuses spec 008's guards)
- `apps/worker/src/sweeps/report-overdue-tasks.sweep.ts`

Reference implementations to copy the shape of, one context over, are
`packages/core/src/calendar/`, `packages/persistence/src/calendar-context.ts`,
`packages/persistence/src/repositories/calendar/`, `apps/api/src/calendar/` and
`apps/worker/src/sweeps/materialise-occurrences.sweep.ts`.

---

## Phase 1: Setup

**Purpose**: the boundary rule in force before the code it governs exists.

- [X] T001 [P] Create `packages/core/src/tasks/index.ts` (empty barrel) and re-export it from
      `packages/core/src/index.ts` as `export * as tasks from './tasks/index.js';` alongside
      `calendar`, `family`, `identity` and `compliance`.
- [X] T002 [P] Add a `tasks-repositories-are-private` rule to `.dependency-cruiser.cjs`, forbidding
      anything outside `packages/persistence/` from importing
      `packages/persistence/src/repositories/tasks/`. Copy `calendar-repositories-are-private`
      exactly, citing FR-030 (spec 010) in its comment.

**Checkpoint**: `pnpm build` and `pnpm boundaries` pass with the empty namespace.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tasks' schema, RLS, scoped unit of work, ports, events, and test wiring.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Kernel primitives

- [X] T003 [P] Add `TaskId` and `TaskSeriesId` with `asTaskId` / `asTaskSeriesId` to
      `packages/kernel/src/branded-id.ts`, exported from `packages/kernel/src/index.ts`.
- [X] T004 [P] Add task error kinds to the `DomainError` union in `packages/kernel/src/errors.ts`:
      `InvalidDue` (carrying the field), `RecurrenceRequiresDue`, `AssigneeInvalid`,
      `InvalidTransition` (carrying `from` status and attempted `command`), and `VersionConflict`
      (carrying `currentVersion`). Reuse the existing `NotFound`, `CapabilityRequired`,
      `UnknownTimeZone`, `RecurrenceInvalid`, `RecurrenceUnsupported` and `RangeTooWide` kinds
      unchanged. Add a kind only if one of those is missing.

### Schema and row-level security (ADR-017, unchanged)

- [X] T005 Add the `Task` and `TaskAssignment` models and the `TaskStatus`, `TaskPriority`,
      `TaskCategory` and `TaskDueKind` enums to `packages/persistence/prisma/schema.prisma`, per
      [data-model.md](data-model.md): every column, `UNIQUE (id, family_id)` on `task`,
      `predecessor_id` unique with a self-FK `ON DELETE SET NULL`, `closed_at` as a generated stored
      column (`coalesce(completed_at, cancelled_at)`, raw SQL in T006 if Prisma cannot express it),
      and `version Int @default(1)`.
- [X] T006 Generate `packages/persistence/prisma/migrations/<timestamp>_tasks/migration.sql`, then
      hand-write into it: the `task_due_shape`, `task_recurrence_shape`, `task_status_shape` and
      `task_head_is_in_a_series` `CHECK` constraints; the composite FK
      `(task_id, family_id) REFERENCES task (id, family_id) ON DELETE CASCADE` on `task_assignment`;
      the FK from `task_assignment.member_id` to `family_member`; `ENABLE` **and**
      `FORCE ROW LEVEL SECURITY` with one `app.family_id` policy on each table; and DML grants to the
      existing `family_platform_app` role. Model the SQL on `20260915090000_calendar/migration.sql`.
- [X] T007 In the same migration, hand-write: the partial unique index
      `UNIQUE (series_id) WHERE is_series_head`; the open-list index
      `(family_id, due_at NULLS LAST, id) WHERE status = 'open'`; the history index
      `(family_id, closed_at) WHERE status <> 'open'`; the overdue-sweep partial index
      `(due_at) WHERE status = 'open' AND due_at IS NOT NULL AND overdue_reported_for IS DISTINCT FROM due_at`;
      `(member_id)` on `task_assignment`; and the SELECT-only `task_sweep_select` policy on `task`
      (`app.is_sweep`) and `task_assignment_erasure_select` policy on `task_assignment`
      (`app.is_erasure`), reusing the existing flags ([data-model.md](data-model.md), Row-level security).

### The scoped unit of work

- [X] T008 [P] Declare `TasksUnitOfWork` and `TasksUnitOfWorkPort` in
      `packages/core/src/tasks/application/ports/tasks-unit-of-work.port.ts`: `familyId`, `tasks`,
      `assignments`, `outbox`, `audit`, and `withTasksFamilyContext(familyId, work)`. Mirror
      `calendar-unit-of-work.port.ts`, with no repository method taking a family id.
- [X] T009 Implement `withTasksFamilyContext` in `packages/persistence/src/tasks-context.ts` (one
      `$transaction`, `set_config('app.family_id', …, true)` first, repositories constructed on that
      client) and export `createTasksUnitOfWork` from `packages/persistence/src/index.ts`. Copy
      `calendar-context.ts`.
- [X] T010 [P] Integration test `packages/persistence/src/tasks-context.integration.spec.ts`: with no
      context set, `task` and `task_assignment` return zero rows as the app role **and as the owner
      role** (proving `FORCE`); inside `withTasksFamilyContext` only that family's rows appear.
- [X] T011 [P] Integration test in `tasks-context.integration.spec.ts`: `set_config(…, true)` does not
      survive its transaction on a pooled connection.

### Ports and events

- [X] T012 [P] Declare `TaskRepository` and `TaskAssignmentRepository` in
      `packages/core/src/tasks/application/ports/task.repository.ts` and `task-assignment.repository.ts`.
      Include `findByIdForUpdate`, `insert`, `update(task, expectedVersion)`, `listOpen(filter, cursor, limit, visibleMemberIds)`,
      `listClosed(range, cursor, limit, visibleMemberIds)`, and on assignments `listForTask`,
      `add`, `remove`, `copy(fromTaskId, toTaskId)`.
- [X] T013 [P] Declare `TasksReadPort` in `packages/core/src/tasks/application/ports/tasks-read.port.ts`
      (open list, due range, history, single read, each taking a reader) for the later dashboard and
      AI read paths (§7.1).
- [X] T014 [P] Declare `ErasurePort` (`eraseForFamily`, `eraseForMember`) in
      `packages/core/src/tasks/application/ports/erasure.port.ts`, mirroring Calendar's.
- [X] T015 [P] Implement the six versioned event builders in `packages/core/src/tasks/domain/events.ts`
      (`TaskCreated`, `TaskAssigned`, `TaskUpdated`, `TaskCompleted`, `TaskCancelled`, `TaskOverdue`)
      with payloads exactly as [research.md §8](research.md), plus unit test
      `packages/core/src/tasks/domain/events.spec.ts` asserting each payload's key set, so a title or
      notes field added later fails the test (SC-011).

### Testing infrastructure and wiring

- [X] T016 [P] Add `packages/testing/src/tasks-factories.ts` (an undated task, a date-only task, a
      date-time task, a weekly recurring head, each seedable into a family from
      `family-factories.ts`), exported from `packages/testing/src/index.ts`. Reuse the fixed-clock
      helper and UK transition fixtures from `calendar-factories.ts` by import. Do not copy them.
- [X] T017 [P] Create `apps/api/src/tasks/test-support/household.ts` and
      `bootstrap-tasks-app.ts`, copying the Calendar versions: Ada (owner, guardian of Charlie), Grace
      (adult, not a guardian), Alan (extended), Viv (viewer), Charlie (child), and an outsider family.
- [X] T018 Create `apps/api/src/tasks/tasks.module.ts` and `tasks.tokens.ts`: clock, tasks unit of
      work, idempotency store, `MemberVisibilityPort`, reusing `FamilyMembershipGuard` and
      `CapabilityGuard` unchanged. Register `TasksModule` in `apps/api/src/app.module.ts`.
- [X] T019 Create `packages/contracts/src/v1/tasks.contract.ts` with the router skeleton and shared
      shapes from [contracts/tasks-api.md](contracts/tasks-api.md): the `Due` discriminated union
      (`timeZone` required on both arms), `TaskResponse`, `TaskPage` (no total), `CloseTaskResponse`,
      and every `task/*` problem type. Export from `packages/contracts/src/index.ts`. Routes are added
      by the story that owns them.

**Checkpoint**: T010–T011 pass. RLS is provably in force on both tables, and ports, events and
contract shapes compile.

---

## Phase 3: User Story 1 - Write down something that needs doing, and see what's still outstanding (Priority: P1) 🎯 MVP

**Goal**: a member records a task with an optional due date, priority and category, and it appears in
the family's open list.

**Independent Test**: create a task and list open tasks, confirming it comes back; a member of another
family sees nothing and gets 404 on the direct read.

### Tests for User Story 1

- [X] T020 [P] [US1] Unit test `packages/core/src/tasks/domain/due.spec.ts`: `date` due moment is
      the start of the next local day (`2026-09-30` London → `2026-09-30T23:00:00Z`;
      `2026-12-01` → `2026-12-02T00:00:00Z`); `date_time` resolves through the kernel's
      `localToInstant` including `01:30` on 2026-03-29 (→ `02:30` BST) and on 2026-10-25 (→ first,
      BST); invalid calendar date or time → `InvalidDue` naming the field; unknown zone →
      `UnknownTimeZone`.
- [X] T021 [P] [US1] Unit test `packages/core/src/tasks/domain/task.aggregate.spec.ts` (creation
      only): title 1–200 chars, notes ≤ 4,000, default priority `normal`, starts `open` at version 1,
      `due_kind: none` has no zone.
- [X] T022 [P] [US1] Integration test `apps/api/src/tasks/create-task.integration.spec.ts`:
      `POST …/tasks` returns 201 with correct `dueAt`; `422 task/unknown_time_zone`;
      `422 task/invalid_due`; a `date_time` due without `timeZone` fails contract validation; a
      replayed `Idempotency-Key` creates one row and returns an identical body; exactly one
      `TaskCreated` outbox row.
- [X] T023 [P] [US1] Integration test `apps/api/src/tasks/list-open-tasks.integration.spec.ts`:
      ordering by `due_at` ascending with undated last; no total count in the body; keyset cursor
      pages with `limit`; `dueFrom`/`dueTo` half-open, excluding undated tasks;
      `422 task/range_too_wide` over 400 days; `overdue=true`; `isOverdue: true` on a task due one
      minute before the fixed clock **without running any sweep** (FR-025); completed and cancelled
      rows seeded directly never appear.
- [X] T024 [P] [US1] Integration test `apps/api/src/tasks/capability.integration.spec.ts`: Viv
      (viewer) can `GET` but `POST …/tasks` is `403 task/capability_required`; Alan (extended)
      succeeds.
- [X] T025 [P] [US1] Integration test `apps/api/src/tasks/cross-family-access.integration.spec.ts`
      (seed for T095): the outsider gets `404 task/not_found` from the list and the direct read, with a
      body identical to a random UUID's.

### Implementation for User Story 1

- [X] T026 [US1] Implement `packages/core/src/tasks/domain/due.ts`: the `Due` union and
      `dueMomentOf(due)`, pure, using only `@fp/kernel/recurrence`'s `isValidTimeZone`,
      `parseLocalDate`, `addDays` and `localToInstant`.
- [X] T027 [US1] Implement `packages/core/src/tasks/domain/task.aggregate.ts` with creation, field
      invariants and `version`. Model status as a discriminated union from the start (open /
      completed with actor and time / cancelled with actor and time), but add only `create` in this
      story. Transitions are US3's.
- [X] T028 [P] [US1] Implement `isOverdue(task, now)` in `packages/core/src/tasks/domain/overdue.ts`.
- [X] T029 [US1] Implement `packages/persistence/src/repositories/tasks/task.repository.ts`: `insert`,
      `findById`, `listOpen` with keyset pagination over `(due_at NULLS LAST, id)`, and a
      `visibleMemberIds` parameter accepted but not yet applied (US2 applies it). Parse raw results
      per Principle II. No method takes a family id.
- [X] T030 [US1] Implement `createTask` in
      `packages/core/src/tasks/application/commands/create-task.command.ts`: validate via the
      aggregate, insert, and write a `TaskCreated` outbox row in one transaction.
- [X] T031 [P] [US1] Implement `listOpenTasks` in
      `packages/core/src/tasks/application/queries/list-open-tasks.query.ts` (filters, cursor, 400-day
      cap, `isOverdue` from the injected clock).
- [X] T032 [P] [US1] Implement `getTask` in `packages/core/src/tasks/application/queries/get-task.query.ts`.
- [X] T033 [US1] Add `POST …/tasks`, `GET …/tasks` and `GET …/tasks/:taskId` to
      `packages/contracts/src/v1/tasks.contract.ts`.
- [X] T034 [US1] Implement `apps/api/src/tasks/tasks.controller.ts` binding those routes with
      `@RequiresCapability('tasks:read' | 'tasks:write')`, the idempotent-response wrapper copied from
      `calendar.controller.ts`, and `NotFound` mapped to `task/not_found`.

**Checkpoint**: quickstart Scenario 1 passes. A task is recorded, listed in the right order, and
unreachable from another family.

---

## Phase 4: User Story 2 - Say whose job it is, including a child's (Priority: P2)

**Goal**: tasks carry family-member assignees, including children, and a task assigned to a child is
reachable only by that child's guardians.

**Independent Test**: assign an adult and a child. Both are stored as member references, and the task
is invisible, not forbidden, to a non-guardian.

### Tests for User Story 2

- [X] T035 [P] [US2] Unit test `packages/core/src/tasks/domain/task-assignment.spec.ts`: an
      assignment holds a `FamilyMemberId` and nothing else about the person; assigning an existing
      assignee is a no-op, not an error.
- [X] T036 [P] [US2] Integration test `apps/api/src/tasks/assignees.integration.spec.ts`:
      `POST …/tasks` with `assigneeIds` (max 20); `PUT …/assignees/:memberId` twice gives 200 twice and
      one `TaskAssigned`; `DELETE` of an absent assignee gives 200; unassigning leaves the task open;
      `?assignee=` filters; a foreign member id and a random UUID both give
      `422 task/assignee_invalid` with **byte-identical bodies**.
- [X] T037 [P] [US2] Integration test `apps/api/src/tasks/child-visibility.integration.spec.ts`,
      covering every row of the contract's guardian matrix. A non-guardian's open list omits the child's
      task, with `items.length` asserted numerically. `?assignee=<child>` for a non-guardian is 200 and
      empty. Direct read is 404, not 403. An owner non-guardian is denied and a viewer guardian is
      allowed. Guardianship granted then revoked flips 404 → 200 → 404 with no other change. A task
      with an adult and an unguarded child is hidden from that adult assignee. A non-guardian writer
      who assigns a child gets 200, then 404 on the next read.
- [X] T038 [P] [US2] Integration test `apps/api/src/tasks/child-audit.integration.spec.ts`: a
      guardian's direct read writes one `task_assignment.read` row per guarded child, `granted`,
      subject the child. A non-guardian's direct read writes one `denied` row with the real reason. A
      list read audits once per task returned, not per page. No audit `purpose` contains the title.

### Implementation for User Story 2

- [X] T039 [US2] Implement `packages/core/src/tasks/domain/task-assignment.ts`.
- [X] T040 [US2] Implement `packages/persistence/src/repositories/tasks/task-assignment.repository.ts`
      (`listForTask`, `add` with `ON CONFLICT DO NOTHING` reporting whether a row was inserted,
      `remove`, `copy`). Map the `member_id` FK violation to `AssigneeInvalid` without inspecting
      whether the member exists elsewhere.
- [X] T041 [US2] Implement `packages/core/src/tasks/application/visibility.ts`: `resolveVisibility`
      over `MemberVisibilityPort`, `hiddenAssignees`, `guardedChildAssignees`, and
      `auditChildAssignment` (action `task_assignment.read`, purpose by task id only). Model it on
      Calendar's `visibility.ts` **without importing it** ([research.md §1](research.md)).
- [X] T042 [US2] Apply the visible-set filter **in SQL** in `task.repository.ts`'s `listOpen`:
      `NOT EXISTS (SELECT 1 FROM task_assignment a WHERE a.task_id = t.id AND a.member_id <> ALL(:visibleMemberIds))`,
      plus the `assignee` filter. Bind the array as a parameter; do not interpolate it.
- [X] T043 [US2] Extend `getTask` and `listOpenTasks` to resolve visibility first, return `NotFound`
      for a hidden task, and audit guarded-child reads in the same transaction.
- [X] T044 [US2] Implement `assign-task.command.ts` and `unassign-task.command.ts` in
      `packages/core/src/tasks/application/commands/`: visibility check first (a hidden task is
      `NotFound`), then `TaskAssigned` only when a row was inserted, or `TaskUpdated{changed:['assignees']}`
      on removal. Extend `create-task.command.ts` to insert `assigneeIds` in the same transaction,
      emitting one `TaskAssigned` each.
- [X] T045 [US2] Add `PUT` and `DELETE …/tasks/:taskId/assignees/:memberId` and `assigneeIds` on
      create to `tasks.contract.ts`, and bind them in `tasks.controller.ts`.

**Checkpoint**: quickstart Scenario 2 passes, audit rows included.

---

## Phase 5: User Story 3 - Tick it off, call it off, or change your mind (Priority: P3)

**Goal**: the three-state lifecycle, edits on open tasks, optimistic concurrency, and history.

**Independent Test**: complete, reopen, cancel, and confirm terminal cancellation, actors,
`TaskCompleted`, and the history list.

### Tests for User Story 3

- [X] T046 [P] [US3] Unit test in `packages/core/src/tasks/domain/task.aggregate.spec.ts`: an
      exhaustive transition table (every status × every command) matching
      [data-model.md](data-model.md)'s lifecycle table; `InvalidTransition` carries `from` and
      `command`; editing a closed task is `InvalidTransition`; each change increments `version`; a
      completion records the acting member and time.
- [X] T047 [P] [US3] Integration test `apps/api/src/tasks/lifecycle.integration.spec.ts`: complete
      removes the task from the open list and writes `TaskCompleted`; a guardian completing a child's
      task is `completedByMemberId`; reopen clears completion fields and writes `TaskUpdated{status}`;
      cancel is `TaskCancelled{scope}`; reopen or complete on a cancelled task is
      `409 task/invalid_transition`; `GET …/tasks/history` returns closed tasks by `closed_at`
      descending with actors, capped at 400 days, filtered by visibility.
- [X] T048 [P] [US3] Integration test `apps/api/src/tasks/update-task.integration.spec.ts`: `PATCH`
      each field; a due change recomputes `dueAt`; `TaskUpdated.changed` lists the right groups;
      `due: null` clears it; `PATCH` on a completed task is 409 `invalid_transition`; a stale
      `expectedVersion` is `409 task/version_conflict` carrying only the current `version`.
- [X] T049 [P] [US3] Integration test `apps/api/src/tasks/concurrency.integration.spec.ts`: two
      completions in parallel at the same version give exactly one 200 and one 409, and one
      `TaskCompleted`. A **hidden** task with a stale `expectedVersion` gives 404, not 409
      (visibility before version).
- [X] T050 [P] [US3] Integration test `apps/api/src/tasks/idempotency.integration.spec.ts`: every
      mutating route (create, patch, complete, reopen, cancel, assign, unassign) replayed with the same
      key returns an identical body and writes no second outbox row.

### Implementation for User Story 3

- [X] T051 [US3] Add `complete(actor, now)`, `reopen()`, `cancel(actor, now, scope)` and
      `update(changes)` to `task.aggregate.ts`, with exhaustive switch handling over the status union.
- [X] T052 [US3] Add `findByIdForUpdate` (raw `SELECT … FOR UPDATE` in the persistence raw-query
      location Calendar's `calendar-event.repository.ts` uses) and `update(task, expectedVersion)`
      (`WHERE id = … AND version = …`, zero rows → `VersionConflict`) to `task.repository.ts`.
- [X] T053 [US3] Implement `complete-task.command.ts`, `reopen-task.command.ts` and
      `cancel-task.command.ts` in `packages/core/src/tasks/application/commands/`. Order: resolve
      visibility (hidden → `NotFound`), lock, check version, transition, update, outbox. Non-recurring
      path only in this story; return `{ task, successor: null }`.
- [X] T054 [US3] Implement `update-task.command.ts` with the same ordering, recomputing `due_at` via
      `due.ts`.
- [X] T055 [P] [US3] Implement `listClosed` in `task.repository.ts` (history index, visibility filter in
      SQL) and `list-task-history.query.ts` in `packages/core/src/tasks/application/queries/`.
- [X] T056 [US3] Add `PATCH …/tasks/:taskId`, `POST …/complete`, `…/reopen`, `…/cancel` and
      `GET …/tasks/history` to `tasks.contract.ts` (`expectedVersion` required in each body), and bind
      them in `tasks.controller.ts` with the idempotent wrapper.

**Checkpoint**: quickstart Scenario 3 passes, including the parallel-completion race.

---

## Phase 6: User Story 4 - Chores that come round again (Priority: P4)

**Goal**: recurring tasks spawn exactly one successor on closure, at the right local time, anchored to
the schedule.

**Independent Test**: complete a weekly Thursday 19:00 head the week before 25 October 2026. There is
exactly one successor, due 7 days plus one hour later in UTC, at 19:00 local.

### Tests for User Story 4

- [X] T057 [P] [US4] Unit test `packages/kernel/src/recurrence/next-occurrence.spec.ts`: weekly across
      2026-10-25 and 2026-03-29; `after` is exclusive; `COUNT=3` counted from `dtstart`, so the call
      after the third returns null; `UNTIL` in the past returns null; `FREQ=YEARLY;INTERVAL=4;BYMONTH=2;BYMONTHDAY=29`
      found years ahead in under 5 ms; a never-matching rule (`BYMONTH=2;BYMONTHDAY=30`) returns null
      within the `MAX_PERIODS` guard; a date-only series in `America/Santiago` keeps its local date
      across a midnight transition; identical results across two identical calls.
- [X] T058 [P] [US4] Unit test `packages/core/src/tasks/domain/successor.spec.ts`:
      `after = max(dueAt, closedAt)`; closing three weeks late produces the first date after `closedAt`
      with no backlog; closing early advances one scheduled date; all carried fields copied;
      `date` successors keep `due_kind: date`; moving only the head's due date leaves the anchor
      unchanged, so the successor is the next Thursday; a rule edit re-anchors; an ended rule gives no
      successor; a non-head gives no successor.
- [X] T059 [P] [US4] Integration test `apps/api/src/tasks/recurrence.integration.spec.ts`: create with
      `recurrenceRule` (new `seriesId`, `isSeriesHead: true`); complete returns `successor` with DST
      instants differing by 7 days plus 1 hour; `cancel {scope:'instance'}` spawns; `cancel {scope:'series'}`
      does not and the row stays head; `COUNT=2` gives no successor on the second close; reopen a former
      head and complete again gives `successor: null`; Friday rule due 2026-12-18 gives a successor due
      2026-12-25 unmoved; `FREQ=HOURLY` is `422 task/recurrence_unsupported`; a rule without a due is
      `422 task/recurrence_requires_due`; a rule edit on the head applies to its successor but not to
      earlier closed instances.
- [X] T060 [P] [US4] Integration test `apps/api/src/tasks/series-invariants.integration.spec.ts`:
      inside a family scope, a raw insert of a second successor for one predecessor fails on
      `UNIQUE (predecessor_id)`; setting a second head fails on the partial unique index; parallel
      completion of one head yields one successor row; an idempotent replay yields one successor row.
- [X] T061 [P] [US4] Integration test `apps/api/src/tasks/assignee-carry-forward.integration.spec.ts`:
      the successor copies assignees; unassigning on the successor leaves the predecessor's assignees
      intact; copied assignments write no `TaskAssigned`.

### Implementation for User Story 4

- [X] T062 [US4] Implement `nextOccurrenceAfter` in `packages/kernel/src/recurrence/next-occurrence.ts`
      over `expand`, stepping windows forward until an occurrence or `exhausted`. Re-export it with
      `NextOccurrenceInput` from `packages/kernel/src/recurrence/index.ts`. **Change no existing kernel
      file other than that index.**
- [X] T063 [US4] Implement `packages/core/src/tasks/domain/successor.ts`: pure
      `successorOf(head, closedAt)` returning the new task's props or null, per
      [data-model.md](data-model.md)'s successor rule.
- [X] T064 [US4] Extend `task.aggregate.ts` with `recurrenceRule` (a parsed kernel `RecurrenceRule`),
      `recurrenceAnchor`, `seriesId` and `isSeriesHead`. Adding a rule allocates a series and makes the
      task head, anchored on its due. Editing the rule re-anchors. Removing it clears the rule and head
      flag while keeping `seriesId`. A rule with `due_kind: none` is `RecurrenceRequiresDue`.
- [X] T065 [US4] In `task.repository.ts`, add `handOverHead(predecessor, successor)`: clear the
      predecessor's `is_series_head`, **then** insert the successor, in the caller's transaction. Map a
      unique violation on either index to a typed internal error that is never silently swallowed.
- [X] T066 [US4] Extend `complete-task.command.ts` and `cancel-task.command.ts`: when the task is head
      and the scope is not `series`, call `successorOf`. If non-null, `handOverHead`, copy assignments,
      and write `TaskCreated{predecessorId, seriesId}`, all in the closing transaction. Return the
      successor.
- [X] T067 [US4] Extend `create-task.command.ts` and `update-task.command.ts` for `recurrenceRule`
      (parse via the kernel, mapping to `recurrence_invalid` / `recurrence_unsupported`).
- [X] T068 [US4] Add `recurrenceRule` on create and `PATCH`, `seriesId` / `isSeriesHead` /
      `predecessorId` on `TaskResponse`, and a non-null `successor` in `CloseTaskResponse` to
      `tasks.contract.ts`, and update `tasks.controller.ts`.

**Checkpoint**: quickstart Scenarios 4 and 5 pass on the 25 October transition.

---

## Phase 7: User Story 5 - Overdue things get noticed without anyone looking (Priority: P5)

**Goal**: a worker sweep publishes `TaskOverdue` exactly once per due moment, re-armed by a due change,
with observable lag.

**Independent Test**: with a moved clock, run the sweep twice past a due moment and get one
`TaskOverdue`. Re-date the task, pass the new due, and get a second.

### Tests for User Story 5

- [X] T069 [P] [US5] Unit test `packages/core/src/tasks/domain/overdue.spec.ts`: `needsOverdueReport`
      is true for open with `due_at <= now` and marker distinct; false when marker equals `due_at`,
      when closed, when undated, or when `due_at > now`.
- [X] T070 [P] [US5] Integration test
      `apps/worker/src/sweeps/report-overdue-tasks.sweep.integration.spec.ts`. A date-only 2026-09-16
      London task is not reported at `2026-09-16T22:30Z` and is reported at `23:30Z`. Two runs give one
      outbox row with payload keys exactly `familyId, taskId, dueAt`. Re-dating then passing the new due
      gives a second row. A task completed before its due is never reported. Fifty overdue tasks with
      the pass aborted partway (inject a throwing hook after N) and re-run give exactly fifty rows. A
      task completed between discovery and write is skipped. The result's lag is 0 after a clean pass
      and positive when a failure is injected.

### Implementation for User Story 5

- [X] T071 [US5] Implement `needsOverdueReport(task, now)` in `packages/core/src/tasks/domain/overdue.ts`.
- [X] T072 [US5] Implement `report-overdue.command.ts` in
      `packages/core/src/tasks/application/commands/`: inside `withTasksFamilyContext`, lock the task,
      re-check `needsOverdueReport`, set `overdue_reported_for = due_at`, and write `TaskOverdue`.
      Return `reported | skipped`.
- [X] T073 [US5] Implement `packages/persistence/src/repositories/tasks/overdue-sweep.ts`:
      `findTasksNeedingOverdueReport(now)` (read-only transaction with `app.is_sweep`, ordered by
      `due_at`, using the partial index, identifiers only) and `measureOverdueLag(now)`. Export both
      from `packages/persistence/src/index.ts`.
- [X] T074 [US5] Implement `apps/worker/src/sweeps/report-overdue-tasks.sweep.ts` in the shape of
      `materialise-occurrences.sweep.ts`: one transaction per task, failures collected not thrown, lag
      measured after the pass, a structured `ALERT` line above a threshold, identifiers and numbers
      only.
- [X] T075 [US5] Call the sweep from `apps/worker/src/sweep-retention.ts` and add spec 010 to its doc
      comment. Phase 8 moves this call into the shared registry.

**Checkpoint**: quickstart Scenario 6 passes.

---

## Phase 8: Background work runs on its own (platform, FR-037, FR-038)

**Goal**: every sweep, the six from earlier specs plus overdue detection, runs automatically on its own
cadence in the worker, locally and on staging, with a stalled schedule made visible.

**Independent Test**: `docker compose up`, invoke nothing, and see one `worker_sweep_run … succeeded`
line per sweep within about a minute; a task due in two minutes gets a `TaskOverdue` row within three.

**Why a phase and not a story**: it serves no single user journey. It is the platform gap planning
found ([research.md §6](research.md)). It needs US5's sweep for T078, T080, T081 and T084, but nothing else in
Tasks, and it can be built and reviewed as its own pull request.

### Tests for Phase 8

- [X] T076 [P] Unit test `apps/worker/src/scheduler/scheduler.spec.ts` with fake timers and an
      injected clock. A registered sweep runs once shortly after `start()` and then at its cadence. A
      run longer than its cadence causes the next tick to be skipped and logged `skipped_overlap`,
      never run concurrently. A throwing sweep logs `failed` and neither stops other sweeps nor its own
      next tick. `stop()` stops new ticks and awaits in-flight runs up to the deadline. The heartbeat
      file is rewritten after every tick. `ALERT sweep_stalled` is emitted once a sweep's last success
      is older than 3× its cadence, and clears after a success. Log lines carry names, outcomes,
      durations and a correlation id only.
- [X] T077 [P] Unit test `apps/worker/src/config/worker-env.spec.ts`: each
      `SWEEP_<NAME>_INTERVAL_SECONDS` defaults per [research.md §6](research.md); `0`, negative and
      non-numeric values fail parsing with the variable named; the heartbeat path defaults sensibly.
- [X] T078 [P] Integration test `apps/worker/src/scheduler/scheduled-sweeps.integration.spec.ts`
      against the real database. Start the scheduler from `registry.ts` with the overdue cadence at 1 s
      and the rest at 1 h. A task whose due moment is already past gets a `TaskOverdue` outbox row
      within 3 s with no manual invocation. Every registered sweep has logged at least one `succeeded`
      run. `stop()` returns cleanly and the database disconnects.
- [X] T079 [P] Unit test in `infrastructure/src/deploy.spec.ts`: the deploy script's `up -d` names
      `worker`; the script loads the worker tarball; and `docker-compose.staging.yml`'s worker `image:`
      equals `image.ts`'s `WORKER_RUNTIME_IMAGE_TAG`, read from both files, closing the "no shared
      source of truth" hazard that file's header warns about.

### Implementation for Phase 8

- [X] T080 Create `apps/worker/src/sweeps/registry.ts`: one exported list of
      `{ name, defaultCadenceSeconds, run(clock) }` for all seven sweeps (`erase-unverified`,
      `erase-deleted-accounts`, `erase-stale-sessions`, `expire-invitations`, `guardian-coverage`,
      `materialise-occurrences`, `report-overdue-tasks`), with each `run` returning a one-line summary
      string built from its existing result type.
- [X] T081 Refactor `apps/worker/src/sweep-retention.ts` to iterate `registry.ts` in order, keeping
      `--as-of` and its output. Replace the "no in-process scheduler is wired up" paragraph with a
      pointer to the scheduler. Every existing `apps/worker/src/sweeps/*.integration.spec.ts` must pass
      unmodified.
- [X] T082 [P] Implement `apps/worker/src/config/worker-env.ts`: a Zod schema over `process.env` for
      the seven cadences and `WORKER_HEARTBEAT_PATH`, parsed once at boot, failing the process on
      invalid input (Principle II).
- [X] T083 Implement `apps/worker/src/scheduler/scheduler.ts` with no new dependency, per
      [research.md §6](research.md)'s design table: per-sweep `setTimeout` chain with a jittered first
      run; in-flight flag for no overlap; try/catch isolation with correlation ids; `worker_sweep_run`
      structured lines; heartbeat write after each tick; in-memory last-success tracking with
      `ALERT sweep_stalled`; `start()` and `stop(deadlineMs)`.
- [X] T084 Update `apps/worker/src/main.ts`: parse `worker-env.ts`, build the scheduler from
      `registry.ts` with `SystemClock`, start it after the NestJS context is created, and on
      `SIGTERM`/`SIGINT` call `stop(25_000)`, then `disconnectDatabase()`, then close the context.
      Update its comment: the worker now runs scheduled sweeps; queue consumers arrive with spec 011.
- [X] T085 Add a `HEALTHCHECK` to the `runtime` stage of `apps/worker/Dockerfile` that fails when
      `WORKER_HEARTBEAT_PATH`'s mtime is older than 180 s, and a matching `healthcheck:` on the `worker`
      service in `docker-compose.yml` so local development shows the same health.
- [X] T086 In `infrastructure/src/image.ts`, build the worker's `runtime` target as
      `WORKER_RUNTIME_IMAGE_TAG = 'fp-worker:staging-runtime'`, exported to `WORKER_RUNTIME_TARBALL_NAME =
      'fp-worker-runtime.tar'`, and add `worker` to `StagingImages`, mirroring the api runtime build.
- [X] T087 In `infrastructure/src/transfer.ts`, transfer the worker tarball with its digest dependency.
      In `infrastructure/src/deploy.ts`, `docker load` it, add its digest to the deploy resource's
      `triggers`, and change `up -d postgres api mailpit` to `up -d postgres api mailpit worker`.
      Replace the #29 comment explaining the worker's absence with one line saying the worker now ships
      its own runtime image.
- [X] T088 Add a `worker` override to `docker-compose.staging.yml`: `image: fp-worker:staging-runtime`,
      `build: !reset null`, the `staging` network, and the same application-role `DATABASE_URL`
      construction the `api` override uses (never the owner role, ADR-017). Add the cadence variables,
      at defaults, to `docker-compose.staging.env`.
- [X] T089 [P] Update `docs/staging-environment.md` (the worker is deployed; reading
      `worker_sweep_run` lines and `docker ps` health over SSH; what `ALERT sweep_stalled` means) and
      `docs/local-development.md` (sweeps run on their own; `sweep-retention.js --as-of` remains for
      moving the clock).

**Checkpoint**: quickstart Scenario 10 passes locally, and on staging after `pulumi up` on
`vps-staging` with the preview attached to the pull request (Principle X).

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T090 Implement `eraseTasksForFamily` and `eraseTasksForMember` in
      `packages/persistence/src/repositories/tasks/erasure.ts` and `createTasksErasurePort` in
      `packages/persistence/src/index.ts`. Add `erasure.integration.spec.ts` beside it: after family
      erasure no `task` or `task_assignment` row references the family; after member erasure no
      assignment references the member, actor columns hold the tombstone, and tasks, including a
      series chain, survive with titles untouched.
- [X] T091 [P] Add `apps/api/src/tasks/no-personal-data-in-telemetry.integration.spec.ts`, copying
      Calendar's: exercise create, patch, complete (with successor), history, the child-visibility
      paths and the overdue sweep, and assert no title or notes value in any log line, audit
      `purpose`, span attribute or outbox payload (SC-011).
- [X] T092 [P] Add `packages/core/src/tasks/reads-family-only-through-published-ports.spec.ts`, copying
      Calendar's AST test: imports under `core/family` only name `family-context.port.js` and
      `member-visibility.port.js`, and **no import in `packages/core/src/tasks` resolves under
      `core/calendar`** (FR-012, SC-010).
- [X] T093 [P] Extend `packages/kernel/src/recurrence/purity.spec.ts` so its import and determinism
      assertions cover `next-occurrence.ts`, and confirm `packages/kernel/package.json` gained no
      dependency.
- [X] T094 [P] Confirm `apps/api/src/family/checks-capabilities-not-roles.spec.ts` scans
      `apps/api/src/tasks/` and `packages/core/src/tasks/`. If its globs are Family- or Calendar-only,
      widen them.
- [X] T095 Complete `apps/api/src/tasks/cross-family-access.integration.spec.ts` with all ten routes,
      asserting `404 task/not_found` bodies identical to a missing task's, and that the route list equals
      `tasksContract`'s registered routes (SC-003).
- [X] T096 [P] Emit the observability signals from [contracts/tasks-api.md](contracts/tasks-api.md)
      not already covered (`tasks_list_duration`, `tasks_successor_spawned_total`,
      `tasks_transition_conflict_total`, `tasks_child_assignment_read_total`) as structured log lines
      in `apps/api/src/tasks/tasks.controller.ts` and the command handlers, per the platform's existing
      convention.
- [X] T097 [P] Apply rate limits in `apps/api/src/tasks/tasks.module.ts` via `PerUserThrottlerGuard`:
      120 per user per minute on both lists, and 120 per user per hour on `POST …/tasks`.
- [X] T098 [P] Update `ARCHITECTURE.md` §5.4's **Publishes** line to add `TaskUpdated` and
      `TaskCancelled` ([research.md §8](research.md)).
- [ ] T099 Run `pnpm verify` (typecheck, lint, boundaries, unit, integration, format, build), then all
      ten [quickstart.md](quickstart.md) scenarios against a fresh `docker compose up`, and Scenario 10's
      staging half after deploy. Scenarios 8, 9 and 10 cannot be inferred from a green pipeline.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none. T001 and T002 run in parallel.
- **Foundational (Phase 2)**: depends on Setup and blocks all stories. T005 → T006 → T007 are one
  migration, in order. T009 depends on T005–T008. T010–T011 depend on T009. T017–T019 depend on T008,
  T012 and T015.
- **User Stories (Phases 3–7)**: all depend on Foundational.
- **Background work (Phase 8)**: the scheduler itself (T076–T077, T082–T083) and the staging deploy
  (T079, T085–T089) depend on nothing in Tasks and can start right after Setup. T078, T080, T081 and
  T084 need US5's sweep (T074).
- **Polish (Phase 9)**: depends on all stories and Phase 8. T095 needs every route to exist.

### User Story Dependencies

- **US1**: no story dependency.
- **US2**: extends US1's queries and create command with visibility and assignees.
- **US3**: extends US1's aggregate and repository. Its commands must apply US2's visibility-before-version
  ordering, so it is written after US2.
- **US4**: needs US3's close commands to extend with successor spawning. **T057 and T062 (the kernel
  function) depend on nothing in this feature** and can be built in parallel with US1–US3.
- **US5**: needs only US1's `due_at` and Foundational's index. It can run in parallel with US2–US4 once
  US1 lands, touching only `overdue.ts`, a new command, a new persistence file and the worker.

### Relationship to spec 011 (event relay)

None of these tasks builds or depends on the relay. Outbox rows are written and stay unpublished until
spec 011, which is gated on [ADR-018](../../adr/ADR-018-stage-0-event-transport.md) being accepted.
Phase 8's scheduler is what spec 011's relay loop will run inside, so building it here removes work
from 011, not the reverse.

### Within Each User Story

- Tests are written first and MUST fail before implementation.
- Domain → application → persistence → contract → controller.

### Parallel Opportunities

- Foundational: T003–T004; T008 and T012–T016; T017 once T008 exists.
- Every story's test block is parallel within itself.
- The kernel pair **T057 + T062** alongside US1–US3.
- **US5 (T069–T075)** alongside US2–US4 after US1.
- **Phase 8's scheduler and staging deploy (T076–T077, T079, T082–T083, T085–T089)** alongside
  everything from Setup onward.
- Polish: T091–T094 and T096–T098.

---

## Parallel Example: Foundational

```bash
Task: "Add TaskId, TaskSeriesId in packages/kernel/src/branded-id.ts"
Task: "Add task error kinds in packages/kernel/src/errors.ts"
Task: "Declare repository ports in packages/core/src/tasks/application/ports/"
Task: "Implement six event builders in packages/core/src/tasks/domain/events.ts"
Task: "Add task factories in packages/testing/src/tasks-factories.ts"
```

## Parallel Example: four branches after US1

```bash
# Branch A: US2 then US3 (visibility, then lifecycle)
Task: "Implement packages/core/src/tasks/application/visibility.ts"

# Branch B: the kernel function, independent of the context entirely
Task: "Test and implement nextOccurrenceAfter in packages/kernel/src/recurrence/next-occurrence.ts"

# Branch C: US5, overdue detection
Task: "Implement apps/worker/src/sweeps/report-overdue-tasks.sweep.ts"

# Branch D: Phase 8, the scheduler and the worker on staging
Task: "Implement apps/worker/src/scheduler/scheduler.ts"
Task: "Build and deploy the worker runtime image in infrastructure/src/image.ts and deploy.ts"
```

---

## Implementation Strategy

### MVP: User Story 1 alone

A task is recorded, listed in due order, and invisible to other families. Worth reviewing before
assignees, lifecycle and recurrence are layered on.

1. Phase 1 → Phase 2. **STOP and VALIDATE**: quickstart Scenario 8's RLS half. If the owner-role
   check does not return zero, nothing built afterwards is isolated.
2. Phase 3 (US1) → Scenario 1.
3. Phase 4 (US2) → Scenario 2. The privacy promise in a third context; review it with full weight.
4. Phase 5 (US3) → Scenario 3, including the race.
5. Phase 6 (US4) → Scenarios 4, 5 and Scenario 8's invariant half. **The PR most worth careful
   review**: it touches the shared kernel and owns the duplicated- or missing-chore failure.
6. Phase 7 (US5) → Scenario 6.
7. Phase 8 → Scenario 10, locally and on staging.
8. Phase 9 → Scenarios 7 and 9, then T099.

### Incremental Delivery

Eight reviewable pull requests: Foundational, one per story, background work, Polish. Two can ship
early and on their own because they change nothing existing that Tasks needs: the kernel function
(T057, T062), and Phase 8's scheduler with the staging deploy. The scheduler PR is worth landing first:
the calendar horizon and account erasure have never run on their own, and it fixes that without
waiting for Tasks.
