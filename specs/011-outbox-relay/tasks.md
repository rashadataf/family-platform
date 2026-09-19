---

description: "Task list for implementing the Outbox Relay (spec 011)"
---

# Tasks: Outbox Relay

**Input**: Design documents from `/specs/011-outbox-relay/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/relay-interfaces.md](contracts/relay-interfaces.md),
[quickstart.md](quickstart.md). All present.

**No ADR gate.** ADR-018 is Accepted (not Proposed) on this branch; plan.md's Constitution Check
passes with no gating item and an empty Complexity Tracking table.

**Tests**: Included throughout, not optional. The constitution requires integration tests against a
real database, and this feature adds a real queue to that requirement. Its characteristic failure —
per plan.md's Additional Engineering Constraints — is a lost or duplicated event, which only
crash-and-resume and concurrent-claimer tests against real PostgreSQL and a real ElasticMQ container
can catch.

**Organization**: Grouped by user story (spec.md P1–P4). Foundational builds every port, adapter,
table, topology declaration and piece of dev tooling every story needs; no task in Foundational
implements the claim-publish-mark tick itself — that begins in US1. **No task in this file edits
anything under `packages/core/`, `apps/api/`, or any existing context's tables** (`outbox_event`'s
schema is read, never altered — FR-019). If implementation seems to need one of those, stop: it is a
design regression (plan.md, Structure Decision).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4, mapped to spec.md's priorities (US1/US2 are both P1; US3/US4 are both P2)
- Every task names an exact file path

## Path Conventions

- `packages/kernel/src/`: the two new ports (`message-publisher.port.ts`, `processed-event.port.ts`)
- `packages/platform/src/`: the two new adapters (`sqs-message-publisher.ts`, `sqs-consumer.ts`)
- `packages/persistence/{prisma,src/repositories}/`: the `processed_event` table and two repositories
- `apps/worker/src/relay/`: topology, config rendering, the sweep itself, dev-tooling CLIs
- `apps/worker/src/sweeps/registry.ts`: one new entry, no other change
- `infrastructure/elasticmq/queues.conf`: generated, committed
- `docker-compose.yml`, `docker-compose.staging.yml`: the new `elasticmq` service

Reference implementations to copy the shape of are `packages/persistence/src/repositories/idempotency-key.repository.ts`
(→ `processed-event.repository.ts`), `packages/persistence/src/repositories/tasks/overdue-sweep.ts`
(→ `outbox-relay.repository.ts`), `packages/platform/src/smtp-mailer.ts`
(→ `sqs-message-publisher.ts`), and `apps/worker/src/sweeps/report-overdue-tasks.sweep.ts`
(→ `outbox-relay.sweep.ts` — including its `ALERT`-on-threshold log pattern, reused twice in this
feature: once for lag, once for dead-letter arrival).

---

## Phase 1: Setup

**Purpose**: the boundary rule and the new dependency, in force before the code they govern exists.

- [X] T001 [P] Add a `no-direct-sqs-access` rule to `.dependency-cruiser.cjs`, forbidding any module
      matching `packages/core/**` from importing `packages/platform/src/sqs-message-publisher` or
      `packages/platform/src/sqs-consumer` (or their barrel re-exports). Copy
      `tasks-repositories-are-private`'s shape exactly, citing FR-010 (spec 011) in its comment.
- [X] T002 [P] Add `@aws-sdk/client-sqs` to `packages/platform/package.json` dependencies, pinned to a
      specific version (this repository's first AWS SDK dependency — ADR-018 pre-justifies it, no
      further approval needed). Run `pnpm install`.

**Checkpoint**: `pnpm build` and `pnpm boundaries` pass with the rule in place and nothing yet
importing the forbidden paths.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: every port, adapter, table, topology declaration, and piece of dev/test tooling that
every user story below depends on. **No claim-publish-mark logic lives here** — that is US1's own
deliverable, built on top of what this phase provides.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Kernel ports

- [X] T003 [P] Create `packages/kernel/src/message-publisher.port.ts`: `MessageToPublish` (`queueName`,
      `body`, `deduplicationId`) and `MessagePublisherPort` with `send(message)` and
      `approximateDepth(queueName): Promise<number>` (contracts/relay-interfaces.md §1, extended for
      FR-014/FR-017's depth reads).
- [X] T004 [P] Create `packages/kernel/src/processed-event.port.ts`: `ProcessedEventPort` with
      `wasProcessed(queueName, eventId): Promise<boolean>` and
      `markProcessed(queueName, eventId): Promise<void>` (contracts/relay-interfaces.md §2).
- [X] T005 Update `packages/kernel/src/index.ts`: re-export `MessagePublisherPort`, `MessageToPublish`,
      `ProcessedEventPort`, alongside the existing `OutboxPort`/`IdempotencyPort` exports (depends on
      T003, T004).

### Schema and migration

- [X] T006 Add the `ProcessedEvent` model to `packages/persistence/prisma/schema.prisma` per
      [data-model.md](data-model.md): `id` (`uuid(7)`), `queueName`, `eventId`, `processedAt` (default
      `now()`), `@@unique([queueName, eventId])`, `@@map("processed_event")`. **Not** placed under
      `ENABLE`/`FORCE ROW LEVEL SECURITY` — it is not family-scoped, mirroring `IdempotencyKey`'s
      existing exception.
- [X] T007 Generate `packages/persistence/prisma/migrations/<timestamp>_processed_event/migration.sql`
      and apply it locally. Confirm in the generated SQL that no RLS policy or `FORCE ROW LEVEL
      SECURITY` clause was added for `processed_event` (depends on T006).

### Persistence repositories

- [X] T008 [P] Create `packages/persistence/src/repositories/processed-event.repository.ts`:
      `PrismaProcessedEventRepository implements ProcessedEventPort`, constructor taking
      `PrismaClient | Prisma.TransactionClient` (mirrors `PrismaOutboxRepository`'s constructor
      exactly, per contracts/relay-interfaces.md §4's atomicity note). `wasProcessed` is a
      `findUnique` on the composite unique key; `markProcessed` is an `upsert` with a no-op `update`,
      so a duplicate call is not an error (depends on T004, T007).
- [X] T009 [P] Create `packages/persistence/src/repositories/outbox-relay.repository.ts`:
      `claimUnpublishedOutboxEvents(limit, clock)` — a raw query,
      `SELECT ... FROM outbox_event WHERE published_at IS NULL ORDER BY occurred_at LIMIT $1 FOR
      UPDATE SKIP LOCKED`, run inside a transaction the caller holds open until it also calls
      `markOutboxEventsPublished`; `markOutboxEventsPublished(ids)`; `measureOutboxLag(now)` (mirrors
      `measureOverdueLag` in `repositories/tasks/overdue-sweep.ts`: `now − min(occurred_at) WHERE
      published_at IS NULL`, zero when nothing is unpublished). No change to `outbox_event`'s schema.
- [X] T010 Update `packages/persistence/src/index.ts`: add `createProcessedEventStore(): ProcessedEventPort`
      (mirrors `createIdempotencyStore`), and re-export `claimUnpublishedOutboxEvents`,
      `markOutboxEventsPublished`, `measureOutboxLag` with their types (depends on T008, T009).

### Platform adapters

- [X] T011 [P] Create `packages/platform/src/sqs-message-publisher.ts`: `SqsMessagePublisherOptions`
      (`endpoint`, `region`), `createSqsClient(options)` (mirrors `createSmtpTransport`), and
      `SqsMessagePublisher implements MessagePublisherPort` — `send` via `SendMessageCommand`,
      `approximateDepth` via `GetQueueAttributesCommand` requesting
      `ApproximateNumberOfMessages` (depends on T002, T003).
- [X] T012 [P] Create `packages/platform/src/sqs-consumer.ts`: `ConsumerOutcome`, `ConsumerHandler`,
      `SqsConsumerOptions`, and `SqsConsumer` with `pollOnce()` — long-polls via
      `ReceiveMessageCommand`, checks `ProcessedEventPort.wasProcessed` per message, calls `handler`
      only on a fresh delivery, calls `markProcessed` on success, acknowledges
      (`DeleteMessageCommand`) only after a successful handle or a detected duplicate; a thrown
      handler leaves the message unacknowledged (contracts/relay-interfaces.md §4) (depends on T002,
      T004).
- [X] T013 Update `packages/platform/src/index.ts`: re-export `SqsMessagePublisher`,
      `createSqsClient`, `type SqsMessagePublisherOptions`, `SqsConsumer`, `type ConsumerHandler`,
      `type ConsumerOutcome` (depends on T011, T012).

### Worker configuration, topology, and infrastructure

- [X] T014 [P] Extend `apps/worker/src/config/worker-env.ts`: add required, validated
      `RELAY_QUEUE_ENDPOINT` (non-empty string) and `RELAY_QUEUE_REGION` (non-empty string) to
      `WorkerEnv` and `WORKER_ENV_VARIABLES`, following the existing fail-loudly-at-boot pattern
      exactly (Principle II). Update `worker-env.spec.ts`.
- [X] T015 [P] Create `apps/worker/src/relay/queue-topology.ts`: `QueueDefinition` (`name`,
      `dlqName`, `maxReceiveCount`, `subscribedEventTypes`) and `QUEUE_TOPOLOGY`, containing exactly
      one entry — `outbox-relay-verification` / `outbox-relay-verification-dlq` / `maxReceiveCount:
      5` / `subscribedEventTypes: ['relay.VerificationPing.v1']` — per
      contracts/relay-interfaces.md §5. Also export a pure `resolveDestinations(eventType,
      topology)` helper.
- [X] T016 Create `apps/worker/src/relay/render-elasticmq-config.ts` (topology → HOCON, per
      contracts/relay-interfaces.md §5) and run it once to produce the committed
      `infrastructure/elasticmq/queues.conf`, including `messages-storage { enabled = true }`
      (depends on T015).
- [X] T017 Add a drift-check test (`apps/worker/src/relay/render-elasticmq-config.spec.ts`) that
      re-renders from `QUEUE_TOPOLOGY` and asserts the result equals the committed
      `infrastructure/elasticmq/queues.conf` byte-for-byte, mirroring spec 010 T079's image-tag
      agreement test (depends on T016).
- [X] T018 Add an `elasticmq` service to `docker-compose.yml`: image
      `softwaremill/elasticmq-native`, pinned to the version confirmed current in research.md §3,
      `restart: unless-stopped`, a bind mount of `infrastructure/elasticmq/queues.conf`, and a
      healthcheck — mirrors the `mailpit` service's shape. Add `RELAY_QUEUE_ENDPOINT` (pointing at
      the `elasticmq` service) and `RELAY_QUEUE_REGION` (a fixed placeholder) to the `worker`
      service's `environment` block (depends on T016).
- [X] T019 Add an `elasticmq` override to `docker-compose.staging.yml`: `ports: !reset []`, mirroring
      the existing `postgres` override — nothing outside the staging Docker network needs to reach it
      directly (depends on T018).

### Dev and test tooling

- [X] T020 [P] Create `apps/worker/src/relay/seed-cli.ts` and add a `relay:seed` script to
      `apps/worker/package.json` (`tsx src/relay/seed-cli.ts`): writes one `outbox_event` row
      directly via the existing `OutboxPort`, taking `--event-type` and `--payload` flags. Used only
      by quickstart.md and manual verification — the only place in the codebase that writes an
      outbox row outside a real command handler.
- [X] T021 [P] Create `apps/worker/src/relay/peek-cli.ts` and add a `relay:peek` script to
      `apps/worker/package.json`: receives (without deleting) and prints whatever is currently on a
      named queue, using `SqsMessagePublisher`'s underlying client directly (depends on T011).
- [X] T022 [P] Create `apps/worker/src/test-support/stub-consumer.ts`: a `ConsumerHandler`-shaped
      test fixture, configurable to always succeed or to always fail (reading a `forceFailure` flag
      out of the envelope's payload), used only by integration specs — never registered in `main.ts`
      (research.md §11) (depends on T012).
- [X] T023 [P] Add `outbox-event` and `processed-event` factories to `packages/testing/src/index.ts`
      (or a new `relay-factories.ts` re-exported from it), following the existing factory
      conventions (depends on T006).

**Checkpoint**: Foundational ready — `pnpm build`, `pnpm typecheck`, `pnpm boundaries`, and
`docker compose up` (with `elasticmq` healthy) all pass. No user story's behaviour exists yet.

---

## Phase 3: User Story 1 - An event a context publishes reaches its consumer, reliably (Priority: P1) 🎯 MVP

**Goal**: The claim-publish-mark tick exists, runs on its own every second, survives a crash without
losing an event, and never double-claims a row across concurrent instances.

**Independent Test**: Seed a `relay.VerificationPing.v1` outbox row (`relay:seed`), wait, and confirm
it arrives on `outbox-relay-verification` (`relay:peek`) within 5 seconds, with the outbox row marked
published.

### Tests for User Story 1 ⚠️

> Write these first; they must fail (or not compile) before T029 exists.

- [X] T024 [P] [US1] Integration test in `apps/worker/src/relay/outbox-relay.sweep.integration.spec.ts`:
      seed a row via the outbox repository directly, run one tick, assert a message carrying the
      exact envelope fields (contracts/relay-interfaces.md §3) arrives on
      `outbox-relay-verification` within 5 s, and the row's `published_at` is set (SC-001).
- [X] T025 [P] [US1] Integration test, same file: simulate a crash between claim and mark (inject a
      failure after `send` succeeds but before the transaction commits, using a test-only hook
      mirroring `OverdueSweepHooks`'s interrupt seam), restart the tick, and assert the row ends up
      published with the event delivered — zero loss across the interruption (SC-002).
- [X] T026 [P] [US1] Integration test, same file: seed several rows, run two concurrent
      `claimUnpublishedOutboxEvents` calls against the same connection pool, and assert no row id
      appears in both result sets (SC-003, FR-023).
- [X] T027 [P] [US1] Unit test in `apps/worker/src/relay/queue-topology.spec.ts`: `resolveDestinations`
      returns the one configured queue for `relay.VerificationPing.v1`, and an empty array for any
      other event type.
- [X] T028 [P] [US1] Integration test using the stub consumer (T022): force a duplicate delivery of
      the same message (publish twice with the same `eventId`, or replay via a test hook), and assert
      the handler's own side effect (a counter the stub increments) is recorded exactly once (SC-008,
      FR-011).

### Implementation for User Story 1

- [X] T029 [US1] Create `apps/worker/src/relay/outbox-relay.sweep.ts`:
      `runOutboxRelaySweep(clock): Promise<OutboxRelaySweepResult>` — claim a batch via
      `claimUnpublishedOutboxEvents`, resolve each row's destinations via `resolveDestinations`,
      `send` to each (or none — see US4), mark all attempted rows published, log a structured
      `outbox_relay_run` summary line following `report-overdue-tasks.sweep.ts`'s exact shape
      (depends on T009, T011, T015; tests T024–T028 exist first).
- [X] T030 [US1] Add one entry to `apps/worker/src/sweeps/registry.ts`'s `SWEEPS` list: `name:
      'outbox-relay'`, `defaultCadenceSeconds: 1`, `run: (clock) => runOutboxRelaySweep(clock)`
      (depends on T029).

**Checkpoint**: `docker compose up`, run quickstart.md Scenarios 1–2. User Story 1 is fully functional
and independently testable — SC-001, SC-002, SC-003, SC-008 all provable.

---

## Phase 4: User Story 2 - A message a consumer cannot process is quarantined, not lost or stuck (Priority: P1)

**Goal**: A message that repeatedly fails ends up on its queue's dead-letter queue after exactly
`maxReceiveCount` attempts, triggers one alert, and never blocks another message on the same queue.

**Independent Test**: Publish a message the stub consumer is configured to always fail on; confirm it
appears on `outbox-relay-verification-dlq` after exactly 5 receives, exactly one `ALERT
dead_letter_arrived` log line appears, and a second, healthy message published afterward is still
delivered normally.

### Tests for User Story 2 ⚠️

- [X] T031 [P] [US2] Integration test in `apps/worker/src/relay/dead-letter.integration.spec.ts`:
      using the stub consumer set to always fail, poll a message to exactly `maxReceiveCount` (5)
      receives and assert it is then present on the DLQ and absent from the source queue (SC-004).
- [X] T032 [P] [US2] Integration test, same file: drive a queue's DLQ from empty to non-empty; assert
      exactly one `ALERT dead_letter_arrived queue=...` log line on that transition, none on a
      subsequent tick while it remains non-empty, and the depth is logged every tick regardless
      (FR-014).
- [X] T033 [P] [US2] Integration test, same file: publish one message the stub always fails and one it
      always succeeds on, to the same queue; assert the healthy message is still delivered while the
      poison one is being retried (User Story 2, acceptance scenario 4).

### Implementation for User Story 2

- [X] T034 [US2] Extend `outbox-relay.sweep.ts`: after the claim/publish/mark step, for every queue in
      `QUEUE_TOPOLOGY` call `approximateDepth(dlqName)`. Hold module-level state — a `Map<string,
      boolean>` of "this DLQ was non-empty last tick" — mirroring `SweepScheduler.checkStalled`'s
      edge-triggered, clear-on-recovery pattern exactly: log `ALERT dead_letter_arrived
      queue=<dlqName> depth=<n>` only on the false→true transition, and always log
      `outbox_relay_dlq_depth queue=<dlqName> depth=<n>` regardless of the flag (depends on T029;
      tests T031–T033).

**Checkpoint**: Run quickstart.md Scenario 3. User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - An operator can tell whether the relay is keeping up (Priority: P2)

**Goal**: The age of the oldest unpublished row is logged every tick; a high-severity alert fires the
first time it exceeds 5 minutes; per-queue delivered/pending/DLQ counts are all observable; the
relay's own liveness is distinguishable from data backing up.

**Independent Test**: Stop the worker, let unpublished rows accumulate past 5 minutes old, restart it,
and confirm `ALERT outbox_lag_seconds=... threshold=300` appears on the first tick — while, separately,
`ALERT sweep_stalled sweep=outbox-relay` never fires while the container was simply stopped (there was
no tick to stall).

### Tests for User Story 3 ⚠️

- [X] T035 [P] [US3] Integration test in `apps/worker/src/relay/outbox-lag.integration.spec.ts`, with
      a fixed/injectable clock: seed rows old enough to exceed 300 s of lag, run a tick, assert the
      `ALERT outbox_lag_seconds=... threshold=300` line appears; run a second tick with lag now under
      threshold and assert it does not (SC-010, FR-016).
- [X] T036 [P] [US3] Test in `apps/worker/src/scheduler/scheduled-sweeps.integration.spec.ts` (extend the
      existing suite): confirm `outbox-relay` is present in `SWEEPS`, is scheduled by
      `SweepScheduler`, and that scheduler's existing stall detection applies to it — no new code
      needed, this is a confirmation that FR-025 holds by construction.
- [X] T037 [P] [US3] Integration test, `outbox-relay.sweep.integration.spec.ts`: assert each tick's
      summary line reports, per configured queue, a delivered count, a pending count, and a DLQ depth
      (FR-017).

### Implementation for User Story 3

- [X] T038 [US3] Extend `outbox-relay.sweep.ts`: call `measureOutboxLag` after the mark step; hold a
      second module-level edge-triggered flag (independent of T034's DLQ flag) and log
      `ALERT outbox_lag_seconds=<n> threshold=300` only on the crossing, clearing on recovery — the
      same pattern as `OVERDUE_LAG_ALERT_SECONDS` in `report-overdue-tasks.sweep.ts`, and the same
      number, arrived at independently (research.md §9). Always log `outbox_relay_lag_seconds=<n>`
      every tick (depends on T029, T034).
- [X] T039 [US3] Extend `outbox-relay.sweep.ts`'s summary line to include, per queue, delivered /
      pending / DLQ-depth counts in the comma-joined shape `report-overdue-tasks.sweep.ts` already
      uses (depends on T038).
- [X] T040 [US3] Update `docs/staging-environment.md`: add a short section on reading the relay's
      logs — `docker compose logs worker | grep outbox_relay_run`, and what
      `ALERT outbox_lag_seconds` / `ALERT dead_letter_arrived` mean — mirroring the existing
      `ALERT sweep_stalled` section exactly.

**Checkpoint**: Run quickstart.md Scenario 5. User Stories 1, 2 AND 3 all work independently.

---

## Phase 6: User Story 4 - An event nobody consumes yet does not jam the relay or the alarm (Priority: P2)

**Goal**: An event type with no configured subscription is marked published with zero deliveries on
its first claim, contributes nothing to lag, and never blocks or delays anything else.

**Independent Test**: Publish an event of a type absent from `QUEUE_TOPOLOGY` (any real context's
event, e.g. via the existing Tasks API), confirm it is marked published with nothing sent anywhere,
and confirm the lag measure does not rise under a burst of such events.

### Tests for User Story 4 ⚠️

- [X] T041 [P] [US4] Integration test, `outbox-relay.sweep.integration.spec.ts`: seed a row with an
      event type absent from `QUEUE_TOPOLOGY`, run a tick, assert it is marked published, assert
      `MessagePublisherPort.send` was called zero times for it (a spy/fake), and assert a burst of 50
      such rows leaves `measureOutboxLag` at zero afterward (SC-006, FR-004).
- [X] T042 [P] [US4] Integration test, same file: publish an event of a type with no subscription,
      then add that type to a queue's `subscribedEventTypes` (in the test's own topology fixture, not
      the committed one) and publish a second event of the same type; assert only the second event is
      ever delivered — the first is never retroactively sent (FR-020).

### Implementation for User Story 4

- [X] T043 [US4] No new production code: T029 already resolves an event type to zero-or-more
      destinations and marks the row published either way (data-model.md's lifecycle diagram). Add a
      one-line comment on that branch in `outbox-relay.sweep.ts` citing FR-004/SC-006, and confirm
      T041–T042 pass against the existing implementation (depends on T029).

**Checkpoint**: Run quickstart.md Scenario 4. All four user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: the properties that span every story, not any one of them.

- [X] T044 [P] Add a telemetry test (`apps/worker/src/relay/telemetry.spec.ts` or extending an
      existing suite) asserting no log line emitted anywhere in `apps/worker/src/relay/` contains a
      payload body — only identifiers and the fixed envelope fields — mirroring spec 010's SC-011
      test (FR-018, SC-009).
- [ ] T045 [P] Add a one-line mention of the `elasticmq` service and the `relay:seed`/`relay:peek`
      scripts to `docs/local-development.md`, alongside the existing service list.
- [ ] T046 Run `pnpm lint`, `pnpm typecheck`, and `pnpm boundaries` across the whole workspace; fix
      anything the new code introduces.
- [ ] T047 Manually run every scenario in [quickstart.md](quickstart.md) end to end against
      `docker compose up`; record the outcome of each in the PR description.
- [ ] T048 Re-read plan.md's Constitution Check and Complexity Tracking against what was actually
      built; confirm both still hold with no new deviation, and update spec.md's Success Criteria
      section to note each SC is now verified (not just specified), per this repository's ticking
      rule.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks every user story.**
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational **and** US1 (extends the same
  `outbox-relay.sweep.ts` T029 creates — this is the one place these stories are not fully
  independent of each other, and it is deliberate: there is exactly one tick function, not one per
  story).
- **User Story 3 (Phase 5)**: Depends on Foundational and US1 (extends `outbox-relay.sweep.ts`
  again); independent of US2's own extension (different module-level flag, no shared code path).
- **User Story 4 (Phase 6)**: Depends on Foundational and US1 only — no new code, just tests against
  what US1 already built.
- **Polish (Phase 7)**: Depends on every story being complete.

### Within Each Phase

- Tests (where marked ⚠️) are written and must fail before the implementation task that follows them.
- Kernel ports before the adapters that implement them; adapters before the sweep that composes them.
- Topology and its rendered config before anything that reads it (the sweep, the ElasticMQ service).

### Parallel Opportunities

- T001–T002 (Setup) in parallel.
- Within Foundational: T003/T004 together; T008/T009 together (once their own deps land); T011/T012
  together; T014/T015 together; T020/T021/T022/T023 together — each pair/group touches disjoint
  files.
- Within each story's test block, every `[P]` test runs in parallel — they are read-only against
  seeded fixtures or write to disjoint rows.
- US3 and US4 can be implemented in parallel with each other once US1 lands (US2 touches the same
  file as US3 but a disjoint code path — coordinate if working simultaneously, otherwise sequence
  them).

---

## Parallel Example: Foundational phase

```bash
# Kernel ports, together:
Task: "Create packages/kernel/src/message-publisher.port.ts"
Task: "Create packages/kernel/src/processed-event.port.ts"

# Platform adapters, together (after the ports above land):
Task: "Create packages/platform/src/sqs-message-publisher.ts"
Task: "Create packages/platform/src/sqs-consumer.ts"

# Dev/test tooling, together (after their own deps land):
Task: "Create apps/worker/src/relay/seed-cli.ts"
Task: "Create apps/worker/src/relay/peek-cli.ts"
Task: "Create apps/worker/src/test-support/stub-consumer.ts"
Task: "Add outbox-event and processed-event factories to packages/testing"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational — every port, adapter, table and piece of tooling, with nothing yet
   ticking.
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: run quickstart.md Scenarios 1–2 against `docker compose up`. Layer 3 now
   reliably delivers, on its own, for the first time in this platform's history.

### Incremental Delivery

1. Setup + Foundational → the relay can be built, nothing runs yet.
2. + US1 → events are delivered reliably (MVP: ADR-005 Layer 3 exists).
3. + US2 → poison messages stop being a risk.
4. + US3 → an operator can tell if it's keeping up.
5. + US4 → confirmed, not just assumed, that today's zero real subscribers cause no false alarms.

Each story after US1 is a strict extension of `outbox-relay.sweep.ts`; none removes or reworks what
the previous one built, so stopping after any checkpoint leaves a working relay.
