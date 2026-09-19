# Contract: Relay Interfaces, Topology and Boundary

**Feature**: [spec.md](../spec.md) | **Plan**: [plan.md](../plan.md) | **Data model**: [data-model.md](../data-model.md)

No HTTP API — this feature has no route and no `ts-rest` contract. Its interface is: two ports a
future consumer builds against, the queue-topology configuration format, and the import boundary that
keeps queue access inside the relay. Everything here is depended on by future code (a real consumer,
Stage 1's provisioning) or by CI — changing any shape below after a real consumer exists is a breaking
change to that consumer.

---

## 1. `MessagePublisherPort` (`packages/kernel`)

```ts
export interface MessageToPublish {
  readonly queueName: string;
  readonly body: string; // the envelope, already serialised — see §3
  readonly deduplicationId: string; // the outbox_event id; not an SQS FIFO feature, just a log/debug aid at Stage 0
}

export interface MessagePublisherPort {
  send(message: MessageToPublish): Promise<void>;
  /** `ApproximateNumberOfMessages` for the named queue — what FR-014/FR-017's "observable at
   *  all times" read each tick, for a DLQ's depth and for a live queue's pending count alike. */
  approximateDepth(queueName: string): Promise<number>;
}
```

Implemented once, by `SqsMessagePublisher` in `packages/platform`, built on `@aws-sdk/client-sqs`, with
the endpoint (ElasticMQ at Stage 0, real SQS at Stage 1) taken from validated worker configuration —
never branched on in application code (ADR-018: "the change is configuration, not code").

## 2. `ProcessedEventPort` (`packages/kernel`)

```ts
export interface ProcessedEventPort {
  /** `true` if this (queue, event) pair has already been handled. */
  wasProcessed(queueName: string, eventId: string): Promise<boolean>;
  /** Records that it now has. A caller with its own transaction should construct the
   *  implementation against that same transaction client to get same-transaction atomicity — see §4. */
  markProcessed(queueName: string, eventId: string): Promise<void>;
}
```

Implemented once, by `packages/persistence`'s `PrismaProcessedEventRepository`
(`processed-event.repository.ts`), against the `processed_event` table
([data-model.md](../data-model.md)). Takes `PrismaClient | Prisma.TransactionClient` in its
constructor, exactly as `PrismaOutboxRepository` already does — the same "construct against the
caller's own transaction" pattern Layer 2 established.

## 3. The event envelope on the wire

The JSON body a queue message carries. Produced by the relay from an `outbox_event` row, unchanged
from what `OutboxEventToAppend` (`packages/kernel`, Layer 2, unmodified by this feature) already
defines — this feature adds no field:

```json
{
  "eventId": "01930000-0000-7000-8000-000000000000",
  "eventType": "tasks.TaskCreated.v1",
  "aggregateType": "Task",
  "aggregateId": "01930000-0000-7000-8000-000000000001",
  "occurredAt": "2026-09-18T09:00:00.000Z",
  "correlationId": "01930000-0000-7000-8000-000000000002",
  "payload": { "familyId": "...", "taskId": "...", "...": "..." }
}
```

`eventId` is `outbox_event.id`; it is the key `ProcessedEventPort` is checked and recorded against. No
`causationId` — no producing context populates one today (research.md §8); if one is ever added, it
travels inside `payload` like any other identifier and this contract does not change.

## 4. Base idempotent consumer (`SqsConsumer`, `packages/platform`)

`packages/platform` must stay database-agnostic — it knows nothing of Prisma or transactions
(Principle IV: persistence lives only in `packages/persistence`). So `SqsConsumer` cannot itself open
"the same transaction as the handler's work"; it can only guarantee that idempotency is *checked*
before the handler runs and *recorded* after it succeeds, on the handler's own say-so:

```ts
export type ConsumerOutcome = 'processed' | 'duplicate';

export interface ConsumerHandler {
  /** Parses the envelope itself (Principle II). Returns 'duplicate' only if it independently
   *  detects a repeat — ordinarily it returns 'processed' and lets SqsConsumer's own
   *  ProcessedEventPort check be the thing that skips a genuine duplicate delivery. */
  (envelope: unknown): Promise<ConsumerOutcome>;
}

export interface SqsConsumerOptions {
  readonly queueName: string;
  readonly handler: ConsumerHandler;
}

export class SqsConsumer {
  constructor(options: SqsConsumerOptions, processedEvents: ProcessedEventPort);
  /** Long-polls once; processes at most the batch SQS/ElasticMQ returns; never throws past this call. */
  pollOnce(): Promise<{ handled: number; duplicates: number; failed: number }>;
}
```

For every message received: parse `eventId` out of the envelope, call `processedEvents.wasProcessed`;
if already recorded, acknowledge without calling `handler` (FR-011); otherwise call `handler`, and on
success call `processedEvents.markProcessed`, then acknowledge. A `handler` that throws leaves the
message unacknowledged, letting SQS/ElasticMQ's own redelivery and `maxReceiveCount` govern retry and
eventual dead-lettering (FR-013) — `SqsConsumer` does not implement its own retry logic.

**True same-transaction atomicity is a real consumer's own responsibility, not `SqsConsumer`'s.**
`ProcessedEventPort`'s implementation, `packages/persistence`'s `PrismaProcessedEventRepository`,
takes a `PrismaClient | Prisma.TransactionClient` in its constructor exactly as `PrismaOutboxRepository`
already does (Layer 2's own pattern). A future real consumer with its own unit of work constructs its
`ProcessedEventPort` against that same transaction client and calls `markProcessed` from inside it,
achieving the "same transaction as its work" ARCHITECTURE §7.3 describes. `SqsConsumer` supplies the
transport and the default (non-transactional) check-then-mark sequence; a consumer that needs stronger
atomicity gets it by constructing its own repository, not by asking `SqsConsumer` for it. This
feature's stub consumer ([research.md §11](../research.md)) has no real domain work to share a
transaction with, so it uses `SqsConsumer`'s default sequence as-is — the gap this leaves (a crash
between the handler succeeding and `markProcessed` recording it, which could redeliver and reprocess
once) is a known, accepted limitation of the *default* path, not of the mechanism as a whole.

## 5. Queue topology (`apps/worker/src/relay/queue-topology.ts`)

```ts
export interface QueueDefinition {
  readonly name: string;
  readonly dlqName: string;
  readonly maxReceiveCount: number; // default 5
  readonly subscribedEventTypes: readonly string[];
}

export const QUEUE_TOPOLOGY: readonly QueueDefinition[] = [
  {
    name: 'outbox-relay-verification',
    dlqName: 'outbox-relay-verification-dlq',
    maxReceiveCount: 5,
    subscribedEventTypes: ['relay.VerificationPing.v1'], // test-only event type, never emitted by a real context
  },
  // A real context's first real subscription is added here by the feature that needs it
  // (Reminders, most likely), not by this one.
];
```

`relay.VerificationPing.v1` is a synthetic event type the integration test suite publishes directly to
the outbox for User Story 1/2's tests; no producing context ever emits it.

### Rendered ElasticMQ configuration (`infrastructure/elasticmq/queues.conf`, generated + committed)

```hocon
queues {
  outbox-relay-verification {
    defaultVisibilityTimeout = 30 seconds
    delay = 0 seconds
    receiveMessageWait = 0 seconds
    deadLettersQueue {
      name = "outbox-relay-verification-dlq"
      maxReceiveCount = 5
    }
  }
  outbox-relay-verification-dlq {
    defaultVisibilityTimeout = 30 seconds
  }
}
messages-storage {
  enabled = true
}
```

Generated by `render-elasticmq-config.ts` from `QUEUE_TOPOLOGY`; a CI-run test re-renders and diffs
against the committed file (research.md §4). Adding a queue means editing `queue-topology.ts` only —
the `.conf` file is never hand-edited.

## 6. Environment configuration (`apps/worker`)

Following `worker-env.ts`'s existing validate-at-boot pattern exactly (Principle II):

| Variable | Required | Meaning |
|---|---|---|
| `RELAY_QUEUE_ENDPOINT` | yes | ElasticMQ's URL at Stage 0 (`http://elasticmq:9324`); a real SQS regional endpoint at Stage 1 |
| `RELAY_QUEUE_REGION` | yes | Passed to the AWS SDK client; a fixed placeholder value at Stage 0 (ElasticMQ ignores it, the SDK still requires one) |
| `SWEEP_OUTBOX_RELAY_INTERVAL_SECONDS` | no, default `1` | Follows the existing per-sweep cadence override convention |

A missing or malformed `RELAY_QUEUE_ENDPOINT`/`RELAY_QUEUE_REGION` fails worker boot, exactly as a bad
`DATABASE_URL` or `MAIL_HOST` already does.

## 7. Boundary rule (`.dependency-cruiser.cjs`)

New rule `no-direct-sqs-access`: forbids any module matching `packages/core/**` from importing
`packages/platform/src/sqs-message-publisher` or `packages/platform/src/sqs-consumer` (or their
barrel re-exports). `apps/worker` is unrestricted. Mirrors the existing `tasks-repositories-are-private`
rule's shape (a source-pattern / forbidden-target-pattern pair, not a whole-package allow-list).

## 8. What is explicitly *not* a contract here

- **Stage 1's actual SQS/DLQ provisioning.** A later feature's Pulumi program is the contract for that;
  this feature's contract is `QUEUE_TOPOLOGY`, which that program is expected to import.
- **Any real consumer's handler shape beyond `ConsumerHandler`'s signature.** What a handler does with
  a parsed envelope is entirely that future feature's concern.
