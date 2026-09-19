import { randomUUID } from 'node:crypto';
import type { ProcessedEventPort } from '@fp/kernel';
import { createProcessedEventStore } from '@fp/persistence';
import { createSqsClient, SqsConsumer, SqsMessagePublisher } from '@fp/platform';
import { withDatabase } from '@fp/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStubConsumer, type StubConsumerCounters } from '../test-support/stub-consumer.js';

const QUEUE = 'outbox-relay-verification';
const PING = 'relay.VerificationPing.v1';

/** Host-run defaults for the compose `elasticmq` service; see `outbox-relay.sweep.integration.spec.ts`. */
const ENDPOINT = process.env.RELAY_QUEUE_ENDPOINT ?? 'http://localhost:9324';
const REGION = process.env.RELAY_QUEUE_REGION ?? 'elasticmq';

/** How long to keep polling for every expected delivery before the test gives up and asserts on what it has. */
const DELIVERY_BUDGET_MS = 10_000;

const client = createSqsClient({ endpoint: ENDPOINT, region: REGION });
const publisher = new SqsMessagePublisher(client);

function envelopeFor(eventId: string): string {
  return JSON.stringify({
    eventId,
    eventType: PING,
    aggregateType: 'RelayFixture',
    aggregateId: randomUUID(),
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    payload: { note: 'T028' },
  });
}

async function publish(eventId: string): Promise<void> {
  await publisher.send({ queueName: QUEUE, body: envelopeFor(eventId), deduplicationId: eventId });
}

/**
 * The real, database-backed ledger, watched: `wasProcessed` runs exactly once
 * per message `SqsConsumer` receives, so its calls are the count of
 * DELIVERIES of an event — which the handler's own counter cannot show for a
 * duplicate, because the whole point is that the handler is never reached.
 */
function watchedProcessedEvents(deliveries: Map<string, number>): ProcessedEventPort {
  const real = createProcessedEventStore();
  return {
    wasProcessed(queueName, eventId) {
      deliveries.set(eventId, (deliveries.get(eventId) ?? 0) + 1);
      return real.wasProcessed(queueName, eventId);
    },
    markProcessed: (queueName, eventId) => real.markProcessed(queueName, eventId),
  };
}

/**
 * Polls `QUEUE` through the production `SqsConsumer` until every id in
 * `expected` has been delivered `times` times, or the budget runs out.
 *
 * The stub is only invoked for `expected` ids: ElasticMQ is shared and
 * persistent, so the queue can hold leftovers from another spec, which are
 * consumed and ignored here rather than counted against the assertions.
 */
async function consumeUntilDelivered(
  expected: readonly string[],
  times: number,
): Promise<{ counters: StubConsumerCounters; deliveries: Map<string, number> }> {
  const counters: StubConsumerCounters = { successes: 0, failures: 0 };
  const stub = createStubConsumer(counters);
  const deliveries = new Map<string, number>();
  const consumer = new SqsConsumer(
    {
      queueName: QUEUE,
      handler: (envelope) =>
        expected.includes((envelope as { eventId?: string }).eventId ?? '')
          ? stub(envelope)
          : Promise.resolve('processed'),
    },
    watchedProcessedEvents(deliveries),
    client,
  );

  const deadline = Date.now() + DELIVERY_BUDGET_MS;
  const allDelivered = () => expected.every((id) => (deliveries.get(id) ?? 0) >= times);
  do {
    await consumer.pollOnce();
  } while (!allDelivered() && Date.now() < deadline);

  return { counters, deliveries };
}

async function ledgerRowsFor(eventId: string): Promise<number> {
  return withDatabase((tx) => tx.processedEvent.count({ where: { queueName: QUEUE, eventId } }));
}

/**
 * FR-011, SC-008, User Story 1. At-least-once delivery means a message can
 * arrive twice; what makes that safe is that the consumer's own side effect
 * still happens once. Only the real ledger table can show that.
 */
describe('the base consumer against a duplicate delivery (US1, FR-011, SC-008)', () => {
  beforeAll(() => {
    process.env.AWS_ACCESS_KEY_ID ??= 'elasticmq-placeholder';
    process.env.AWS_SECRET_ACCESS_KEY ??= 'elasticmq-placeholder';
  });

  afterAll(() => {
    client.destroy();
  });

  // T028 / SC-008, FR-011
  it('runs the handler exactly once when the same event is delivered twice', async () => {
    const eventId = randomUUID();
    await publish(eventId);
    await publish(eventId);

    const { counters, deliveries } = await consumeUntilDelivered([eventId], 2);

    // Both copies really arrived — otherwise "once" would prove nothing...
    expect(deliveries.get(eventId)).toBe(2);
    // ...and the handler's own side effect happened for only one of them.
    expect(counters).toEqual({ successes: 1, failures: 0 });
    expect(await ledgerRowsFor(eventId)).toBe(1);
  });

  // Control for the test above: the ledger must skip a REPEAT, not everything.
  it('still runs the handler once for each of two distinct events', async () => {
    const first = randomUUID();
    const second = randomUUID();
    await publish(first);
    await publish(second);

    const { counters } = await consumeUntilDelivered([first, second], 1);

    expect(counters).toEqual({ successes: 2, failures: 0 });
    expect(await ledgerRowsFor(first)).toBe(1);
    expect(await ledgerRowsFor(second)).toBe(1);
  });
});
