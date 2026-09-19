# Feature Specification: Outbox Relay

**Feature Branch**: `011-outbox-relay`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "Implement Layer 3 of the platform's event system (ARCHITECTURE.md section 7.3, ADR-005) as spec 011: the transactional outbox relay, its consumer queues, and their dead-letter queues. This is the piece ADR-005 named as mandatory for every cross-context side effect but has been deferred four times because no context consumed an event yet; Family (spec 008), Calendar (spec 009) and Tasks (spec 010) already write outbox_event rows in the same transaction as their domain changes, and today nothing reads them. This feature builds the reader. Transport is decided by ADR-018, accepted alongside this spec: at Stage 0 the relay publishes to ElasticMQ, an SQS-compatible emulator running as one more container in the existing Compose service set, both locally and on the shared VPS staging environment (ADR-013); at Stage 1 the same relay publishes to real SQS, and the only change is the configured endpoint, never the code. The relay depends on a single MessagePublisherPort with one adapter, built on the AWS SDK's SQS client. Queues and their dead-letter queues are declared in a committed ElasticMQ config file, including each queue's maxReceiveCount, mirroring what the Stage 1 Pulumi program will later declare — this config file is infrastructure per Constitution Principle X and must be reviewable like any other. The relay's mechanics, exactly as ADR-005 lays out: a loop claims unpublished outbox_event rows with SELECT ... FOR UPDATE SKIP LOCKED, looks up the destination queue(s) for the event's type in a subscription table owned by the relay (event type to consumer queue, in code, not SNS or EventBridge, which ADR-005 explicitly defers), publishes, and marks the row published. An event type with no configured subscriber MUST still be marked published, with zero deliveries recorded — it must not be held forever waiting for a consumer that does not exist yet, because that would leave the outbox-lag alarm permanently red and therefore useless. ElasticMQ must run with message persistence enabled so a container restart never silently drops an in-flight or delayed message. Per Constitution Principle VIII, this feature must also deliver: the outbox-lag alarm (age of the oldest unpublished row), described in ADR-005 as the single most important operational metric in the system, exposed as an observable measure in every environment; a dead-letter queue for every consumer queue with an alert on any message arriving there; and a base idempotent-consumer class that records processing in the same transaction as the work it does. Because no bounded context has a real consumer yet — Reminders, the first intended subscriber, does not exist — this feature proves the relay and the base consumer class end-to-end with a test-only stub consumer exercising a real queue and its DLQ, not by building any business logic for another context. The ESLint rule restricting queue-client imports to the relay package, named in Principle VIII's enforcement list, must be added so no future context can bypass the relay and publish or consume directly. A new consumer that subscribes after events were already published does not receive replayed history from the outbox; backfill, if ever needed, is the future consuming context's job, done through the producing context's existing read ports, not this feature's. Out of scope: implementing Reminders, Notifications, Document Vault, AI Assistant, Billing, or any other bounded context, including any business logic that would be a genuine consumer of these events; provisioning the actual Stage 1 AWS SQS queues (the Pulumi work that reads the same committed queue/DLQ configuration this feature produces); EventBridge or SNS fan-out, both deferred by ADR-005; changing what any existing context publishes or how it writes its outbox_event rows (Layers 1 and 2 are already built and unchanged by this feature); and any UI beyond what is needed to exercise and verify the relay."

## Why now

ADR-005 named the outbox relay mandatory for every cross-context side effect and has been deferred four times since ratification, each time because no context yet consumed an event. That reasoning ran out with spec 010: Tasks publishes `TaskOverdue` to nobody, Calendar publishes `EventCreated` and its siblings to nobody, and Family's `MemberRemoved` and friends have never left the database they were written in. Reminders — the context every one of those events exists for — cannot be specified against a relay that does not exist, and ADR-018 (accepted alongside this spec) resolves the one open question, the Stage 0 transport, that was blocking it. This feature is deliberately scoped to the relay itself, proven against a stub consumer, and not to Reminders, so that the mechanism is solid before the first real business logic depends on it.

## Clarifications

### Session 2026-09-18

- Q: Under normal operation, how quickly should an event reach its consumer queue after the outbox row is written, as a measurable target for SC-001? → A: Within 5 seconds.
- Q: At what age of the oldest unpublished outbox row should the lag alarm fire as a high-severity alert, rather than just being visible as a metric? → A: 5 minutes.
- Q: How many delivery attempts should a message get before it's redirected to its dead-letter queue (maxReceiveCount)? → A: 5 attempts.

