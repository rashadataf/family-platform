# ADR-018: The outbox relay's transport at Stage 0

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** Principal Engineer
- **Amends:** [ADR-005](ADR-005-event-system.md), Layer 3's transport at Stage 0 only;
  [ADR-013](ADR-013-staged-hosting-model.md), the Stage 0 container set only

## Context

[ADR-005](ADR-005-event-system.md) defines three layers. Layer 1 (in-transaction domain events) and
Layer 2 (the transactional outbox) are built and used by specs 006, 008, 009 and 010. Layer 3 is
missing: the relay that claims unpublished `outbox_event` rows and publishes them to SQS, the
per-consumer queues, and their dead-letter queues.

It has been deferred four times, each time with the same reasoning: no context consumes an event, and
SQS requires AWS, which [ADR-013](ADR-013-staged-hosting-model.md) forbids until the product holds
real personal data. Spec 009 named the trigger as "the first context that subscribes, which is
Reminders". Spec 010 (Tasks) records that Reminders cannot defer it a fifth time.

The two ADRs meet in a way neither anticipated:

- **Reminders will almost certainly be built before Stage 1.** Stage 1 is triggered by real family
  data, and nobody onboards a real family onto a product whose reminders do not work. Reminders is a
  Stage 0 feature.
- **Reminders is the first consumer, and ADR-005 requires it to consume through a queue.** At Stage 0
  there is no SQS.

So Layer 3 needs a Stage 0 transport, and whichever is chosen amends ADR-005 or ADR-013. The
constitution requires that amendment to be merged before any relay code. This ADR exists so that the
relay spec (spec 011) is not blocked on an undecided question.

**The outbox is unaffected by this decision.** Every producer writes `outbox_event` rows today, and
that stays true under every option below. Only the component that reads those rows changes.

## Decision

**At Stage 0, the relay publishes to an SQS-compatible emulator, ElasticMQ, running as one more
container in the existing Compose service set, locally and on the VPS, with message persistence
enabled. At Stage 1 the same relay publishes to real SQS, and the change is configuration, not code.**

Specifically:

1. **One transport adapter.** The relay depends on a `MessagePublisherPort`. The only adapter is
   built on the AWS SDK's SQS client, with the endpoint URL taken from validated configuration: the
   ElasticMQ container at Stage 0, and AWS's regional endpoint at Stage 1.
2. **Queues and DLQs as configuration.** ElasticMQ's config file declares each queue, its DLQ and its
   `maxReceiveCount`, mirroring what the Stage 1 Pulumi program will declare. The file is committed.
   Principle X applies to it like any infrastructure.
3. **Routing lives in the relay, in code.** A subscription table in the repository maps event type to
   consumer queue. This is ADR-005's "one queue per logical consumer" without SNS or EventBridge,
   which ADR-005 already defers.
4. **An event with no subscriber is marked published with zero deliveries.** It is not held forever
   waiting for a consumer that may never exist, which would make the outbox-lag alarm permanently red
   and therefore useless. The `outbox_event` row remains the durable record that it happened.
5. **A new consumer does not receive history.** A consumer that subscribes after events were published
   backfills through the producing context's read ports, not by replaying the outbox. The Reminders
   spec must say how.
6. **Message persistence is enabled** in ElasticMQ, so a container restart does not drop in-flight
   messages. Stage 0 holds synthetic data only, but a transport that silently loses messages in staging
   hides exactly the bug ADR-005 exists to prevent.
7. **The outbox-lag alarm** (age of the oldest unpublished row) is built with the relay, as ADR-005
   and the constitution require.

## Alternatives considered

### Postgres-backed queue (pg-boss) at Stage 0, SQS at Stage 1

ADR-005 names pg-boss as "the fallback if SQS ever becomes a problem". It adds no container, stores
jobs durably in the database that already exists, and has retries and dead-letter queues.

**Not recommended**, because Stage 0 and Stage 1 would then run different transports behind the same
port. That means two adapters and two sets of delivery semantics (visibility timeouts versus job
leases, redrive versus retry policy), and staging would never exercise the Stage 1 code path. The class
of bug staging exists to catch, such as a consumer that mishandles redelivery after a visibility
timeout, would first appear against real family data.

It is the right choice **if the founder would rather have no new container at Stage 0 than have
Stage 0/Stage 1 parity**. That is a legitimate preference, and accepting this ADR with this
alternative instead is a one-line change to the Decision section.

### pg-boss permanently, amending ADR-005 to drop SQS

Avoids the two-adapter problem by never adopting SQS. **Rejected** for the reasons ADR-005 already
gives: SQS's operational semantics, queue-depth autoscaling signals and DLQ alarms come free at
Stage 1, and replicating them on Postgres is work without product value. Reopening that decision is
outside this ADR's scope.

### Keep deferring until Stage 1

**Rejected.** It blocks Reminders on real data arriving, while real data is blocked on Reminders
working. It also leaves the constitution's "single most important operational metric", outbox lag,
unmeasurable, because nothing publishes.

### LocalStack instead of ElasticMQ

It emulates SQS and much more. **Not recommended**, because its broader surface is unneeded and its
licensing and image size have changed repeatedly. ElasticMQ does one thing, is Apache-2.0 licensed,
and is small.

## Consequences

**Positive**

- Layer 3 exists before its first consumer, and Reminders is specified against a working relay rather
  than a promise of one.
- Staging exercises the same SQS client code, the same redrive semantics and the same DLQ alarm path
  that Stage 1 production will run.
- Outbox lag becomes measurable and alertable.

**Negative**

- **One more container at Stage 0**, locally and on the VPS, which ADR-013's Stage 0 set did not
  include. Mitigation: no new cost, it lives on the existing staging Docker network, and it holds only
  event envelopes. Principle VI already keeps personal data out of event payloads, and spec 010
  asserts that in a test.
- **A new runtime dependency**, the AWS SDK's SQS client, needing the constitution's
  dependency justification in the relay's pull request.
- **An emulator is not the real service.** Fidelity gaps (ElasticMQ's FIFO behaviour, exact
  visibility-timeout edge timing) remain. Mitigation: the platform uses standard queues only (ADR-005),
  where ElasticMQ's fidelity is strongest, and Stage 1's first deploy includes the relay's integration
  suite against real SQS.

## To be verified in spec 011's research, before implementation

- ElasticMQ's message-persistence mode survives a container restart with in-flight and delayed
  messages intact.
- Its redrive-to-DLQ after `maxReceiveCount` matches SQS for standard queues.
- The official image's maintenance status and current licence.

If any of these fails, this ADR is revisited before spec 011 proceeds. It is not worked around.

## Triggers for revisiting

- Stage 1 begins: the Stage 0 transport is retired, and this ADR's Stage 0 clause becomes history.
- A second independently deployed service needs events: EventBridge, per ADR-005, unchanged.
- ElasticMQ fails any verification above.
