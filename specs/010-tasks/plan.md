# Implementation Plan: Tasks

**Branch**: `010-tasks` | **Date**: 2026-09-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/010-tasks/spec.md`

## Summary

This is the second context built on the tenant root, and the first to inherit a shared kernel it did
not write. Calendar paid for the isolation machinery, the guardian-visibility port and the recurrence
kernel. Tasks is the test of whether those were built as reusable parts or as Calendar-shaped code
that merely sat in shared directories. The measure is concrete: **this feature changes nothing in
Family or Calendar, and adds one function to the kernel.**

The spec builds `Task` and `TaskAssignment` (ARCHITECTURE.md §5.4): a three-state lifecycle, assignees
filtered by guardianship, recurring chores that spawn their successor on closure, and a sweep that
publishes `TaskOverdue` exactly once per due moment.

Three things carry more weight than the five user stories suggest.

**A successor must be exactly one, and it must never be missing.** Retries, two members ticking off
the same chore, reopen-and-recomplete, and a rule reaching its `COUNT` all converge on the same
transaction. The design makes each invariant a database constraint rather than a discipline:
`predecessor_id` is unique, one row per series is flagged head under a partial unique index, and the
close, the spawn and the head hand-over share a transaction guarded by a row lock and an optimistic
`version`. [research.md §3](research.md).

**The kernel's `COUNT` semantics decide where a series is anchored.** `expand` counts from DTSTART, so
a successor computed from its predecessor's due date would restart the count forever. Each row
therefore carries the series' `recurrence_anchor`, reset only when the rule is edited. A side effect
is a clean answer to the bank-holiday week: moving one instance's due date moves that instance
alone. [research.md §2](research.md).

**Overdue is exactly-once without a timer.** One column, `overdue_reported_for`, compared with
`due_at` under a partial index, turns "once per due moment, again if re-dated, safe to interrupt" into
a predicate rather than a job-state machine. The sweep follows the materialisation sweep's discovery
and write shape exactly. [research.md §5](research.md).

**And a fourth that is not about tasks at all: background work finally runs on its own.** Planning
found that no sweep had ever run automatically. The worker's module is empty, and the staging deploy
leaves the worker out entirely (#29). Overdue detection within 5 minutes (SC-012) cannot sit on top of
that, so this feature gives the worker an in-house scheduler that runs every sweep (the six existing
plus this one) on its own cadence, and deploys the worker to staging. [research.md §6](research.md).
Event *delivery* is deliberately not included; it is spec 011, pending
[ADR-018](../../adr/ADR-018-stage-0-event-transport.md).

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 24

**Primary Dependencies**: NestJS 11 + `@ts-rest/nest` (`apps/api`); ts-rest + Zod 3
(`packages/contracts`); Prisma 6.16 (`packages/persistence`). **No new external dependency.**

**Storage**: PostgreSQL 16 via Prisma ([ADR-003](../../adr/ADR-003-database-orm.md)). Two new tables,
`task` and `task_assignment`, both family-scoped under `ENABLE` **and** `FORCE ROW LEVEL SECURITY`
([ADR-017](../../adr/ADR-017-tenant-isolation-at-the-database.md)). Four new enums. No new role; the
existing `app.is_sweep` and `app.is_erasure` flags are reused.

**Testing**: Vitest. Unit tier: the lifecycle state machine, the successor rule, due-moment derivation
and `nextOccurrenceAfter`, all pure and fixed-clock. Integration tier against real PostgreSQL: RLS,
the two unique invariants, the guardian filter in the query, concurrency (parallel completions),
idempotent retries, and the overdue sweep's interrupt-and-rerun. Spec 008's parameterised cross-family
sweep is extended with ten routes.

**Target Platform**: Linux container ([ADR-014](../../adr/ADR-014-containerized-development.md)),
Stage 0 VPS ([ADR-013](../../adr/ADR-013-staged-hosting-model.md))

**Project Type**: Modular monolith: one NestJS HTTP host plus a worker over shared workspace packages
([ADR-002](../../adr/ADR-002-modular-monolith.md))

**Background execution**: an in-process scheduler in `apps/worker` (no library) running seven
registered sweeps on validated per-sweep cadences, with a no-overlap guard, heartbeat `HEALTHCHECK` and
`ALERT sweep_stalled` lines. The worker's existing `runtime` Dockerfile target is added to the
`vps-staging` Pulumi deploy. No new infrastructure, host or container type

**Performance Goals**: overdue reported within 5 minutes of due (SC-012; 60 s cadence); open list p95 under 150 ms; history p95 under 200 ms at five years; complete
with successor p95 under 100 ms; `nextOccurrenceAfter` under 5 ms CPU; overdue sweep under 20 ms per
task; `MemberVisibilityPort` unchanged at under 2 ms. [research.md §11](research.md)

**Constraints**: Tasks imports from `core/family` only the two published ports and from `core/calendar`
nothing, asserted by an AST test. No repository method takes a family identifier (Principle IV).
`packages/kernel` stays dependency-free and the recurrence subpath stays pure. No title or notes in any
log, metric label, span, audit `purpose` or outbox payload. Every existing kernel test passes
unmodified.

**Scale/Scope**: Stage 0, synthetic data. A household with 30 weekly chores accrues about 1,500 closed
rows a year. Five years is well under 10,000 rows per family, and the open set stays in the tens.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status: PASS, with no gating item.** Re-checked after Phase 1 and after adding the scheduler:
unchanged. One deviation remains, the event relay, now owned by spec 011 and ADR-018, and recorded in
Complexity Tracking. ADR-018 gates spec 011, **not** this feature, which neither builds nor depends on
the relay.

### No ADR is required

The candidates, and why none of them meets the bar:

- **Two events beyond ARCHITECTURE §5.4's four** (`TaskUpdated`, `TaskCancelled`). A context adding to
  what it publishes alters no boundary, moves no aggregate and changes no data ownership. §5.4's
  "Publishes" line is updated in this feature's pull request so the document stays true
  ([research.md §8](research.md)).
- **An additive kernel function** (`nextOccurrenceAfter`). ARCHITECTURE §5.4 names the kernel as
  shared precisely so a second context can consume it. Adding a pure function over `expand` changes
  neither its purity nor its dependency-freedom ([research.md §2](research.md)).
- **Reusing `MemberVisibilityPort`** is consumption of a published port, the sanctioned §7.1 mechanism.
- **An in-process sweep scheduler, and the worker on staging.** ADR-002 already assigns scheduled
  sweeps to the worker, ADR-005 already fixes sweeps on a fixed cadence, and ADR-013's Stage 0 is the
  Compose service set, which includes the worker. No new technology, host or boundary
  ([research.md §6](research.md)).

Nothing here changes a security, privacy or authorization control. FR-014 applies Calendar's existing
control to a new context, through the same port.

### Principle-by-principle

| Principle | Status | Note |
|---|---|---|
| I. Type safety is a contract | Pass | `TaskId`, `TaskSeriesId` branded. `Due` is a discriminated union on the wire, in the domain, and as a `CHECK` in the database, so a time without a zone is unrepresentable. The lifecycle is a union of states with exhaustive transition handling. No `any` |
| II. Validate at every boundary | Pass | Contract Zod schemas inbound. RRULE parsed into the kernel's declared subset. IANA zone checked with the kernel's `isValidTimeZone`. Raw sweep-discovery results parsed before leaving `persistence` |
| III. Boundaries enforced | Pass | New edges: `apps/api → core/tasks`, `apps/worker → core/tasks`, `core/tasks/application → core/family/application/ports` (two ports), `core/tasks → @fp/kernel/recurrence`, `persistence → core/tasks`. **No edge to `core/calendar`**, asserted by AST test. New dependency-cruiser rule `tasks-repositories-are-private`, mirroring Calendar's |
| IV. Persistence through the data-access layer | Pass | `withTasksFamilyContext` unit of work; no method takes a family parameter. Row locks via the existing raw-query directory pattern Calendar uses. Migration is additive only |
| V. Object-level authorization | Pass | Spec 008's layers intact: membership guard, capability guard, scoped repositories, RLS. The guardian filter is applied in the query, and before the version check on writes, so neither a count nor a `409` reveals a hidden task. Cross-family `404` via the extended parameterised sweep. Capabilities, never roles |
| VI. Children sensitive by default | Pass | Assignees are member ids only; Tasks never learns who is a child. Read-time guardianship through the port. Audit per (task, child) on permitted reads and on denials. A child is never recorded as the actor of a completion. Title and notes kept out of every signal and payload, with a telemetry test |
| VII. AI proposes, domain decides | Not applicable | No AI surface. The list queries are a future read port, which is why they sit behind `TasksReadPort` |
| VIII. Async work through the event system | Pass, **with the relay assigned to spec 011** | Six event types as outbox rows in the state change's transaction. The overdue sweep is inspectable before it runs (the predicate is a query) and explainable after (the marker plus the outbox row). Scheduled work now actually runs on schedule. Layer 3 is no longer an open-ended deferral: ADR-018 (Proposed) decides its Stage 0 transport and spec 011 builds it before Reminders |
| IX. Versioned, shared contracts | Pass | `packages/contracts/src/v1/tasks.contract.ts`, additive within `/v1`. Idempotency key on every mutating route. `expectedVersion` in the body for optimistic concurrency. Standard problem types. Per-route rate limits |
| X. Infrastructure is code | Pass | The worker joins the staging deploy through `infrastructure/src/{image,transfer,deploy}.ts` and `docker-compose.staging.yml`, with a Pulumi preview on the PR. No manual VPS change, no crontab, no new resource type |
| XI. Deletion and export designed | Pass | `ErasurePort` for family and member from the start. Member erasure removes assignments and tombstones actor references; the free-text limitation is stated in spec.md. Export equals read |

### Additional engineering constraints

| Constraint | Status |
|---|---|
| UK-first without being UK-welded | Pass. IANA zones, UTC storage, authored zone recorded. No holiday behaviour, so nothing jurisdictional. Both UK clock changes are test fixtures, not code paths |
| Observability is part of the feature | Pass. Overdue-detection lag is the feature's alert, following the materialisation sweep's structured `ALERT` convention. `ALERT sweep_stalled` and the heartbeat healthcheck make a stopped schedule visible (FR-038). Successor-spawn and conflict counters make the two subtle invariants visible |
| Testing weight follows risk | Pass. The heaviest suites are the successor rule (pure) and the concurrency and invariant integration tests, because a duplicate or missing chore is this feature's characteristic failure |
| New external dependencies are decisions | Pass. None |
| Cost is a design constraint | Pass. No provisioning. A successor's copied assignments emit no `TaskAssigned`, which keeps the outbox quiet |

## Project Structure

### Documentation (this feature)

```text
specs/010-tasks/
├── spec.md                 # Feature specification (/speckit-specify)
├── plan.md                 # This file
├── research.md             # Phase 0: 11 decisions, no ADR gate
├── data-model.md           # Phase 1: tables, constraints, lifecycle, successor rule
├── quickstart.md           # Phase 1: 10 runnable scenarios
├── contracts/
│   └── tasks-api.md        # Routes, guardian boundary, errors, authorization matrix
├── checklists/
│   └── requirements.md     # Spec quality checklist (passing)
└── tasks.md                # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