## Decisions Taken While Specifying

- **An event type with no configured subscriber is marked published with zero deliveries, not held pending one.** The alternative — leaving it unpublished until someone subscribes — would make the outbox-lag alarm permanently red from the moment this feature ships, which trains whoever watches it to ignore the one metric ADR-005 calls the most important in the system. "Nobody wants this yet" and "the relay is stuck" must stay distinguishable.
- **No replay or backfill mechanism is built.** A context that starts consuming after events were already published catches up through the producing context's existing read ports, not by replaying the outbox. Building replay now would grow the outbox into a permanent event store with its own retention and query surface, which is a different feature with a different owner, not a prerequisite for Layer 3 to work.
- **The relay is proven against a test-only stub consumer, not a real one.** Reminders does not exist, and building even a minimal real consumer here would mean writing Reminders' first slice inside a feature that is supposed to be Reminders-agnostic infrastructure. The stub exercises a real queue, a real DLQ, and the base idempotent-consumer class, which is what this feature is actually responsible for proving.
- **The relay supports more than one running instance from the start**, using `SELECT ... FOR UPDATE SKIP LOCKED` rather than a single-instance assumption. It costs nothing extra now and avoids a retrofit once anything depends on the relay always running as exactly one process.
- **Queue and DLQ topology is committed configuration, read by both the Stage 0 emulator and the eventual Stage 1 provisioning program**, rather than being defined twice. This is what makes ADR-018's "moving to Stage 1 is configuration, not code" claim true rather than aspirational.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An event a context publishes reaches its consumer, reliably (Priority: P1)

A command handler in an existing context — Family, Calendar or Tasks — commits a domain change and writes an outbox row in the same transaction, exactly as it already does today. Some time later, without anyone intervening, a message carrying that event arrives on the queue its subscription table names for it.

**Why this priority**: This is the entire point of the feature. Every other requirement exists to make this claim true even under crashes, restarts, and concurrent relay instances, not just in the easy case.

**Independent Test**: Trigger a domain change in an existing context that writes an outbox row for an event type with a configured subscription, and confirm a message carrying that event's id, type and identifiers arrives on the configured queue within 5 seconds, with no manual step.

**Acceptance Scenarios**:

1. **Given** an outbox row written by an existing context's command handler, **When** the relay next runs its claim loop, **Then** the row is published to every queue its event type is configured to reach, and the row is marked published.
2. **Given** a published message on a queue, **When** a consumer reads it, **Then** the message carries the event id, type and version, family id, occurred-at, causation id, correlation id, and the producing context's own minimal payload, unchanged from what was written to the outbox.
3. **Given** the relay process is killed between claiming a row and marking it published, **When** it restarts, **Then** the row is reclaimed and published, and the event is never permanently lost.
4. **Given** two relay instances running at the same time, **When** both attempt to claim outbox rows, **Then** no row is claimed by more than one instance at once.

---

### User Story 2 - A message a consumer cannot process is quarantined, not lost or stuck (Priority: P1)

A consumer repeatedly fails to process a specific message — a poison message, or a bug in that consumer. Instead of blocking every message behind it forever, or silently vanishing, it is moved to a dead-letter queue and someone finds out.

**Why this priority**: The product's promise is that nothing is silently forgotten. A queue that can jam on one bad message, or drop it, breaks that promise as thoroughly as the missing relay did before this feature.

**Independent Test**: Configure the stub consumer to always fail on a specific message, publish it, and confirm it appears on that queue's dead-letter queue after the configured `maxReceiveCount`, with an alert raised, while other messages on the same queue continue to be delivered.

**Acceptance Scenarios**:

1. **Given** a message delivered to a consumer more times than its queue's configured `maxReceiveCount`, **When** the last attempt fails, **Then** the message is moved to that queue's dead-letter queue and removed from the source queue.
2. **Given** a message arrives on any dead-letter queue, **When** that happens for the first time for that message, **Then** an alert is raised.
3. **Given** a message sitting on a dead-letter queue, **When** nobody has acted on it, **Then** it remains there, inspectable, rather than being retried automatically or discarded.
4. **Given** one message on a queue is failing repeatedly, **When** other messages are published to the same queue, **Then** they are still delivered to the consumer without waiting on the failing message.

