# Research: Outbox Relay

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

No `[NEEDS CLARIFICATION]` markers reached this phase — the specification's clarification session
already fixed the three numbers implementation needed (5 s delivery, 5 min lag alert, 5-attempt
redrive). ADR-018 already fixed the transport. What remained was verifying ADR-018's own open
questions and fitting the relay into this codebase's existing patterns rather than inventing new ones.

## 1. Where the claim-publish-mark loop lives

**Decision**: Register the relay as one more entry in `apps/worker/src/sweeps/registry.ts`'s `SWEEPS`
list, with `defaultCadenceSeconds: 1`, scheduled by the existing `SweepScheduler` unmodified.

**Rationale**: `SweepScheduler` (`apps/worker/src/scheduler/scheduler.ts`) already provides, for free,
every property the relay needs: no-overlap (a tick still running when the next is due is skipped, not
stacked — exactly what prevents two overlapping claim passes), isolation (a throwing tick is logged and
does not stop other sweeps or cancel its own next tick), a heartbeat file the container's `HEALTHCHECK`
reads, and a stall alert at three missed cadences. `cadenceSchema` in `worker-env.ts` already accepts
any positive whole number of seconds, so `1` requires no schema change. ADR-005 independently fixes
"one-second intervals for the outbox relay" as the polling floor (Consequences section), which is
exactly this cadence.

**Alternatives considered**:
- **A dedicated long-running loop, separate from `SweepScheduler`.** Would duplicate no-overlap,
  isolation, heartbeat and stall-alert logic that already exists and is already tested
  (`scheduler.spec.ts`). Principle VIII's own enforcement list names "a base consumer class" as the
  reusable primitive it expects, not a second scheduler.
- **A `setInterval` inside `main.ts`, outside the registry.** Rejected for the same reason spec 010
  rejected it for sweeps generally: it would not appear in `SWEEPS`, so it would be invisible to the
  one-shot CLI (`sweep-retention.ts`) and to anyone reading the registry to answer "what background
  work does this platform run" (research.md's own stated goal in spec 010 §6).

## 2. Package placement: no new package

**Decision**: `packages/kernel` gains two port interfaces (`MessagePublisherPort`,
`ProcessedEventPort`). `packages/platform` gains their implementations
(`SqsMessagePublisher`, `SqsConsumer`). `packages/persistence` gains the `processed_event` table and
two repository functions. Orchestration (the subscription table, the claim/publish/mark tick, the lag
alert) lives in `apps/worker/src/relay/`. No new top-level package.

**Rationale**: ARCHITECTURE.md §8's own package tree names `packages/platform` as the home for "infra
adapters: SQS, S3, KMS, mailer, push, flags" — SQS is listed by name. `MailerPort` / `SmtpMailer` is
the direct, working precedent for "port in kernel, adapter in platform, kernel stays dependency-free."
A new package would need its own `node_modules` volume in `docker-compose.yml` (every existing package
has one, "ADDING A WORKSPACE PACKAGE REQUIRES ADDING A VOLUME HERE") for no boundary benefit a
dependency-cruiser rule inside the existing packages cannot already provide.

**Alternatives considered**:
- **A new `packages/relay` package**, to give FR-010's import restriction a package-level boundary for
  free. Rejected: the restriction FR-010 actually needs is narrower than "no package but this one" — it
  is "no *bounded context* may construct an SQS client directly," which a dependency-cruiser rule
  scoped to `packages/core/** → packages/platform`'s SQS exports enforces precisely, without a new
  package.
- **Inside `packages/core`, as a thirteenth "context."** Rejected: the relay has no aggregate, no
  domain invariant, and ARCHITECTURE §5 does not name it as a bounded context. It is infrastructure
  serving every context, like the outbox itself.

## 3. ElasticMQ: verifying ADR-018's three open questions

ADR-018 named three things to verify before implementation, not to assume. Checked directly against
the project rather than inferred from the ADR's own confidence:

**Message persistence survives a restart.** Confirmed. ElasticMQ supports an opt-in H2-backed
persistence mode (`messages-storage { enabled = true }`); enabled, queues and messages restore
automatically after a container restart. A prior bug (softwaremill/elasticmq#618) where deleted
dead-letter messages reappeared after a restart with persistence enabled is closed, fixed by PR #657.
**Decision**: pin a version tag released after that fix, not `:latest` — reproducibility over
convenience, consistent with this repository's general pinning discipline (Actions pinned to SHAs,
`postgres:16-alpine` pinned by major version).

