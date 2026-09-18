import { randomUUID } from 'node:crypto';
import type { ProcessedEventPort } from '@fp/kernel';
import { createSqsClient, peekQueueMessages, SqsConsumer, SqsMessagePublisher } from '@fp/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStubConsumer, type StubConsumerCounters } from '../test-support/stub-consumer.js';
import { QUEUE_TOPOLOGY } from './queue-topology.js';

const PING = 'relay.VerificationPing.v1';

const VERIFICATION_QUEUE = QUEUE_TOPOLOGY.find((queue) => queue.subscribedEventTypes.includes(PING));
if (VERIFICATION_QUEUE === undefined) {
  throw new Error(`no queue in QUEUE_TOPOLOGY subscribes to ${PING}`);
}
const { name: QUEUE, dlqName: DLQ, maxReceiveCount: MAX_RECEIVE_COUNT } = VERIFICATION_QUEUE;

/** Host-run defaults for the compose `elasticmq` service; see `outbox-relay.sweep.integration.spec.ts`. */
const ENDPOINT = process.env.RELAY_QUEUE_ENDPOINT ?? 'http://localhost:9324';
const REGION = process.env.RELAY_QUEUE_REGION ?? 'elasticmq';

/** How long to keep polling for the redrive before the test gives up and asserts on what it has. */
const REDRIVE_BUDGET_MS = 20_000;

const client = createSqsClient({ endpoint: ENDPOINT, region: REGION });
const publisher = new SqsMessagePublisher(client);

/**
 * The client every consumer in this file polls through.
 *
 * The queue's own `defaultVisibilityTimeout` is 30 s, so a message a consumer
 * fails on is hidden for that long before its next receive, and reaching
 * `maxReceiveCount` would take over two minutes. Overriding it to zero on each
 * receive (what `peekQueueMessages` does) makes a failed message redeliverable
 * at once, without touching the queue's configured `maxReceiveCount` — the
 * redrive rule under test — or any production code.
 */
const impatientClient = createSqsClient({ endpoint: ENDPOINT, region: REGION });
impatientClient.middlewareStack.add(
  (next, context) => (args) =>
    context.commandName === 'ReceiveMessageCommand'
      ? next({ ...args, input: { ...args.input, VisibilityTimeout: 0 } })
      : next(args),
  { step: 'initialize', name: 'immediateRedelivery' },
);

function envelopeFor(eventId: string, payload: Record<string, unknown>): string {
  return JSON.stringify({
    eventId,
    eventType: PING,
    aggregateType: 'RelayFixture',
    aggregateId: randomUUID(),
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    payload,
  });
}

/** What the stub consumer reads to always fail on this message (`stub-consumer.ts`). */
async function publishPoison(eventId: string): Promise<void> {
  await publisher.send({
    queueName: QUEUE,
    body: envelopeFor(eventId, { note: 'T031', forceFailure: true }),
    deduplicationId: eventId,
  });
}

/**
 * An in-memory ledger that also counts deliveries: `wasProcessed` runs exactly
 * once per message `SqsConsumer` receives, so its calls are the number of times
 * the queue handed an event out. The handler's own failure counter cannot stand
 * in for this — it only ever sees the events the test told it to fail on.
 */
function countingProcessedEvents(deliveries: Map<string, number>): ProcessedEventPort {
  const seen = new Set<string>();
  return {
    wasProcessed(queueName, eventId) {
      deliveries.set(eventId, (deliveries.get(eventId) ?? 0) + 1);
      return Promise.resolve(seen.has(`${queueName}:${eventId}`));
    },
    markProcessed(queueName, eventId) {
      seen.add(`${queueName}:${eventId}`);
      return Promise.resolve();
    },
  };
}

function eventIdOf(envelope: unknown): string {
  return (envelope as { eventId?: string }).eventId ?? '';
}

/** The DLQ's own messages are a shared, persistent resource: read them without hiding or consuming any. */
async function dlqHolds(eventId: string): Promise<boolean> {
  const bodies = await peekQueueMessages(client, DLQ);
  return bodies.some((body) => body.includes(eventId));
}

/**
 * Leaves the DLQ as this test found it. ElasticMQ is shared and persistent, and
 * a message parked on the DLQ would otherwise outlive the run and make every
 * later "DLQ is empty" assertion depend on whether someone cleaned up.
 *
 * A consumer is the only way to delete a message through `@fp/platform`'s
 * exports: one that handles this event's id (and so acknowledges it) and fails
 * on everything else, leaving that untouched and immediately visible again.
 */
async function removeFromDlq(eventId: string): Promise<void> {
  const consumer = new SqsConsumer(
    {
      queueName: DLQ,
      handler: (envelope) =>
        eventIdOf(envelope) === eventId
          ? Promise.resolve('processed')
          : Promise.reject(new Error('not this test’s message')),
    },
    countingProcessedEvents(new Map()),
    impatientClient,
  );

  const deadline = Date.now() + REDRIVE_BUDGET_MS;
  do {
    const { handled } = await consumer.pollOnce();
    if (handled > 0) return;
  } while (Date.now() < deadline);
}

/**
 * FR-013, User Story 2, SC-004. A message a consumer cannot process must be
 * retried a bounded number of times and then quarantined — not lost, and not
 * retried forever. Only a real queue with its committed redrive policy can show
 * where the message ends up and after how many receives.
 */
describe('a message no consumer can process is dead-lettered (US2, FR-013, SC-004)', () => {
  beforeAll(() => {
    process.env.AWS_ACCESS_KEY_ID ??= 'elasticmq-placeholder';
    process.env.AWS_SECRET_ACCESS_KEY ??= 'elasticmq-placeholder';
  });

  afterAll(() => {
    client.destroy();
    impatientClient.destroy();
  });

  // T031 / SC-004
  it('moves a message to the DLQ after exactly maxReceiveCount receives', async () => {
    // The clarified figure (spec.md): five attempts, not "some number of".
    expect(MAX_RECEIVE_COUNT).toBe(5);

    const eventId = randomUUID();
    const dlqDepthBefore = await publisher.approximateDepth(DLQ);
    await publishPoison(eventId);

    const counters: StubConsumerCounters = { successes: 0, failures: 0 };
    const stub = createStubConsumer(counters);
    const deliveries = new Map<string, number>();
    const consumer = new SqsConsumer(
      {
        queueName: QUEUE,
        // The stub only ever sees this test's message. The queue is shared, so it
        // can hold leftovers from another spec, which are consumed and ignored.
        handler: (envelope) =>
          eventIdOf(envelope) === eventId ? stub(envelope) : Promise.resolve('processed'),
      },
      countingProcessedEvents(deliveries),
      impatientClient,
    );

    try {
      const deadline = Date.now() + REDRIVE_BUDGET_MS;
      do {
        await consumer.pollOnce();
      } while (
        (await publisher.approximateDepth(DLQ)) <= dlqDepthBefore &&
        Date.now() < deadline
      );

      // Received, and failed on, exactly the configured number of times — neither
      // giving up early nor retrying past the limit...
      expect(deliveries.get(eventId)).toBe(MAX_RECEIVE_COUNT);
      expect(counters).toEqual({ successes: 0, failures: MAX_RECEIVE_COUNT });

      // ...and then it is on the DLQ, not on the queue it came from.
      expect(await dlqHolds(eventId)).toBe(true);
      const stillOnSource = await peekQueueMessages(client, QUEUE);
      expect(stillOnSource.some((body) => body.includes(eventId))).toBe(false);
    } finally {
      await removeFromDlq(eventId);
    }
  });
});