---

### User Story 3 - An operator can tell whether the relay is keeping up (Priority: P2)

Someone operating the platform — today, the founder — can answer "is anything backing up right now" by looking at one number, in any environment, without reading application logs or querying the database by hand.

**Why this priority**: ADR-005 calls outbox lag the single most important operational metric in the system, precisely because a relay that silently stops running produces no error anywhere else — requests still succeed, because outbox writes are part of the same transaction as the domain change that already returned 201.

**Independent Test**: Stop the relay process, allow outbox rows to accumulate, and confirm the observable lag measure rises and is visible without reading logs. Restart the relay and confirm it falls back to zero.

**Acceptance Scenarios**:

1. **Given** the relay is running normally, **When** the lag measure is read, **Then** it reflects the age of the oldest currently unpublished outbox row, at or near zero under normal load.
2. **Given** the relay process is stopped or fails repeatedly, **When** time passes, **Then** the lag measure rises and remains visible as a single observable number, distinguishable from "the relay is running but slow" (see Edge Cases).
3. **Given** any queue with messages on its dead-letter queue, **When** the count is read, **Then** it is observable at all times, not only at the moment a message first arrived there.

---

### User Story 4 - An event nobody consumes yet does not jam the relay or the alarm (Priority: P2)

Today, every event Family, Calendar and Tasks publish has zero real subscribers. That must not mean those rows sit unpublished forever, and it must not mean the lag alarm is permanently red from the day this feature ships.

**Why this priority**: Without this, the very first thing that happens after deployment is a false alarm that everyone learns to ignore, which defeats User Story 3 before it has a chance to matter.

**Independent Test**: Trigger a domain change producing an event type with no entry in the subscription table, and confirm the outbox row is marked published immediately, with zero deliveries recorded, and the lag measure does not grow because of it.

**Acceptance Scenarios**:

1. **Given** an outbox row for an event type with no configured subscription, **When** the relay claims it, **Then** it is marked published with zero recorded deliveries, on the first claim.
2. **Given** a steady stream of such rows, **When** the lag measure is read over time, **Then** it does not rise because of them.
3. **Given** a subscription is later added for a previously-unrouted event type, **When** new events of that type are published after the subscription is added, **Then** they are delivered to the new queue; events published before the subscription existed are not retroactively delivered (see Decisions).

---

### Edge Cases

- An event type has no entry at all in the subscription table, as opposed to an entry naming zero queues. Both are treated identically: published immediately, zero deliveries, no alert. The relay does not distinguish "deliberately no subscriber yet" from "someone forgot to configure this", because at this stage every event type is in that state and a distinction with no consumer to act on it would only be noise.
- The relay is running but falling behind — claiming and publishing slower than events are produced — as opposed to not running at all. The lag measure rises in both cases; the requirement is that the relay's own liveness is observable as a separate signal, so the two are distinguishable (FR-025).
- ElasticMQ's container restarts while a message has been published but not yet acknowledged by any consumer. With persistence enabled, the message survives the restart and delivery resumes; it is not lost and not silently duplicated beyond ordinary at-least-once redelivery.
- A message is redelivered exactly at its queue's `maxReceiveCount` boundary. It is redriven to the dead-letter queue on the attempt that exceeds the configured count, not one attempt early or late.
- The processed-events ledger a consumer uses for idempotency grows without bound over time. This feature does not prune it; retention for that ledger is deferred (see Assumptions), and its unbounded growth is not treated as a defect of this feature.
- A downstream consumer's queue is completely blocked (for example, its consumer is down entirely). Outbox rows for that event type continue to be claimed and published to the queue; the queue itself, not the outbox, is where backlog accumulates, and that backlog is visible through the queue's own observable depth (FR-017).
- The relay and the database observe different wall clocks. The lag measure is computed from the database's own transaction timestamps, not the relay process's local clock, so clock skew on the relay's host does not distort it.

## Requirements *(mandatory)*

### Functional Requirements

**Claiming and publishing**

