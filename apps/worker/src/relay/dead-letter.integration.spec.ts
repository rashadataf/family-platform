import { randomUUID } from 'node:crypto';
import type { Clock, ProcessedEventPort } from '@fp/kernel';
import { createSqsClient, peekQueueMessages, SqsConsumer, SqsMessagePublisher } from '@fp/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureLogs } from '../test-support/capture-logs.js';
import { createStubConsumer, type StubConsumerCounters } from '../test-support/stub-consumer.js';
import { runOutboxRelaySweep } from './outbox-relay.sweep.js';
import { QUEUE_TOPOLOGY } from './queue-topology.js';

const PING = 'relay.VerificationPing.v1';

const VERIFICATION_QUEUE = QUEUE_TOPOLOGY.find((queue) =>
  queue.subscribedEventTypes.includes(PING),
);
if (VERIFICATION_QUEUE === undefined) {
  throw new Error(`no queue in QUEUE_TOPOLOGY subscribes to ${PING}`);
}
const { name: QUEUE, dlqName: DLQ, maxReceiveCount: MAX_RECEIVE_COUNT } = VERIFICATION_QUEUE;

/** Host-run defaults for the compose `elasticmq` service; see `outbox-relay.sweep.integration.spec.ts`. */
const ENDPOINT = process.env.RELAY_QUEUE_ENDPOINT ?? 'http://localhost:9324';
const REGION = process.env.RELAY_QUEUE_REGION ?? 'elasticmq';

/** How long to keep polling for the redrive before the test gives up and asserts on what it has. */
const REDRIVE_BUDGET_MS = 20_000;

const realClock: Clock = { now: () => new Date() };

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

