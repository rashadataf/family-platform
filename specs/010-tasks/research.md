# Phase 0 Research: Tasks

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-09-15

Eleven decisions. Three settle what the spec left open by design: how a successor's due date is
computed from the kernel (§2), how "exactly one successor, exactly one head" is enforced (§3), and
how overdue detection is exactly-once without per-task scheduling (§5). The rest follow from those
or restate a Calendar decision that Tasks inherits unchanged.

The spec records three product decisions under "Decisions Taken While Specifying" (holidays
deferred, schedule-anchored successors, overdue as a condition). They are not re-argued here; this
document makes them buildable.

---

## 1. Visibility: reuse `MemberVisibilityPort`, change nothing in Family

**Decision: Tasks consumes the `MemberVisibilityPort` spec 009 published, exactly as Calendar
does. There is no change to the Family context.**

FR-014 is Calendar's FR-016 applied to assignees, and the port was designed for "does this record
involve anyone outside my visible set", which needs no notion of who is a child. That question is
exactly the one Tasks asks. The port returns `visibleMemberIds` and `guardedChildIds`
([`member-visibility.port.ts`](../../packages/core/src/family/application/ports/member-visibility.port.ts)),
which covers both the filter and the audit (FR-015).

**The filter goes in the query, as in Calendar.** Every list uses
`NOT EXISTS (assignment WHERE member_id <> ALL(:visibleMemberIds))`. Filtering after fetching would
let a page's size reveal hidden tasks, which the spec's edge case on list counts forbids.

**The three helper functions are not shared with Calendar.** `core/calendar/application/visibility.ts`
holds `hiddenParticipants`, `guardedChildParticipants` and `auditChildParticipation`. Tasks needs the
same three with a different audit action (`task_assignment.read`) and subject wording. Importing
them from Calendar is forbidden by the spec's own FR-012 and by `no-cross-context-internals`.
Hoisting them into the Family port file would make the Family context own an audit-writing helper
for other contexts' records, which is the wrong owner. That leaves about forty lines, most of them
comments, in `core/tasks/application/visibility.ts`. The *rule* is not duplicated: it lives behind
the port, and both files are set-membership filters over its answer. This is the cheapest option and
the correct one, and it is recorded so a reviewer does not "fix" it into a cross-context import.

**Enforced by** a copy of Calendar's AST discipline test,
`packages/core/src/tasks/reads-family-only-through-published-ports.spec.ts`. It asserts Tasks'
imports from `core/family` name only `family-context.port.js` and `member-visibility.port.js`, and
**that Tasks has no import from `core/calendar` at all** (FR-012, SC-010).

---

## 2. Computing a successor's due date from the kernel

**Decision: add one pure, additive function to `@fp/kernel/recurrence`, `nextOccurrenceAfter`,
built on the existing `expand`, and call nothing else.**

```ts
export interface NextOccurrenceInput {
  readonly rule: RecurrenceRule;
  readonly dtstart: LocalDateTime;   // the series anchor, not the current instance (see below)
  readonly timeZone: string;
  readonly after: Date;              // exclusive
}
export function nextOccurrenceAfter(
  input: NextOccurrenceInput,
): Result<ExpandedOccurrence | null, DomainError>;   // null: the rule has ended
```

**Why not call `expand` directly from Tasks.** `expand` takes a window, and "the first occurrence
after T" has no natural window. A weekly rule needs 7 days, and `FREQ=YEARLY;INTERVAL=4;BYMONTH=2;BYMONTHDAY=29`
needs up to 8 years. The caller has to step windows forward until it finds one or the expansion
reports `exhausted`. That loop has edge cases (window boundaries on DST mornings, the `MAX_PERIODS`
guard, rules that can never match), and it belongs under the kernel's exhaustive tests rather than
inside a context. FR-018 permits exactly this: additive, pure, no I/O, no clock. Reminders will need
the same function for "the next occurrence of a rule after now", which is the kernel's reason to
exist.