- **FR-001**: System MUST run a relay process that repeatedly claims unpublished `outbox_event` rows using `SELECT ... FOR UPDATE SKIP LOCKED`, so that more than one relay instance can run at the same time without claiming the same row twice.
- **FR-002**: For each claimed row, System MUST resolve the event's type to zero or more configured destination queues through a subscription table the relay owns, and MUST publish one message per destination queue.
- **FR-003**: System MUST mark a claimed row published only after every one of its resolved destinations has successfully received the message, and MUST leave a row unpublished and eligible for a later claim if any publish attempt fails.
- **FR-004**: An event type with no configured destination MUST be marked published with zero recorded deliveries on its first claim, and MUST NOT be retried or held pending a future subscription.
- **FR-005**: System MUST publish exactly the event id, event type and version, family id, occurred-at, causation id, correlation id, and the producing context's own minimal payload, unchanged from what was written to the outbox. It MUST NOT add, enrich or re-derive fields.
- **FR-006**: System MUST preserve at-least-once delivery: a message published to a queue MUST eventually be delivered to that queue's consumer even across relay restarts, transport failures, and process crashes between claiming a row and confirming its publish.

**Transport**

- **FR-007**: System MUST publish through a single `MessagePublisherPort` with exactly one adapter, built on the AWS SDK's SQS client, whose endpoint is taken from validated configuration.
- **FR-008**: At Stage 0, System MUST run and publish to ElasticMQ, deployed as an additional container in the existing local and VPS-staging service set, per ADR-018, with message persistence enabled so a container restart does not drop in-flight or delayed messages.
- **FR-009**: System MUST declare every queue and its dead-letter queue, including a `maxReceiveCount` of 5 unless a specific queue's consumer states a documented reason for a different value, in a single committed configuration file consumed by the Stage 0 ElasticMQ container, structured so that a later feature's Stage 1 provisioning can read the same declarations, so that moving from Stage 0 to Stage 1 changes only the configured endpoint, never the relay's code or its queue topology.
- **FR-010**: System MUST restrict the ability to construct an SQS or ElasticMQ client to the relay's own package, enforced by a static lint rule, so no other package can publish or consume outside the relay.

**Idempotent consumption**

- **FR-011**: System MUST provide a base consumer implementation that, for every message it handles, checks a processed-events ledger keyed on event id within the same transaction as its work, and is a no-op — acknowledged, not reprocessed — on a duplicate delivery.
- **FR-012**: System MUST prove the base consumer's idempotency and the relay's delivery guarantee end-to-end using a test-only stub consumer wired to a real queue, without implementing business logic belonging to any other bounded context.

**Dead-letter handling**

- **FR-013**: System MUST route a message to its queue's dead-letter queue once that queue's configured `maxReceiveCount` is exceeded, matching SQS standard-queue redrive semantics.
- **FR-014**: System MUST raise an alert the first time a message arrives on any dead-letter queue, and MUST make the current count of messages on each dead-letter queue observable at all times, not only at the moment of arrival.
- **FR-015**: A message on a dead-letter queue MUST NOT be silently discarded, retried automatically, or lost; it MUST remain inspectable until an operator acts on it.

**Observability**

- **FR-016**: System MUST expose the age of the oldest currently unpublished `outbox_event` row as a continuously observable measure, in every environment where the relay runs, and MUST raise a high-severity alert when that age exceeds 5 minutes.
- **FR-017**: System MUST expose, per queue, the count of messages successfully delivered, the count currently pending, and the count on its dead-letter queue, as observable measures.
- **FR-018**: System MUST record enough about each publish and delivery attempt to answer "why did this happen" for any single event, without logging the contents of any payload beyond the identifiers it already carries.
- **FR-025**: System MUST make it observable, independent of outbox lag, whether the relay process itself is currently running, so a stopped relay and a running-but-slow relay are distinguishable.

**Boundaries**

- **FR-019**: System MUST NOT modify how any existing context writes its domain changes or its `outbox_event` rows; Layers 1 and 2, already built by specs 006, 008, 009 and 010, remain unchanged.
- **FR-020**: System MUST NOT provide a mechanism for a newly subscribing consumer to receive events published before it subscribed; backfill, if a future context needs it, is that context's own responsibility through an existing read port.
- **FR-021**: System MUST NOT implement EventBridge or SNS fan-out; routing is a subscription table read by the relay, in code and configuration, exactly as ADR-005 and ADR-018 specify.

**Resilience and operation**

