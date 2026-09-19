# Implementation Plan: Outbox Relay

**Branch**: `011-outbox-relay` | **Date**: 2026-09-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/011-outbox-relay/spec.md`

## Summary

Layer 2 has been complete since spec 006: every command handler in Identity, Family, Calendar and
Tasks already writes an `outbox_event` row in the same transaction as its domain change. Nothing has
ever read one. This feature builds the reader — ADR-005's Layer 3 — and closes the loop ADR-018 opened:
publish to ElasticMQ at Stage 0, the same code publishes to real SQS at Stage 1.

The design leans on two mechanisms this codebase already has, rather than inventing new ones:

**The claim-publish-mark loop is one more registered sweep.** `apps/worker`'s `SweepScheduler`
already runs seven jobs on independent cadences with a no-overlap guard, isolation, a heartbeat and a
stall alert (spec 010). A relay tick — claim a batch of unpublished rows with
`FOR UPDATE SKIP LOCKED`, resolve each to zero or more queues, publish, mark published — is the same
shape at a one-second cadence, which ADR-005 already fixes as the polling floor. No second scheduling
mechanism is built.

**The transport adapter is one more `packages/platform` adapter.** ARCHITECTURE.md §8 already names
`packages/platform` as the home for infra adapters including SQS, alongside the SMTP mailer this
feature's `SqsMessagePublisher` sits next to. `packages/kernel` gains the port interface, exactly as
`OutboxPort` and `MailerPort` are declared there and implemented in `platform` — and stays
dependency-free, so the AWS SDK dependency this feature introduces (the first in the repository) lives
in exactly one package.

The three open questions ADR-018 deferred to this feature's research are resolved by checking the
actual ElasticMQ project rather than assuming: message persistence, standard-queue DLQ redrive, and
maintenance status all hold, against `softwaremill/elasticmq-native` ([research.md §3](research.md)).

The three numbers the specification's clarification session fixed — 5 s delivery, 5 min lag alert, 5
attempts before dead-lettering — turn directly into `OUTBOX_LAG_ALERT_SECONDS = 300` and a
`maxReceiveCount` default, both following the exact pattern spec 010's `report-overdue-tasks.sweep.ts`
already established for its own lag alert.

What this feature does **not** build: any real consumer (Reminders does not exist), Stage 1's actual
SQS provisioning (a later feature reads this one's committed topology), and any change to how an
existing context writes to the outbox (Layer 2 is untouched).

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 24

**Primary Dependencies**: `@aws-sdk/client-sqs` (**new** — the platform's first AWS SDK dependency;
justified by ADR-018, which this feature implements). NestJS is not involved: the relay has no HTTP
surface and runs entirely in `apps/worker`, reusing its existing `SweepScheduler`. No new dependency
in `packages/kernel`, `packages/persistence` or `apps/api`.

**Storage**: PostgreSQL 16 via Prisma ([ADR-003](../../adr/ADR-003-database-orm.md)). One new table,
`processed_event` (the consumer-side idempotency ledger), **not** family-scoped — it records which
(queue, event id) pairs a consumer has handled, never family data, so no RLS policy applies to it
(mirrors `IdempotencyKey`, the only other existing exception to "every table is family-scoped", which
is scoped by `userId` instead). `outbox_event` (Layer 2, spec 006) is read and updated by this
feature but its schema is **unchanged** — no migration touches it.

**Testing**: Vitest. Unit tier: subscription resolution, the claim/publish/mark state transitions
against a fake `MessagePublisherPort`, the base consumer's idempotency check, HOCON topology
rendering. Integration tier against real PostgreSQL and a real ElasticMQ container (via the existing
Compose service, not testcontainers — the queue is infrastructure the whole environment shares, unlike
Postgres which `packages/testing` spins up per test run): concurrent claimers, crash-and-resume,
redrive to DLQ at exactly `maxReceiveCount`, the zero-subscriber path, the stub consumer end to end.

**Target Platform**: Linux container ([ADR-014](../../adr/ADR-014-containerized-development.md)),
Stage 0 VPS ([ADR-013](../../adr/ADR-013-staged-hosting-model.md), amended by
[ADR-018](../../adr/ADR-018-stage-0-event-transport.md))

**Project Type**: Modular monolith: the relay is new code in the existing `apps/worker` process, a new
adapter in `packages/platform`, and one new port in `packages/kernel`
([ADR-002](../../adr/ADR-002-modular-monolith.md))

**Background execution**: registered in `apps/worker`'s existing `SWEEPS` list as `outbox-relay`,
`defaultCadenceSeconds: 1` (ADR-005's polling floor), scheduled by the unmodified `SweepScheduler`. No
new process, no new container beyond ElasticMQ itself, no new scheduling code.

**Performance Goals**: an outbox row delivered to every configured queue within 5 s under normal
operation (SC-001, clarified); outbox-lag alert at 5 min (SC-010, clarified); redrive to DLQ at exactly
5 receives (SC-004, clarified, `maxReceiveCount = 5` unless a specific consumer documents otherwise).

**Constraints**: `packages/kernel` stays dependency-free — the new `MessagePublisherPort` and
`ProcessedEventPort` are interfaces only. No package other than `apps/worker` may import
`packages/platform`'s SQS exports, enforced by a dependency-cruiser rule (FR-010) — today that is
enforcement against nothing, since no other package has a reason to, but the rule exists so a future
context cannot casually reach for "just send it to SQS myself." No event payload logged beyond
identifiers (FR-018, SC-009), asserted by a telemetry test mirroring spec 010's.

**Scale/Scope**: Stage 0, synthetic data, every event type currently at zero real subscribers. The
subscription table starts with exactly one entry: a verification queue used only by integration tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status: PASS, no gating item.** Re-checked after Phase 1 design (data model, contracts): unchanged.
This feature is itself the resolution of the one deviation spec 010's plan recorded in its own
Complexity Tracking table (Layer 3 deferred to spec 011, ADR-018 pending) — nothing here introduces a
new deviation.

### No new ADR is required

ADR-018 already decided the one question that would have required an ADR — the Stage 0 transport — and
it is Accepted, not Proposed, as of this branch. Everything else here is implementation of an already-
decided architecture:

- **`MessagePublisherPort` in `packages/kernel`, `SqsMessagePublisher` in `packages/platform`.**
  Consumption of an already-established package boundary (`MailerPort` / `SmtpMailer` is the direct
  precedent), not a new one.
- **Registering the relay in the existing `SweepScheduler`.** ADR-005 already fixes the one-second
  polling floor; ADR-002 already assigns scheduled work to the worker. No new scheduling mechanism.
- **The `processed_event` table.** Direct implementation of ARCHITECTURE §7.3's `processed_events`
  ledger and Principle VIII's idempotent-consumer requirement, not a new pattern — it mirrors
  `IdempotencyKey`, an existing table under the same non-family-scoped exception.
- **The new AWS SDK dependency.** ADR-018's own Consequences section already names and justifies it.

Nothing here changes a security, privacy or authorization control. The relay reads rows every
producing context already writes and forwards them unchanged (FR-005); it introduces no new
authorization surface because it has no HTTP surface at all.

### Principle-by-principle

| Principle | Status | Note |
|---|---|---|
| I. Type safety is a contract | Pass | `MessagePublisherPort`, `ProcessedEventPort` are interfaces with no `any`. Queue names and event types are branded/narrowed where the topology module defines them, not passed as bare strings across the claim/publish boundary |
| II. Validate at every boundary | Pass | The ElasticMQ/SQS endpoint URL and region are parsed at worker boot, failing loudly on a bad value, following `worker-env.ts`'s existing pattern exactly. The committed queue-topology module is the single source of truth, so there is no runtime "config file" to validate — it is checked at compile time |
| III. Boundaries enforced | Pass | New edges: `apps/worker → packages/platform` (already exists, extended), `apps/worker → packages/persistence` (already exists, extended), `packages/platform → packages/kernel` (already exists, extended). **No edge from `packages/core/**` to the new SQS exports**, enforced by a new dependency-cruiser rule |
| IV. Persistence through the data-access layer | Pass | Claiming (`FOR UPDATE SKIP LOCKED`) and marking published live in `packages/persistence`, called from `apps/worker`, exactly as the overdue sweep's `findTasksNeedingOverdueReport` / `measureOverdueLag` do today |
| V. Object-level authorization | Not applicable | The relay has no HTTP surface, reads no family-scoped table (`outbox_event` and `processed_event` are both global, not per-family), and makes no authorization decision |
| VI. Children sensitive by default | Pass | The relay forwards whatever payload a producing context already wrote; it does not read, log or branch on payload contents beyond the fixed envelope fields. FR-018/SC-009 add a test asserting no payload body appears in a log line |
| VII. AI proposes, domain decides | Not applicable | No AI surface |
| VIII. Async work through the event system | Pass — **this feature is the implementation of this principle's missing half** | Layer 3 now exists. Every consumer built on the base idempotent-consumer class gets the transactional idempotency check by construction (FR-011). Every queue gets a DLQ with an alert (FR-013–015). The ESLint rule restricting queue-client construction to the relay is added here for the first time |
| IX. Versioned, shared contracts | Not applicable | No HTTP contract; the relay has no route. The event envelope's own versioning (`tasks.TaskCreated.v1`) is Layer 1/2's concern, unchanged |
| X. Infrastructure is code | Pass | The committed queue-topology module and its rendered ElasticMQ config are the infrastructure declaration for Stage 0; `docker-compose.yml` gains the `elasticmq` service, reviewed like any other. No manual VPS change |
| XI. Deletion and export designed | Pass | Data Handling and Compliance in spec.md already answers the five questions: no personal data is introduced. `processed_event` rows are operational, not user data, and are addressed in Assumptions (no enforced pruning yet) |

### Additional engineering constraints

| Constraint | Status |
|---|---|
| Observability is part of the feature | Pass. Outbox lag and per-queue counts follow the platform's stated Stage 0 convention exactly — structured `ALERT`-prefixed log lines, grepped via `docker compose logs`, per `docs/staging-environment.md` (no metrics pipeline exists, and this feature does not add one) |
| New external dependencies are decisions | Pass. One: `@aws-sdk/client-sqs`, pre-justified by ADR-018 |
| Testing weight follows risk | Pass. Heaviest suites are the crash-and-resume and concurrent-claimer integration tests, because a lost or duplicated event is this feature's characteristic failure — the same reasoning spec 010 applied to its successor rule |
| Cost is a design constraint | Pass. ElasticMQ is a free, self-hosted container on infrastructure the VPS already runs; no new paid service |

## Project Structure

### Documentation (this feature)

```text
specs/011-outbox-relay/
├── spec.md                       # Feature specification (/speckit-specify)
├── plan.md                       # This file
├── research.md                   # Phase 0: 12 decisions, no ADR gate (ADR-018 already covers transport)
├── data-model.md                 # Phase 1: processed_event table, topology config shape
├── quickstart.md                 # Phase 1: runnable validation scenarios
├── contracts/
│   └── relay-interfaces.md       # MessagePublisherPort, ProcessedEventPort, topology config, boundary rule
├── checklists/
│   └── requirements.md           # Spec quality checklist (passing)
└── tasks.md                      # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

Directories marked **new** do not exist yet.

```text
packages/
├── kernel/                                     # EXTENDED, additively
│   └── src/
│       ├── message-publisher.port.ts           #   NEW MessagePublisherPort, MessageToPublish
│       ├── processed-event.port.ts             #   NEW ProcessedEventPort, ProcessedEventRecord
│       └── index.ts                            #   + two re-exports
│
├── platform/                                    # EXTENDED — infra adapters (ARCHITECTURE §8)
│   └── src/
│       ├── sqs-message-publisher.ts             #   NEW: implements MessagePublisherPort.
│       │                                        #   One AWS SDK client; endpoint from config,
│       │                                        #   ElasticMQ at Stage 0, real SQS at Stage 1 —
│       │                                        #   same code (ADR-018)
│       ├── sqs-consumer.ts                      #   NEW: base idempotent consumer (FR-011).
│       │                                        #   Long-polls a queue, checks ProcessedEventPort
│       │                                        #   in the same transaction as the handler,
│       │                                        #   acks/no-ops on a duplicate delivery
│       └── index.ts                             #   + two re-exports
│
├── persistence/
│   ├── prisma/schema.prisma                     #   + ProcessedEvent model only (outbox_event
│   │                                             #   unchanged — FR-019)
│   ├── prisma/migrations/2026091809xxxx_processed_event/
│   └── src/
│       ├── repositories/
│       │   ├── outbox-relay.repository.ts       #   NEW: claimUnpublishedOutboxEvents (SKIP LOCKED),
│       │   │                                    #   markOutboxEventsPublished, measureOutboxLag
│       │   │                                    #   (mirrors measureOverdueLag)
│       │   └── processed-event.repository.ts    #   NEW: implements ProcessedEventPort
│       │                                        #   (mirrors idempotency-key.repository.ts)
│       └── index.ts                             #   + four new exports
│
└── testing/                                     # EXTENDED: stub-consumer test fixture,
                                                  #   outbox-event / processed-event factories

apps/
└── worker/                                       # EXTENDED
    ├── src/
    │   ├── relay/                                # NEW
    │   │   ├── queue-topology.ts                 #   the single source of truth: queue names,
    │   │   │                                     #   DLQ names, maxReceiveCount (default 5),
    │   │   │                                     #   subscribed event types — read by the relay
    │   │   │                                     #   AND rendered into ElasticMQ's config
    │   │   ├── render-elasticmq-config.ts        #   topology → HOCON; also a `pnpm` script,
    │   │   │                                     #   with a drift-check test against the
    │   │   │                                     #   committed .conf (mirrors the image-tag
    │   │   │                                     #   agreement test spec 010 T079 added)
    │   │   └── outbox-relay.sweep.ts             #   claim → resolve → publish → mark; the
    │   │                                         #   5-minute lag ALERT (research.md §9)
    │   ├── sweeps/registry.ts                    #   + one entry: name 'outbox-relay',
    │   │                                         #   defaultCadenceSeconds: 1
    │   └── test-support/
    │       └── stub-consumer.ts                  #   test-only (FR-012); not started by main.ts
    └── *.integration.spec.ts                     #   crash-and-resume, concurrent claimers,
                                                    #   zero-subscriber path, DLQ redrive, stub
                                                    #   consumer idempotency, telemetry

infrastructure/
└── elasticmq/
    └── queues.conf                                # NEW, generated from queue-topology.ts,
                                                     # committed (Principle X)

docker-compose.yml                                  # + elasticmq service (mirrors mailpit)
docker-compose.staging.yml                          # + elasticmq port reset (mirrors postgres)
docs/staging-environment.md                         # + reading relay logs, ALERT lines
.dependency-cruiser.cjs                             # + no-package-other-than-worker-imports-sqs
```

**Structure Decision**: no new top-level package. The relay's transport is one more
`packages/platform` adapter behind one more `packages/kernel` port — the exact shape `MailerPort` /
`SmtpMailer` already established — and its orchestration is new code inside the existing
`apps/worker`, registered in the existing `SweepScheduler`. The only genuinely new package-level
surface is `processed_event`, one table in the package that already owns every table
(`packages/persistence`). This is deliberately the minimum structural footprint: a feature that had to
invent a new package, a new scheduler, or a new container-orchestration mechanism to deliver Layer 3
would be evidence that ADR-005's design does not actually fit this codebase, and it does.

## Complexity Tracking

*Recorded at implementation (T048). Each is a place where what was built differed from what this plan
says. Four were found by running the quickstart and re-reading this section against the code; all four
were then fixed rather than accepted, so what remains is one deliberate deviation.*

| Deviation | Where the plan says otherwise | Status |
|---|---|---|
| **The sweep reads `RELAY_QUEUE_ENDPOINT` / `_REGION` from `process.env` itself**, not from the parsed `parseWorkerEnv()` result — importing it would be circular, since `worker-env.ts` imports the sweep registry, which imports the sweep. Both are still validated at worker boot. | Principle II row: parsed once, at boot | **Accepted.** The one standing deviation; documented at the call site in `outbox-relay.sweep.ts` |
| ~~No ESLint rule restricts queue-client construction to the relay.~~ | Principle VIII row, and spec.md's Input | **Closed** by T049: `packages/config-eslint/queue-access.js` |
| ~~`no-direct-sqs-access` blocks `packages/core/` only, so `apps/api` could import the SQS exports.~~ | Constraints, FR-010 | **Closed** by T049 — the ESLint rule covers every package, with exceptions declared only by `packages/platform`'s adapter and `apps/worker`'s relay. The dependency-cruiser gate still covers `packages/core/` and stays authoritative |
| ~~`RELAY_QUEUE_*` in neither `.env.example` nor CI, and CI has no ElasticMQ, so every relay integration spec would fail on push.~~ | Testing: integration tier "against a real ElasticMQ container" | **Closed** by T050 |
| ~~The lag alert measures after the tick's own claim, so a relay that was stopped and catches up never alerts.~~ | FR-016, SC-010, quickstart Scenario 5 | **Closed**: lag is measured before the claim. Verified by test and by running Scenario 5 (`ALERT outbox_lag_seconds=614 threshold=300` on the first tick after a restart) |