**The `after` instant is `max(closedInstance.dueAt, closedAt)`**, per the spec's second decision
and FR-021. Late closure therefore skips past missed dates without creating them, and early closure
advances by exactly one scheduled date.

**The anchor (`dtstart`) is the series', not the instance's.** `expand` counts `COUNT` from DTSTART
([expand.ts](../../packages/kernel/src/recurrence/expand.ts), "COUNT is counted from DTSTART, not
from the window"). An instance that anchored on itself would restart `COUNT=10` on every completion
and never end. So each task row carries `recurrence_anchor`, the local date-time the rule is counted
from, copied unchanged to the successor. It is reset to the current instance's due only when the
**rule itself** is edited (FR-010): a new rule is a new series pattern, and counting it from when it
was introduced is the only reading a user could predict.

**Moving one instance's due date does not re-anchor**, which is what makes the bank-holiday edge case
in the spec work. Bins moved from Thursday to Friday are due Friday this week, and the successor is
the first *Thursday* after Friday. No holiday data is needed for that.

**Date-only due dates** expand with `dtstart` at local midnight and read back `local`'s date, ignoring
the instant. Local midnight can in principle fall in a spring-forward gap in some zones (not
Europe/London). The kernel's `compatible` rule shifts it forward within the same date, so the date
read back is unaffected. A unit test pins this with a zone whose transition is at midnight
(`America/Santiago`).

**Alternatives considered**

| Alternative | Rejected because |
|---|---|
| Tasks steps `expand` windows itself | Puts the kernel's hardest loop outside the kernel's tests, and Reminders would write it a second time |
| Anchor on the current instance | Breaks `COUNT` (it restarts on every instance and never ends), and makes a one-off due-date move permanently shift the series |
| Materialise future instances as Calendar does | Explicitly rejected by the architecture for Tasks, and makes "complete this week's" a question about which of many open rows to close |

---

## 3. Exactly one successor, exactly one head, under retries and races

**Decision: the database enforces both invariants with unique indexes, and the domain transition runs
under a row lock plus an optimistic version.**

| Invariant | Enforcement |
|---|---|
| At most one successor per instance (FR-022) | `predecessor_id uuid NULL UNIQUE` |
| Exactly one head per series (FR-019, SC-006) | `is_series_head boolean`, partial `UNIQUE (series_id) WHERE is_series_head` |
| Closed without its successor is never observable (FR-020) | Close, spawn and head hand-over happen in one transaction |

The transaction for completing a recurring head:

1. `SELECT … FOR UPDATE` the task (Calendar's `calendar-event.repository.ts` pattern; RLS applies to
   the lock).
2. Check `version` equals the request's `expectedVersion`. If not, `409 task/version_conflict`.
3. Domain transition `open → completed`. Invalid transitions return `409 task/invalid_transition`.
4. If `is_series_head` and not stopping: `nextOccurrenceAfter`. If non-null, first clear the head
   flag on this row, then insert the successor with `predecessor_id = this.id` and
   `is_series_head = true`. Partial unique indexes are checked per statement, so the order matters.
   If null, the series has ended and this row stays its (closed) head.
5. Outbox rows for `TaskCompleted` and, when spawned, `TaskCreated` (with `predecessorId`).
6. `version += 1`. Commit.

**Why both a lock and a version.** The lock serialises two simultaneous completions, so the second
sees `completed` and gets `invalid_transition`. The version catches the slower race: a member who
loaded the task, then another member edits the due date, then the first member completes against
what they last saw. Without the version that completion succeeds against a due date the completer
never saw, and the successor is computed from it. The unique indexes are the backstop that makes a
bug a failed transaction rather than a duplicate chore.

**Reopen (FR-008) does not touch the head.** Reopening a closed former head clears
`completed_at`/`completed_by` and sets `status = open`. `is_series_head` stays false, and
`predecessor_id` uniqueness means completing it again cannot insert a second successor. The domain
checks "am I the head" before spawning, so the unique index is never the thing that rejects a normal
user action.

**Reopening the current head** of an ended series (its rule produced nothing) is allowed. It is an
ordinary reopen, and completing it again runs `nextOccurrenceAfter` again, which still returns null.

**Idempotency** is layered on top by the existing `IdempotencyPort`: a retried request with the same
key returns the stored response and never reaches step 1.

---

## 4. Storing a due date: a discriminated union plus one derived instant

**Decision: `due_kind` of `none | date | date_time`, the authored values in their own columns, and a
derived `due_at timestamptz` holding the due moment for all non-`none` tasks.**

| `due_kind` | Authored | `due_at` (derived) |
|---|---|---|
| `none` | nothing; `time_zone` null | null |
| `date` | `due_date date`, `time_zone` | start of the *next* local day in `time_zone`, the end of the due date (FR-003) |
| `date_time` | `due_local_time time`, `due_date`, `time_zone` | the local date-time resolved by the kernel's `localToInstant` |

A `CHECK` constraint makes the combinations unrepresentable, as Calendar's `event_shape` does.

**Why store authored local values rather than only the instant.** A date-only due date must stay that
date for a reader in any zone (the spec's edge case). A date-time due must survive a tzdata update
that moves an offset. Recomputing `due_at` from authored local values is always possible, and the
reverse is not.

**Why a derived `due_at` at all.** Every hot query uses it: the open list's ordering, the due-range
filter, the overdue read, and the overdue sweep's index. It is written by the domain whenever due
date, time or zone change, so it never drifts. Recomputing it on read would put time-zone arithmetic
into SQL.

**Overdue reads use `due_at <= now()` directly**, with `now` from the injected clock. A task reads as
overdue the moment its due passes, whether or not the sweep has run, because FR-025 makes overdue a
condition. The sweep's job is only publishing (§5).

---

## 5. Overdue detection: a marker, not a schedule

**Decision: a column `overdue_reported_for timestamptz NULL` and a worker sweep that publishes
`TaskOverdue` for open tasks where `due_at <= now AND overdue_reported_for IS DISTINCT FROM due_at`,
setting the marker to `due_at` in the same transaction as the outbox row.**

**This gives every FR-027 property as a consequence of the design:**

| Property | Why it holds |
|---|---|
| Once per due moment | After publishing, the marker equals `due_at` and the predicate is false |
| Re-armed by a due change | Changing `due_at` makes the marker distinct again |
| Replayable, interrupt-safe | Each task is its own family-scoped transaction; an interrupted pass leaves unprocessed rows matching the predicate, and processed rows not matching it |
| Testable by moving a clock | `now` is the sweep's `Clock`, the same `--as-of` mechanism `sweep-retention.ts` already offers |
| Never for closed or undated tasks | `status = 'open'` and `due_at IS NOT NULL` are in the predicate |

**The predicate is indexed.** A partial index on
`(due_at) WHERE status = 'open' AND overdue_reported_for IS DISTINCT FROM due_at` keeps the sweep's
discovery read proportional to the work outstanding, not to the table. `IS DISTINCT FROM` between two
columns is immutable and therefore allowed in a partial index predicate. Once a task is reported it
drops out of the index, so a household with years of history costs the sweep nothing.

**Discovery and write follow Calendar's sweep shape exactly.** Cross-family discovery runs in a
read-only transaction with `app.is_sweep` set, gated by a `task_sweep_select` policy. Each write runs
under `withTasksFamilyContext` for that one task, re-checking the predicate under `FOR UPDATE`, so a
task completed between discovery and write is skipped rather than reported.

**Observability (FR-028).** The lag is `now − min(due_at)` over rows still matching the predicate
*after* the pass. If the sweep is healthy this is at most one cadence. Growth means the sweep is not
running or is failing. It is emitted as a structured `ALERT` line above a threshold, the convention
`guardian-coverage.sweep.ts` and the materialisation sweep set on a platform with no metrics pipeline
yet.

**Rejected: per-task timers or delayed messages.** ADR-005 rejects them for reminders with reasons
that apply identically here: not inspectable, not replayable, and "why did this fire" is unanswerable.

**Rejected: a separate `overdue_report` table.** It would record history nobody reads yet. Reminders
will keep its own `ScheduledReminder` rows as the record of what a family was told, and the outbox
row is already the record that `TaskOverdue` was published.

---

## 6. Running background work on its own: an in-process scheduler in the worker

**Decision: the worker process runs every sweep itself, on a per-sweep cadence, with an in-house
scheduler of about a hundred lines. The worker is deployed to staging for the first time.**

### What was actually missing

Before this feature, **no sweep ran automatically anywhere.** `apps/worker/src/main.ts` boots an empty
NestJS context and does nothing. The six existing sweeps run only when someone executes
`sweep-retention.ts`. On staging the worker is not deployed at all: #29 removed it from the deploy
because "its WorkerModule is currently an empty DI context with no queue consumer or scheduled sweep".
So unverified-account erasure, stale-session erasure, invitation expiry and the calendar horizon (all
specified as running on their own) have never run on their own. The calendar horizon in particular
silently stops extending about 400 days after each event's creation.

Overdue detection makes this impossible to leave: SC-012 requires reporting within 5 minutes.

### Why this needs no ADR and no new infrastructure decision

`sweep-retention.ts` said that choosing where recurring invocation lives "is an infrastructure
decision … [that] belongs to spec 003's deployment domain". That is true of *external* schedulers (a
VPS crontab, a systemd timer, EventBridge Scheduler), each of which is a new piece of infrastructure.
It is not true of the choice made here:

- [ADR-002](../../adr/ADR-002-modular-monolith.md) already scopes the worker to "queue consumers and
  scheduled sweeps" (`main.ts`'s own comment).
- [ADR-005](../../adr/ADR-005-event-system.md) already decides that sweeps run "on a fixed cadence" as a
  "worker sweep". The only unmade decision was who ticks the clock, and the long-running process
  ADR-002 created is the obvious answer.
- [ADR-013](../../adr/ADR-013-staged-hosting-model.md) defines Stage 0 as "the deployed equivalent of
  the existing Docker Compose service set". The worker is in that set, so deploying it corrects a gap
  rather than extending the topology. The change goes through the Pulumi program with a preview, per
  Principle X.

### Design

| Concern | Decision |
|---|---|
| Registry | One list, `apps/worker/src/sweeps/registry.ts`: `{ name, defaultCadenceSeconds, run(clock) }` for all seven sweeps, the six existing ones plus this feature's. `sweep-retention.ts` (manual, `--as-of`) and the scheduler both iterate it, so they cannot drift |
| Cadence | Validated worker config at boot (Principle II), defaults: `report-overdue-tasks` 60 s; `materialise-occurrences` 1 h; `erase-unverified`, `erase-deleted-accounts`, `erase-stale-sessions`, `expire-invitations` 1 h; `guardian-coverage` 24 h. 0, negative or non-numeric values fail boot |
| No overlap | A sweep still running at its next tick is skipped, and the skip is logged. It is never run twice concurrently in one process (FR-037) |
| Failure isolation | Each run is wrapped. A throw is logged with a correlation id and the next tick retries. One sweep failing never stops another (FR-037) |
| First run | Each sweep runs once shortly after boot (a jittered few seconds), not only after its first full interval, so a deploy does not postpone a daily sweep by a day (SC-013) |
| Shutdown | `SIGTERM`/`SIGINT` stop new ticks and await in-flight runs up to 25 s (inside Docker's default 30 s grace), then disconnect the database. Every sweep is idempotent, so an abandoned run is resumed by the next process (FR-037) |
| Liveness | After every tick the scheduler writes a heartbeat file. The runtime image's `HEALTHCHECK` fails when it is older than 3 minutes, so Docker's restart policy recovers a wedged process |
| Stalled or failing sweep (FR-038) | The scheduler tracks each sweep's last success in memory and emits a structured `ALERT sweep_stalled` line when it is older than 3× that sweep's cadence. That is the platform's existing alert convention with no metrics pipeline yet |
| Clock | `SystemClock` in the scheduler. Tests inject a fixed clock and fake timers |

### Multiple worker replicas

Stage 0 runs one worker. Every sweep is already idempotent and re-checks under row locks, so two
replicas running the same sweep concurrently would be **correct but wasteful**. A distributed lease
(an advisory lock or a lease table) is therefore not built now. **Trigger: the first deployment running
more than one worker replica**, which is Stage 1's ECS service. It is recorded here so that decision
starts from this note rather than from an incident.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| VPS crontab or systemd timer running `sweep-retention.ts` | New infrastructure outside Compose, different on Stage 1, and one process start per tick (Prisma client and connection pool each minute). It also cannot give per-sweep cadences without one entry each |
| `@nestjs/schedule` | A new runtime dependency to replace a `setTimeout` loop. It brings cron parsing the platform does not need and no answer to overlap, heartbeat or shutdown, which are the parts that matter |
| pg-boss scheduled jobs | Adopts a queue technology ADR-005 names only as a fallback, through the back door, and entangles scheduling with the relay decision ADR-018 is making |
| Keep manual, defer to Reminders | Leaves the calendar horizon and account erasure not running today, and fails SC-012 |

### What this does not do

It does not deliver events. `TaskOverdue` rows are written to the outbox on time, and delivering them
is the relay's job: spec 011, pending [ADR-018](../../adr/ADR-018-stage-0-event-transport.md).

---

## 7. Assignment: a child table, and why "concerns a child" is not stored

**Decision: `task_assignment (task_id, family_id, member_id, assigned_at)`, primary key
`(task_id, member_id)`, with nothing else about the person.**

Same reasoning as Calendar's `event_participant`: no `is_child`, no `kind`, no guardian ids. Whether a
task concerns a child is answered at read time by the visible-set filter (§1), so revoking a
guardianship changes the very next read (US2 #7) and there is no stale classification for
`linkUserToMember` to invalidate.

**Cross-family assignees (FR-016)** fail on the foreign key to `family_member`, whose RLS policy hides
other families' rows. They are mapped to `422 task/assignee_invalid` with no disclosure, as Calendar
maps participants.

**A successor copies assignments** in the same transaction (FR-021). Copying rather than referencing
the predecessor's rows keeps each instance's assignees independent, so reassigning next week's bins
does not rewrite who was assigned last week.

**`TaskAssigned` is per assignment added**, carrying `taskId` and `memberId`. A successor's copied
assignments do not emit `TaskAssigned`, because nobody assigned anything. They are implied by
`TaskCreated` with a `predecessorId`, and a consumer reads the rows. This keeps a weekly chore with
three assignees at one outbox row per week, not four.

---

## 8. Events published, and the two additions

**Decision: six versioned event types, identifiers only.**

| Event | Emitted when | Payload |
|---|---|---|
| `TaskCreated` | Create, or successor spawn | `familyId`, `taskId`, `seriesId?`, `predecessorId?`, `dueKind` |
| `TaskAssigned` | An assignee is added by a member | `familyId`, `taskId`, `memberId` |
| `TaskUpdated` | Edit, unassign, reopen | `familyId`, `taskId`, `changed: ('details'\|'due'\|'recurrence'\|'assignees'\|'status')[]` |
| `TaskCompleted` | open → completed | `familyId`, `taskId`, `completedByMemberId` |
| `TaskCancelled` | open → cancelled | `familyId`, `taskId`, `scope: 'instance' \| 'series'` |
| `TaskOverdue` | The sweep reports a due moment | `familyId`, `taskId`, `dueAt` |

`TaskUpdated` and `TaskCancelled` extend ARCHITECTURE §5.4's list of four, per the spec's
Assumptions. Reminders cannot correctly withdraw a reminder for a cancelled task, or reschedule one
whose due moved, from the original four. Adding an event a context publishes changes no boundary, so
**no ADR is needed**. §5.4's "Publishes" line is updated in the same pull request so the architecture
document stays true.

`dueAt` in `TaskOverdue` is a timestamp, not personal data. It is what lets a consumer discard a stale
overdue event whose task has since been re-dated, without a read.

---

## 9. Concurrency on the wire: `expectedVersion` in the body

**Decision: every mutating route that addresses an existing task takes `expectedVersion: number` in
its body, and responses carry `version`.**

`If-Match` with an ETag is the HTTP-native choice, and it is rejected for consistency. The ts-rest
contracts in this repository carry every request field through Zod body and path schemas, and no
existing route reads a precondition header. A body field is validated by the same contract as
everything else (Principle II), shows up in the generated client type, and cannot be forgotten by a
mobile client without a compile error. Calendar has no version, because its edits are last-write-wins
by spec. Tasks cannot be, because FR-011 requires one winner.

---

## 10. Erasure and the tombstone

**Decision: `ErasurePort` for both operations, the shape spec 009's `erasure.ts` established.**

- `eraseTasksForFamily`: delete every `task` row for the family. `task_assignment` cascades. Complete
  by construction, because every row carries `family_id` under RLS.
- `eraseTasksForMember`: delete that member's `task_assignment` rows, and replace
  `created_by_member_id`, `completed_by_member_id` and `cancelled_by_member_id` with the tombstone
  reference spec 008 keeps. Discovery uses `app.is_erasure`, as Calendar's migration does. Title and
  notes are not scrubbed (spec, Principle XI answer 2).

`predecessor_id` is a self-reference `ON DELETE SET NULL`, so a family erasure deleting rows in any
order cannot fail on the chain, and nothing else ever deletes a single task.

---

## 11. Performance budgets

| Path | Budget | Note |
|---|---|---|
| Open-task list, 200 rows | p95 under 150 ms | Partial index `(family_id, due_at NULLS LAST, id) WHERE status = 'open'` |
| Closed-task history, 400-day range | p95 under 200 ms | `(family_id, closed_at)`, five years of weekly chores (SC-002) |
| Complete with successor | p95 under 100 ms | One lock, one kernel call, three writes, two outbox rows |
| `nextOccurrenceAfter` | under 5 ms pure CPU | Worst case the 8-year leap-day rule, measured in a unit test |
| Overdue sweep per task | under 20 ms | One locked re-read, one update, one outbox row |
| `MemberVisibilityPort` | under 2 ms | **Unchanged** from spec 009 |

---

## What this feature does *not* decide

- **Holiday-aware due dates.** Deferred by the spec. `nextOccurrenceAfter` takes no holiday provider
  today, and adding an optional one later is additive.
- **Completion-anchored recurrence** ("every 3 days after I last did it"). Out of scope. It would be a
  different `after`/anchor policy over the same kernel function, not a new mechanism.
- **Event delivery.** The outbox relay, queues and dead-letter handling are spec 011, pending
  [ADR-018](../../adr/ADR-018-stage-0-event-transport.md). Spec 011 must be complete before Reminders.
- **A distributed lease for multiple worker replicas** (§6). Triggered by the first multi-replica
  deployment.
- **Pagination beyond keyset over the open list.** Households are small, so a 200-row page with a
  cursor is the whole design.
- **Linking tasks to calendar events.** Out of scope, and would need its own decision on which
  context owns the link.