Directories marked **new** do not exist yet.

```text
packages/
├── kernel/                                    # EXTENDED, additively
│   └── src/
│       ├── branded-id.ts                      #   + TaskId, TaskSeriesId
│       ├── errors.ts                          #   + the task error kinds
│       └── recurrence/
│           ├── next-occurrence.ts             #   NEW nextOccurrenceAfter (research.md §2)
│           ├── next-occurrence.spec.ts        #   both clock changes, COUNT from anchor,
│           │                                  #   leap-day yearly, midnight-transition zone
│           └── index.ts                       #   + one re-export
│
├── core/
│   ├── tasks/                                 # NEW, ARCHITECTURE §5.4
│   │   ├── domain/
│   │   │   ├── task.aggregate.ts              #     lifecycle state machine, due union, version
│   │   │   ├── due.ts                         #     Due union + due-moment derivation. Pure
│   │   │   ├── successor.ts                   #     the successor rule (data-model.md). Pure
│   │   │   ├── task-assignment.ts             #     member ids only
│   │   │   ├── overdue.ts                     #     isOverdue, needsOverdueReport. Pure
│   │   │   └── events.ts                      #     the six, versioned
│   │   ├── application/
│   │   │   ├── ports/
│   │   │   │   ├── tasks-unit-of-work.port.ts
│   │   │   │   ├── task.repository.ts
│   │   │   │   ├── task-assignment.repository.ts
│   │   │   │   ├── tasks-read.port.ts         #     open list, history, due range (dashboard, AI later)
│   │   │   │   └── erasure.port.ts
│   │   │   ├── commands/                      #     create-task, update-task, complete-task,
│   │   │   │   └── …                          #     reopen-task, cancel-task, assign, unassign,
│   │   │   │                                  #     report-overdue
│   │   │   ├── queries/                       #     list-open-tasks, list-task-history, get-task
│   │   │   └── visibility.ts                  #     port answer → filter + audit (research.md §1)
│   │   ├── index.ts
│   │   └── reads-family-only-through-published-ports.spec.ts   # + asserts no core/calendar import
│   └── index.ts                               #   + export * as tasks
│
├── contracts/
│   └── src/v1/tasks.contract.ts               # NEW
│
├── persistence/
│   ├── prisma/schema.prisma                   #   + Task, TaskAssignment, four enums
│   ├── prisma/migrations/2026091609xxxx_tasks/ #  NEW: tables, CHECKs, partial uniques,
│   │                                          #   RLS + FORCE, sweep/erasure SELECT policies
│   └── src/
│       ├── repositories/tasks/                # NEW: scoped repositories, overdue-sweep discovery,
│       │                                      #   erasure; private per dependency-cruiser
│       └── index.ts                           #   + createTasksUnitOfWork, findTasksDueOverdueReport,
│                                              #     measureOverdueLag, eraseTasksForFamily/Member
│
└── testing/                                   # EXTENDED: task factories

apps/
├── api/src/tasks/                             # NEW
│   ├── tasks.controller.ts
│   ├── tasks.module.ts
│   ├── tasks.tokens.ts
│   ├── test-support/                          #   household fixture (mirrors calendar's)
│   └── *.integration.spec.ts                  #   lifecycle, recurrence, concurrency, idempotency,
│                                              #   child visibility, child audit, capability,
│                                              #   cross-family, telemetry
└── worker/                                    # EXTENDED: background work runs on its own
    ├── Dockerfile                             #   runtime target + heartbeat HEALTHCHECK
    └── src/
        ├── main.ts                            #   starts the scheduler; graceful shutdown
        ├── config/worker-env.ts               #   NEW validated cadences (Principle II)
        ├── scheduler/scheduler.ts             #   NEW no overlap, isolation, heartbeat, stall alert
        ├── sweeps/registry.ts                 #   NEW the one list of all seven sweeps
        ├── sweeps/report-overdue-tasks.sweep.ts   # NEW, with integration spec
        └── sweep-retention.ts                 #   iterates the registry; stays the --as-of CLI

infrastructure/src/                            # EXTENDED: worker on staging
├── image.ts                                   #   + fp-worker:staging-runtime tarball
├── transfer.ts                                #   + ship it
└── deploy.ts                                  #   + load it, `up -d … worker`
docker-compose.staging.yml                     # + worker override (image, network, app role)
docs/staging-environment.md                    # worker is deployed; reading sweep logs

.dependency-cruiser.cjs                        # + tasks-repositories-are-private
ARCHITECTURE.md                                # §5.4 Publishes: + TaskUpdated, TaskCancelled
```