- **FR-022**: A relay crash or restart at any point in the claim-publish-mark cycle MUST result in the affected row being reclaimed and retried, never permanently stuck unpublished and never silently dropped.
- **FR-023**: System MUST tolerate more than one relay instance running at the same time without duplicate claims of the same row, relying on `FOR UPDATE SKIP LOCKED` rather than any external lock or leader election.
- **FR-024**: System MUST run the relay as recurring background work, started automatically in every environment where the platform runs, consistent with the platform's existing background-work operating model (Calendar's horizon rebuild, Tasks' overdue sweep), never invoked by hand.

### Key Entities

- **OutboxEvent**: the existing record, written by a producing context in the same transaction as its domain change (Layer 2, already built), that a cross-boundary side effect must happen. This feature reads and claims these rows; it does not write them or change their shape.
- **Subscription**: the relay's own mapping from an event type to the queue or queues that should receive it. Configuration owned by this feature, not user or family data.
- **ProcessedEvent**: a consumer's ledger of event ids it has already handled, written in the same transaction as the work it does. The mechanism that turns at-least-once delivery into effectively-once processing.
- **QueueConfiguration**: the committed declaration of each queue, its dead-letter queue, and its `maxReceiveCount`, read by the Stage 0 ElasticMQ container and, in a later feature, the Stage 1 provisioning program.
- **RelayLiveness**: whether the relay process is currently running, observed independently of how far behind it is.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Under normal operation, an outbox row written by any existing context is delivered to every one of its configured consumer queues within 5 seconds of being written, with no manual intervention.
  - *Status: **Verified** — `outbox-relay.sweep.integration.spec.ts` (T024); quickstart Scenario 1 against the live stack.*
- **SC-002**: A relay process killed at any point in its claim-publish-mark cycle and restarted loses zero events across 100% of rows that were in flight at the moment of the crash.
  - *Status: **Verified** — deterministic interrupt between send and commit (T025); quickstart Scenario 2 (the live kill is racy, so T025 is the proof).*
- **SC-003**: Running two relay instances concurrently against the same outbox produces zero duplicate claims of the same row.
  - *Status: **Verified** — two concurrent claimers, provably overlapping (T026).*
- **SC-004**: 100% of messages that exceed a queue's `maxReceiveCount` are found on that queue's dead-letter queue, never dropped and never retried indefinitely.
  - *Status: **Verified** — exactly 5 receives, then on the DLQ and off the source queue (`dead-letter.integration.spec.ts`, T031); quickstart Scenario 3.*
- **SC-005**: An operator can determine how far behind the relay is from a single observable number, in every environment, without reading application logs.
  - *Status: **Partly verified** — the lag is one number, `outbox_relay_lag_seconds=<n>`, logged every tick (T035, T038). It is read from the worker's logs, as the Stage 0 convention has it; there is no metrics pipeline, so "without reading application logs" is not met.*
- **SC-006**: Publishing an event type with no configured subscriber never causes the outbox-lag measure to grow because of it, across a sustained stream of such events.
  - *Status: **Verified** — unsubscribed rows published on first claim, nothing sent, lag 0 after a burst of 50 (T041); quickstart Scenario 4 through the real Tasks API.*
- **SC-007**: The relay's transport adapter runs unmodified against both the Stage 0 ElasticMQ endpoint and a real SQS endpoint in testing, so the Stage 0 to Stage 1 move is verified to be configuration-only.
  - *Status: **Not verified** — the endpoint comes from configuration with no code branch, but nothing has been run against a real SQS endpoint.*
- **SC-008**: 100% of duplicate deliveries of the same event id to the stub consumer produce zero duplicate side effects.
  - *Status: **Verified** — a duplicate delivery runs the handler once (`stub-consumer.integration.spec.ts`, T028).*
- **SC-009**: No event payload observed in transit or in logs contains anything beyond identifiers and correlation metadata.
  - *Status: **Verified for logs** — no payload in any relay log line, statically (`telemetry.spec.ts`) and at runtime including a failing send (T044). Not checked for messages in transit: the relay forwards a payload unchanged (FR-005), so its content is each producing context's to keep to identifiers.*