**Redrive to DLQ matches SQS standard-queue semantics.** Confirmed. A queue's `deadLettersQueue` block
names its DLQ and a `maxReceiveCount`; a message is moved after that many receives, matching SQS.

**Maintenance status and licence.** Confirmed. Apache-2.0. Actively maintained (softwaremill/elasticmq
on GitHub; recent Docker Compose and multi-arch build tooling commits at the time of this check).

**Decision**: `softwaremill/elasticmq-native`, pinned to a specific tag (`1.5.7` at the time of this
research; confirmed current in implementation before the image reference is committed). The `-native`
(GraalVM) variant over the plain JVM image for a smaller image and faster cold start in Compose, with
no feature difference relevant here.

**None of the three failed.** Per ADR-018's own instruction ("If any of these fails, this ADR is
revisited before spec 011 proceeds"), implementation proceeds without revisiting the ADR.

## 4. Queue and DLQ topology: one committed source, one rendered artifact

**Decision**: `apps/worker/src/relay/queue-topology.ts` is the single source of truth — a typed,
readonly array of `{ name, dlqName, maxReceiveCount, subscribedEventTypes }`. A small script
(`render-elasticmq-config.ts`) renders it into ElasticMQ's HOCON format at
`infrastructure/elasticmq/queues.conf`, which is committed (not generated at container start) and
checked by a test that re-renders and diffs against the committed file, failing the build if they
disagree — the same "two files must agree" shape spec 010 added for the image-tag string (T079).

**Rationale**: FR-009 requires the Stage 0 container and the future Stage 1 provisioning program to
read "the same declarations." A TypeScript module is importable directly by a future Pulumi program
(itself TypeScript) with no parsing step, while ElasticMQ itself only understands HOCON — so the
module is the source of truth and the `.conf` file is its committed, drift-checked rendering, not a
second hand-maintained copy.

**Alternatives considered**:
- **Hand-maintain the HOCON file directly, with no TypeScript source.** Rejected: nothing would stop
  the file and the relay's own subscription-resolution code (which needs the same queue names and event
  mappings, in code, per ADR-018 §3) from drifting apart silently.
- **Generate the `.conf` at container start from the TS module**, rather than committing it. Rejected:
  Principle X requires infrastructure to be reviewable as committed text, and a file materialised only
  at runtime is not diffable in a pull request.

## 5. Consumer-side idempotency: a new table, mirroring an existing one

**Decision**: A new `processed_event` table and `ProcessedEventPort`
(`findByKey`/`save`-shaped, keyed on `(queueName, eventId)`), implemented in
`packages/persistence/src/repositories/processed-event.repository.ts`.

**Rationale**: `IdempotencyKey` already exists for exactly this pattern at the API boundary (a table
outside the family-scoping rule, because it records "was this seen before," not family data) —
`processed-event.repository.ts` mirrors `idempotency-key.repository.ts` field-for-field, substituting
`(queueName, eventId)` for `(userId, key)`. `SqsConsumer`'s base class (`packages/platform`) checks this
port inside the same transaction as the handler it wraps, exactly as ARCHITECTURE §7.3's sequence
diagram specifies: `SELECT processed_events WHERE event_id = ?` before doing the work, `INSERT` after,
same transaction.

## 6. Claiming and marking: extends the existing outbox repository, no schema change

**Decision**: `outbox-relay.repository.ts` adds `claimUnpublishedOutboxEvents(limit, clock)` (a raw
query using `SELECT ... FOR UPDATE SKIP LOCKED WHERE published_at IS NULL ORDER BY occurred_at LIMIT
$1`), `markOutboxEventsPublished(ids)`, and `measureOutboxLag(now)` (mirrors `measureOverdueLag`
exactly: `now - min(occurred_at) WHERE published_at IS NULL`, zero when nothing is unpublished).
`outbox_event`'s schema is unchanged — FR-019 forbids touching it, and nothing here needs a new column.

**Rationale**: "Mark published" already fully captures both real delivery and the zero-subscriber case
(§7 below); no `deliveryCount` column is needed to distinguish them, because nothing in this feature's
requirements reads that distinction back from the row later — SC-006 is proven by the lag measure not
rising, not by inspecting individual rows.

## 7. Zero-subscriber events: no new state, same "published" marker

**Decision**: An event type with no configured queue is marked published on its first claim, using the
identical `markOutboxEventsPublished` call as an event with real destinations. No separate column, no
separate code path in persistence — the branch is entirely in `apps/worker`'s tick: resolve
destinations, publish to however many there are (zero is a valid count), mark published either way.

