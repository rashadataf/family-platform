# ADR-005: Event system — domain events, transactional outbox, SQS

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Principal Engineer

## Context

The platform needs asynchronous work and internal eventing: document processing, OCR, AI extraction, notification delivery, reminder scheduling, and later data synchronisation and recommendation generation. The blueprint names domain events, application events, SQS, EventBridge and the outbox pattern, and asks when each applies.

These are not competing options. They sit at different layers and the actual decision is which layers exist and what the rules are for crossing them. Choosing "SQS" without deciding how a message gets into SQS is the mistake that causes the failure this ADR is mostly about.

Two product requirements dominate:

**Nothing may be silently lost.** The value proposition is "we will not let you forget". A document uploaded but never processed, or a reminder that was scheduled but never fired, is not a degraded experience, it is the product failing at the exact thing it exists to do, and failing invisibly.

**Reminder generation must be deterministic and auditable.** The blueprint states this directly. "Why did the app tell me this" must be answerable from stored data, months later.

## Decision

Three layers, with strict rules about which to use.

### Layer 1 — Domain events, in-process, in-transaction

Aggregates record events. The command handler dispatches them after persisting, inside the same database transaction.

**Use for:** derived state within a single bounded context. Materialising calendar occurrences after a recurrence rule changes. Spawning the next instance of a recurring task on completion.

**Never use for:** anything crossing a context boundary, anything doing I/O, anything that may fail independently of the transaction.

**Rationale:** these are consistency mechanisms, not integration mechanisms. Keeping them synchronous and transactional means an aggregate and its derived state are never observed inconsistently.

### Layer 2 — Transactional outbox (mandatory for every cross-boundary effect)

The command handler writes its domain change and an `outbox_event` row in **one transaction**. A relay loop in the worker claims unpublished rows with `SELECT ... FOR UPDATE SKIP LOCKED`, publishes to SQS, and marks them published.

**Use for:** every effect crossing a context boundary or a process boundary. No exceptions and no case-by-case judgement.

**Rationale — this is the core of the ADR.** Without an outbox, a handler does `INSERT document; COMMIT; sqs.send(...)`. If the process dies, the network blips, or SQS throttles between the commit and the send, the document exists and nothing will ever process it. No error surfaces anywhere, because the request already returned 201. The family's passport sits in the vault, never scanned, no expiry extracted, no reminder created. They discover it at an airport.

The inverse ordering, sending before committing, is worse: the worker can receive a message referencing a row that does not exist yet or never will.

The outbox makes the state change and the intent to publish atomic. The relay then guarantees at-least-once delivery, and idempotent consumers turn at-least-once into effectively-once. The cost is one table, one polling loop and one discipline rule.

### Layer 3 — SQS standard queues with dead-letter queues

**Use for:** all inter-process work. One queue per logical consumer, each with a DLQ after a defined `maxReceiveCount`.

Standard queues, not FIFO. FIFO's ordering guarantee is not needed because consumers are idempotent and order-tolerant, and FIFO's throughput limits and message-group semantics are cost without benefit. Where per-document ordering matters, it is enforced by an optimistic-concurrency version on the aggregate, which is required for correctness anyway and does not depend on queue semantics.

**Idempotency is mandatory, not encouraged.** Every consumer writes to a `processed_events` table keyed on event id, in the same transaction as its work. Re-delivery becomes a no-op. A consumer without this is a bug and is rejected in review.

**DLQ policy.** A message reaching a DLQ raises an alert. DLQs are not a graveyard; they are an incident queue with a documented redrive runbook. An unattended DLQ is the same silent-loss failure this ADR exists to prevent, wearing a different hat.

### Reminder scheduling — a database sweep, not scheduled callbacks

`ScheduledReminder` rows carry a `fire_at`. A worker sweep queries `fire_at <= now() AND state = 'pending'` on a fixed cadence, claims rows and emits `ReminderDue` through the outbox.

This is a deliberate choice against the more obvious option of creating a per-reminder EventBridge schedule or an SQS delayed message. The reasoning is specific to the auditability requirement:

| Property | Database sweep | Per-reminder scheduled callback |
|---|---|---|
| "Why did this fire?" | `SELECT` the row: rule id, rule version, source aggregate | Reconstruct from logs, if they are retained |
| "What will fire next week?" | A query | Not directly answerable |
| Cancel or reschedule | Update or delete a row | Delete a cloud resource, or fire and discard |
| Recovery after an outage | Automatic, the sweep picks up overdue rows | Missed windows are lost |
| Testing | Move an injected clock | Requires mocking a cloud service |
| Cost at 1M reminders | A query on an index | 1M scheduler resources |

The sweep is also trivially replayable, which matters after any incident. The trade is a small, bounded latency, up to one sweep interval, which for reminders measured in days is irrelevant.

### EventBridge — deferred, with a defined adoption trigger

**Not adopted for the MVP.**

EventBridge is the right tool for routing events between independently deployed consumers, fanning out to multiple subscribers with content-based filtering, and integrating third parties. None of that exists yet. There are two processes from one codebase, and the routing decision, which consumer handles which event, is expressed more clearly in code than in cloud console rules.

Adopting it now would cost: per-event charges on a high-volume internal bus, a schema registry to maintain, routing logic split between code and infrastructure, worse local development, and harder debugging because the routing table is not in the repository.

**Adopt EventBridge when** a second, independently deployed service needs to consume events the monolith already publishes. That is precisely the extraction moment described in [ADR-002](ADR-002-modular-monolith.md). Because everything already goes through the outbox, adopting it is a change to one relay component, not to any producer or any handler. That is the whole point of routing publishes through a single seam.