**Structure Decision**: the hexagonal four-layer shape specs 006, 008 and 009 established, applied
without variation. The notable non-changes are deliberate: **no file under `core/family` or
`core/calendar` is touched**, and the kernel gains one file plus one re-export. A diff that touches
either context is a design regression, and should be caught in review against this paragraph.

`visibility.ts` looks like a copy of Calendar's and is intentionally separate. [research.md §1](research.md)
explains why hoisting it would put the wrong context in charge of it.

## Complexity Tracking

> One deviation, no longer an open-ended deferral. The scheduler gap earlier drafts recorded here is
> fixed in this feature ([research.md §6](research.md)).

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| ADR-005 Layer 3 (relay, queues, DLQs) is not built **in this feature**, though Principle VIII mandates the event system | Building it needs a Stage 0 transport, and every candidate amends ADR-005 or ADR-013. The constitution requires that amendment merged before code. [ADR-018](../../adr/ADR-018-stage-0-event-transport.md) is drafted (Proposed) and **spec 011, "Event relay", owns the build**. Layer 2 is complete for all six event types, so nothing is lost: rows are durable and will be relayed once 011 lands | Folding the relay into 010 would put an unaccepted ADR on the critical path of an unrelated feature, and would build a relay whose only consumer (Reminders) is not yet specified. **Hard ordering: ADR-018 accepted → spec 011 → Reminders.** Reminders MUST NOT be specified to consume events before 011 is merged |