**Rationale**: Simplicity: the row's only two states that matter to this feature are "claimed and
handled" and "not yet claimed," and `published_at` already expresses exactly that.

## 8. `causationId`: not a real field, not something this feature adds

**Finding**: `OutboxEventToAppend` (`packages/kernel/src/outbox.port.ts`) has exactly five fields —
`eventType`, `aggregateType`, `aggregateId`, `payload`, `correlationId`. No producing context (spec
006, 008, 009, 010) has ever populated a `causationId`, despite ADR-005's Consequences section
describing one as part of "every event." This is a pre-existing gap between the ADR's aspiration and
what was actually built, not something introduced or hidden by this feature.

**Decision**: The relay forwards exactly the envelope `OutboxEventToAppend` already defines. Spec.md's
FR-005 is satisfied by that forwarding: there is no `causationId` to drop, because none was ever
written. If a future producing context adds one to its `payload`, the relay passes it through
unchanged like any other payload field, no relay change required. This feature does not retrofit
`causationId` onto Layer 1/2, which FR-019 places out of scope.

## 9. Two liveness signals, not one, and they mean different things

**Finding**: `SweepScheduler`'s existing stall alert fires when a sweep's last *success* is older than
three cadences. At a one-second cadence, that is three seconds — appropriate for the relay's own tick
hanging or crashing, but far tighter than SC-010's 5-minute business threshold, and answering a
different question.

**Decision**: Keep both signals, deliberately not unified:
- The scheduler's existing stall alert (`ALERT sweep_stalled sweep=outbox-relay ...`, ~3 s) answers
  "has the tick loop itself stopped completing" — a process-level symptom (crash, deadlock, an
  unbounded hang inside one tick). This satisfies FR-025 with zero new code.
- A new, purpose-built lag alert (`ALERT outbox_lag_seconds=... threshold=300`), computed from
  `measureOutboxLag` inside the tick and logged once when crossed, answers "is data actually backing
  up" — which can happen even while the tick keeps completing on schedule, for example if ElasticMQ is
  reachable but every publish is failing and retrying. This satisfies FR-016/SC-010, at the number the
  clarification session fixed, and is built exactly like `report-overdue-tasks.sweep.ts`'s existing
  `OVERDUE_LAG_ALERT_SECONDS = 300` — the same number, independently arrived at for the same reason.

**Rationale**: Collapsing these into one alert would hide the difference between "the relay is dead"
and "the relay is running but something downstream is failing," which are different problems with
different fixes. Both are cheap: the first is already built, the second is a threshold check reusing
`measureOverdueLag`'s shape.

## 10. Multi-instance safety: proven by a test, not by deploying twice

**Decision**: FR-023 ("more than one relay instance without duplicate claims") is proven by an
integration test that runs two concurrent `claimUnpublishedOutboxEvents` calls against the same seeded
rows and asserts no row appears in both result sets. Stage 0's `docker-compose.yml` runs exactly one
`worker` container; this feature does not run two.

**Rationale**: `FOR UPDATE SKIP LOCKED` is a database-level guarantee, independent of how many
processes call it — proving it needs concurrent callers, not a second deployed instance. Actually
running two worker containers at Stage 0 would be a deployment change with no product benefit yet
(nothing currently justifies scaling the worker), and is explicitly not this feature's concern.

## 11. The stub consumer is a test fixture, not shipped code

**Decision**: `apps/worker/src/test-support/stub-consumer.ts` is imported only by integration specs. It
is not registered in `main.ts` and does not run in a deployed worker.

**Rationale**: FR-012 requires proving the base consumer class end-to-end without building business
logic for another context. A consumer that ran continuously in production, consuming from a queue no
real event ever routes to, would be dead code pretending to be a feature — worse than not shipping it
at all, and the kind of "looks finished, does nothing" half-implementation this project's own working
agreement rules out.

## 12. The import-restriction boundary

**Decision**: A new dependency-cruiser rule (`no-direct-sqs-access`, alongside the existing
`tasks-repositories-are-private`) forbids any module under `packages/core/**` from importing
`packages/platform`'s `sqs-message-publisher` or `sqs-consumer` modules. `apps/worker` is not
restricted — it is the one caller allowed to construct them.

**Rationale**: FR-010's actual intent, read against Principle VIII's enforcement list ("ESLint rule
restricting queue-client imports to the outbox relay"), is that no bounded context should be able to
bypass the relay and talk to SQS directly, not that no *file* outside one package may. Scoping the rule
to `packages/core/**` names the boundary that matters and matches the existing dependency-cruiser
rule's granularity (module-path patterns, not whole-package allow-lists).