## Alternatives considered

### Direct publish from the command handler, no outbox

**Rejected.** This is the failure analysed above. It is the default in most codebases and it is silently lossy. The outbox is roughly 150 lines and removes an entire class of unreportable data loss.

### pg-boss — the strongest alternative, rejected

pg-boss is a job queue built on PostgreSQL, and it is genuinely attractive here.

**Its real advantage** is that enqueueing a job is an `INSERT` in the same database, so it can join the command's transaction directly. That collapses the outbox and the queue into one mechanism and removes a moving part entirely.

**Why it is still rejected:**

- **It couples job throughput to the primary database.** Document processing is the bursty, high-volume workload, and it would contend for connections and I/O with the transactional workload that serves the dashboard. Requirement 1 in [ADR-003](ADR-003-database-orm.md) makes the primary database the most precious resource in the system.
- **SQS's operational semantics are free and battle-tested.** Visibility timeouts, redrive policies, DLQs, long polling, per-queue metrics and autoscaling signals all exist without being written or operated. Replicating them on Postgres is work that adds no product value.
- **Queue depth as an autoscaling signal.** The worker scales on SQS `ApproximateNumberOfMessagesVisible`. A Postgres-backed queue needs a custom metric publisher.
- **Cost is not the differentiator.** SQS at MVP volume is a rounding error. This is decided on operational semantics, not price.
- **The outbox is required anyway.** Even with pg-boss, cross-context integration events need an audit trail and a replayable log. The outbox table is that log. So pg-boss removes less duplication than it first appears to.

pg-boss would be the right call for a product with no AWS dependency or a strong local-first constraint. It is the fallback if SQS ever becomes a problem.

### BullMQ / Redis

**Rejected.** Requires ElastiCache or a managed Redis, which [ADR-004](ADR-004-infrastructure-as-code.md) deliberately excludes from the MVP footprint. Redis persistence is weaker than Postgres or SQS for work that must not be lost, and it adds an operational component with no compensating advantage here.

### Kafka / Kinesis

**Rejected.** Event volume is orders of magnitude below where a log-structured stream pays for itself. Kafka is significant operational burden; Kinesis has a shard-hour floor cost and a consumer model that is more complex than SQS for simple work queues. Neither offers anything this workload needs.

### Event sourcing as the primary persistence model

**Rejected**, and worth recording because it is superficially attractive given the auditability requirement.

The requirement is that reminders are auditable and that AI actions are traceable. That is satisfied by an append-only audit log plus versioned reminder rules, at a small fraction of the cost. Full event sourcing would mean projections for every read model, replay tooling, event schema versioning across the entire domain, and a much harder GDPR erasure story, since an immutable event log containing personal data is directly in tension with the right to erasure ([ARCHITECTURE.md §5.12](../ARCHITECTURE.md)). Crypto-shredding can address that, and it is a large amount of machinery for a benefit already obtained more cheaply.

## Event catalogue and conventions

Past tense, context-prefixed, explicitly versioned:

```
family.FamilyCreated.v1          documents.DocumentUploaded.v1
family.MemberAdded.v1            documents.ExtractionCompleted.v1
family.GuardianshipEstablished.v1 documents.ExtractionConfirmed.v1
calendar.EventCreated.v1         reminders.ReminderScheduled.v1
tasks.TaskAssigned.v1            reminders.ReminderDue.v1
tasks.TaskCompleted.v1           ai.ProposalCreated.v1
                                 ai.ProposalAccepted.v1
```

**Payload rules.**

- Ids and the minimum a consumer needs. Never a whole aggregate.
- **Never sensitive content.** No document text, no OCR output, no child health details, no addresses. A queue message is stored, logged and replayed; treating it as a data-sharing channel would spread personal data across systems the erasure saga does not reach. A consumer that needs content fetches it through a read port.
- Every event carries `eventId`, `familyId`, `occurredAt`, `causationId` and `correlationId`. The correlation id threads a user action through the API, the outbox, the queue, the worker and the notification, which is what makes "what happened?" answerable.
- Schema changes within a version are additive only. Anything else is a new version published alongside the old until consumers migrate.

## Consequences

### Positive

- No silent loss between a state change and its downstream effect.
- One seam for all publishing, so adopting EventBridge later touches one component.
- Reminders are inspectable before they fire, explainable after, and replayable following an outage.
- Consumers are independently retryable with backoff and DLQs, and worker autoscaling has a natural signal.
- The outbox table doubles as an integration audit log.

### Negative

- **Eventual consistency between contexts.** A document appears immediately; its extracted expiry appears seconds to minutes later. This is a UI obligation: show explicit processing state rather than pretending the work is instant.
- **Idempotency is now everyone's job.** Mitigation: a base consumer class that performs the `processed_events` check, so the correct path is the default path, and a review rule against bypassing it.
- **The relay is a component that can fall behind or stop.** Mitigation: an alarm on outbox lag, meaning the age of the oldest unpublished row, treated as a high-severity alert. This is the single most important operational metric in the system.
- **Polling has a latency floor.** One-second intervals for the outbox relay, longer for the reminder sweep. Acceptable for every current use case.
- **`processed_events` grows unboundedly.** Mitigation: a retention job trimming entries older than the maximum possible redelivery window.

### Revisit this decision when

- A second deployable needs to consume existing events, which triggers EventBridge without reopening this ADR.
- Outbox relay throughput becomes a bottleneck, which means partitioning the relay by context before changing the pattern.
- An external partner needs to subscribe to events, which requires EventBridge plus a public schema and a published-language review.