async function publishHealthy(eventId: string): Promise<void> {
  await publisher.send({
    queueName: QUEUE,
    body: envelopeFor(eventId, { note: 'T033' }),
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
 * Leaves a queue as this test found it. ElasticMQ is shared and persistent, and
 * a message left on the DLQ (or still cycling on the source queue) would
 * outlive the run and make every later "the DLQ is empty" assertion depend on
 * whether someone cleaned up.
 *
 * A consumer is the only way to delete a message through `@fp/platform`'s
 * exports: one that handles this event's id (and so acknowledges it) and fails
 * on everything else, leaving that untouched and immediately visible again.
 */
async function removeFromQueue(queueName: string, eventId: string): Promise<void> {
  const consumer = new SqsConsumer(
    {
      queueName,
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
 * Empties the DLQ, so a test that starts from "nothing has been dead-lettered"
 * does not depend on what an earlier run or a manual quickstart scenario left
 * there. Every message on this queue is a test fixture: `outbox-relay-verification`
 * has no real producer.
 */
async function emptyDlq(): Promise<void> {
  const consumer = new SqsConsumer(
    { queueName: DLQ, handler: () => Promise.resolve('processed') },
    countingProcessedEvents(new Map()),
    impatientClient,
  );

  const deadline = Date.now() + REDRIVE_BUDGET_MS;
  while ((await publisher.approximateDepth(DLQ)) > 0 && Date.now() < deadline) {
    await consumer.pollOnce();
  }
}

async function logsOfOneTick(): Promise<readonly string[]> {
  return captureLogs(() => runOutboxRelaySweep(realClock));
}

/** The depth the tick reported for this test's DLQ, one entry per `outbox_relay_dlq_depth` line. */
function reportedDlqDepths(lines: readonly string[]): number[] {
  return lines.flatMap((line) => {
    const match = /outbox_relay_dlq_depth queue=(\S+) depth=(\d+)/.exec(line);
    return match?.[1] === DLQ ? [Number(match[2])] : [];
  });
}

function deadLetterAlerts(lines: readonly string[]): string[] {
  return lines.filter((line) => line.includes(`ALERT dead_letter_arrived queue=${DLQ}`));
}

/**
 * FR-013, User Story 2, SC-004. A message a consumer cannot process must be
 * retried a bounded number of times and then quarantined — not lost, and not
 * retried forever. Only a real queue with its committed redrive policy can show
 * where the message ends up and after how many receives.
 */
describe('a message no consumer can process is dead-lettered (US2, FR-013, SC-004)', () => {
  beforeAll(() => {
    // Read by the sweep when it builds its publisher (T032).
    process.env.RELAY_QUEUE_ENDPOINT = ENDPOINT;
    process.env.RELAY_QUEUE_REGION = REGION;
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
      } while ((await publisher.approximateDepth(DLQ)) <= dlqDepthBefore && Date.now() < deadline);

      // Received, and failed on, exactly the configured number of times — neither
      // giving up early nor retrying past the limit...
      expect(deliveries.get(eventId)).toBe(MAX_RECEIVE_COUNT);
      expect(counters).toEqual({ successes: 0, failures: MAX_RECEIVE_COUNT });

      // ...and then it is on the DLQ, not on the queue it came from.
      expect(await dlqHolds(eventId)).toBe(true);
      const stillOnSource = await peekQueueMessages(client, QUEUE);
      expect(stillOnSource.some((body) => body.includes(eventId))).toBe(false);
    } finally {
      await removeFromQueue(DLQ, eventId);
    }
  });

  // T032 / FR-014
  it('alerts once when the DLQ first becomes non-empty, and reports its depth on every tick', async () => {
    await emptyDlq();
    expect(await publisher.approximateDepth(DLQ), 'the DLQ starts empty').toBe(0);

    // The sweep can only ever see a DLQ's depth, so the fixture is a message put
    // on it directly; how a message gets there is T031's subject, not this one's.
    // The sweep's "was non-empty last tick" state lives in its module, and this
    // is the only test in this file's module instance that runs a tick.
    const eventId = randomUUID();
    let sent = false;
    try {
      const whileEmpty = await logsOfOneTick();
      expect(reportedDlqDepths(whileEmpty)).toEqual([0]);
      expect(deadLetterAlerts(whileEmpty)).toEqual([]);

      await publisher.send({
        queueName: DLQ,
        body: envelopeFor(eventId, { note: 'T032' }),
        deduplicationId: eventId,
      });
      sent = true;

      // The transition: empty on the last tick, non-empty on this one.
      const onArrival = await logsOfOneTick();
      expect(reportedDlqDepths(onArrival)).toEqual([1]);
      expect(deadLetterAlerts(onArrival)).toHaveLength(1);
      expect(deadLetterAlerts(onArrival)[0]).toContain('depth=1');

      // Still non-empty: the depth is reported again, the alert is not repeated.
      const whileStillNonEmpty = await logsOfOneTick();
      expect(reportedDlqDepths(whileStillNonEmpty)).toEqual([1]);
      expect(deadLetterAlerts(whileStillNonEmpty)).toEqual([]);
    } finally {
      if (sent) await removeFromQueue(DLQ, eventId);
    }
  });

  // T033 / User Story 2, acceptance scenario 4
  it('still delivers a healthy message while a poison one on the same queue is being retried', async () => {
    const poisonId = randomUUID();
    const healthyId = randomUUID();
    // Poison first, so the queue holds it ahead of the healthy message.
    await publishPoison(poisonId);
    await publishHealthy(healthyId);

    const counters: StubConsumerCounters = { successes: 0, failures: 0 };
    const stub = createStubConsumer(counters);
    const deliveries = new Map<string, number>();
    const ours = new Set<string>([poisonId, healthyId]);
    const consumer = new SqsConsumer(
      {
        queueName: QUEUE,
        // The stub only ever sees this test's two messages; see T031 for why.
        handler: (envelope) =>
          ours.has(eventIdOf(envelope)) ? stub(envelope) : Promise.resolve('processed'),
      },
      countingProcessedEvents(deliveries),
      impatientClient,
    );

    try {
      // Until the healthy message has arrived AND the poison one has been handed
      // out again after failing — the state "healthy delivered while poison retries".
      const deadline = Date.now() + REDRIVE_BUDGET_MS;
      do {
        await consumer.pollOnce();
      } while (
        ((deliveries.get(healthyId) ?? 0) < 1 || (deliveries.get(poisonId) ?? 0) < 2) &&
        Date.now() < deadline
      );

      expect(deliveries.get(healthyId)).toBe(1);
      expect(counters.successes, 'the healthy message was handled').toBe(1);

      // The poison message really was retried, and is still short of the limit —
      // so it was the healthy one that got through *during* its retries.
      expect(deliveries.get(poisonId)).toBeGreaterThanOrEqual(2);
      expect(deliveries.get(poisonId)).toBeLessThan(MAX_RECEIVE_COUNT);
      expect(counters.failures).toBe(deliveries.get(poisonId));
    } finally {
      await removeFromQueue(QUEUE, poisonId);
    }
  });
});