- **SC-010**: A relay stopped or falling behind for more than 5 minutes produces a high-severity alert; below that threshold, the rising lag is visible as a metric but does not page anyone.
  - *Status: **Partly verified** — the alert fires once when the oldest unpublished row is over 300 s after a tick, and not again until recovery (T035); the scheduler flags a relay that stops succeeding (T036). It does **not** fire for a relay that was stopped and then catches up on restart: the lag is measured after the tick's own claim, so quickstart Scenario 5 fails as written (tasks.md T047).*

## Data Handling and Compliance

This feature introduces no new product or personal data of its own. Assessed against the five mandatory questions from Constitution Principle XI:

1. **Personal data stored and its purpose**: None directly. The relay reads `outbox_event` rows that existing contexts already write, and those rows are already restricted, by ARCHITECTURE.md section 7.3 and by this spec's own FR-005 and SC-009, to identifiers and correlation metadata — never names, document content, or other authored personal data. The relay's own tables (subscriptions, processed-events ledgers, queue configuration) hold no personal data.
2. **Effect of a family member's account deletion**: Not applicable directly. Any event referencing a deleted member's id was already published or is in flight at the moment of deletion, and this feature does not retroactively alter delivered messages. The producing context's own erasure handling (established in specs 008–010) governs what happens to the underlying record; this feature only relays the fact that a change occurred.
3. **Effect of a whole family's erasure**: Not applicable directly, for the same reason. This feature holds no family-scoped data of its own to erase.
4. **Appearance in a user's data export**: Not applicable. Nothing this feature stores is user-owned or user-facing data.
5. **Retention period**: Published `outbox_event` rows' own retention is owned by Layer 2, not this feature. This feature's processed-events ledger is retained without an enforced pruning policy for now (see Assumptions); dead-letter messages are retained until an operator acts on them, which is a deliberate choice (FR-015), not an oversight.

Two handling requirements arise, both security rather than privacy concerns:

- **Logs must not become a second, less-controlled copy of event content.** FR-018 requires enough logging to answer "why did this happen" without logging payload contents beyond identifiers, for the same reason Principle VI keeps personal data out of logs generally.
- **The dead-letter alert itself must not leak payload content** into whatever channel raises it (for example, a paging or chat integration); the alert names the queue, the message id and the failure count, not the message body.

## Out of Scope

- **Every bounded context this relay might eventually serve**: Reminders, Notifications, Document Vault, AI Assistant, Billing and Entitlements, Audit and Compliance, and Reference and Locale. This feature builds the pipe; it builds no business logic that would count as a genuine consumer.
- **Provisioning the actual Stage 1 AWS SQS queues.** This feature produces the committed queue and DLQ configuration a later feature's Pulumi program will read; it does not write that program.
- **EventBridge or SNS fan-out**, both explicitly deferred by ADR-005 until a second independently deployed service needs these events.
- **Any change to what an existing context publishes, or how it writes its `outbox_event` rows.** Layers 1 and 2 are already built by specs 006, 008, 009 and 010 and are unchanged here.
- **Replay or backfill of events published before a consumer subscribed** (see Decisions).
- **Pruning or retention policy for the processed-events ledger.** Deferred (see Assumptions).
- **Any user interface** beyond what is needed to exercise and verify the relay.

## Assumptions

- **A single committed subscription table starts empty of real routes.** Every event type currently published has no real consumer; the stub consumer proves the mechanism on a queue reserved for that purpose, not on a queue any existing event type routes to in production configuration.
- **ElasticMQ's persistence, redrive and maintenance status are verified in this feature's own research phase**, per ADR-018's explicit "to be verified" list, before implementation proceeds. If any of those checks fails, ADR-018 is revisited rather than worked around.
- **The processed-events ledger's retention is deferred to a later feature.** It grows without bound under this feature alone; at current and foreseeable Stage 0 volumes this is not operationally significant, and adding a pruning policy now would be speculative given no consumer yet produces real volume.
- **One relay deployment serves every existing context.** There is no per-context relay; the subscription table is the single place event-type-to-queue routing is declared, consistent with ADR-005's "one queue per logical consumer" model.
- **Observability here means metrics and logs consumable by the platform's existing operational tooling**, not a new dashboard product; this feature exposes the measures, and wiring them into whatever the founder already watches is an operational task, not a new UI.
- **The stub consumer and its queue are test/verification fixtures**, not a template another context is expected to extend directly; a future real consumer is expected to use the base idempotent-consumer class, not the stub itself.
