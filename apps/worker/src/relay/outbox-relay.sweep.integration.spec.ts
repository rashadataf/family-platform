import { randomUUID } from 'node:crypto';
import type { Clock, ProcessedEventPort } from '@fp/kernel';
import { createSqsClient, SqsConsumer } from '@fp/platform';
import { seedOutboxEvent, withDatabase, withDatabaseCommitted } from '@fp/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runOutboxRelaySweep } from './outbox-relay.sweep.js';

const QUEUE = 'outbox-relay-verification';
const PING = 'relay.VerificationPing.v1';

/**
 * Host-run defaults for the compose `elasticmq` service (published on 9324).
 * The worker container gets these from `docker-compose.yml`; a host-run
 * integration suite has no `.env` entry for them, so the suite supplies its
 * own — without overriding anything the environment already sets.
 */
const ENDPOINT = process.env.RELAY_QUEUE_ENDPOINT ?? 'http://localhost:9324';
const REGION = process.env.RELAY_QUEUE_REGION ?? 'elasticmq';

/** SC-001 (clarified): a row reaches its queue within five seconds. */
const DELIVERY_BUDGET_MS = 5_000;

const realClock: Clock = { now: () => new Date() };

/** Everything the assertions read the queue back through — production `SqsConsumer`, not the SDK. */
const client = createSqsClient({ endpoint: ENDPOINT, region: REGION });

function inMemoryProcessedEvents(): ProcessedEventPort {
  const seen = new Set<string>();
  return {
    wasProcessed: (queueName, eventId) => Promise.resolve(seen.has(`${queueName}:${eventId}`)),
    markProcessed: (queueName, eventId) => {
      seen.add(`${queueName}:${eventId}`);
      return Promise.resolve();
    },
  };
}

/**
 * Reads `QUEUE` until the message carrying `eventId` turns up, or `deadline`
 * passes. Matched by id rather than "the first message": ElasticMQ is shared
 * and persistent (`messages-storage`), so the queue can hold leftovers from
 * an earlier run or another spec — those are consumed and skipped here.
 */
async function receiveEnvelope(eventId: string, deadline: number): Promise<unknown> {
  const received: unknown[] = [];
  const consumer = new SqsConsumer(
    {
      queueName: QUEUE,
      handler: (envelope) => {
        received.push(envelope);
        return Promise.resolve('processed');
      },
    },
    inMemoryProcessedEvents(),
    client,
  );

  do {
    await consumer.pollOnce();
    const match = received.find((e) => (e as { eventId?: unknown }).eventId === eventId);
    if (match !== undefined) return match;
  } while (Date.now() < deadline);

  return undefined;
}

async function publishedAtOf(eventId: string): Promise<Date | null> {
  const row = await withDatabase((tx) =>
    tx.outboxEvent.findUniqueOrThrow({ where: { id: eventId } }),
  );
  return row.publishedAt;
}

/**
 * `claimUnpublishedOutboxEvents` takes a batch of the OLDEST unpublished rows,
 * cross-suite: other specs commit outbox rows and never publish them. Clearing
 * the backlog first means a tick reaches the row under test, however many
 * unpublished rows earlier runs left behind.
 */
async function clearUnpublishedBacklog(): Promise<void> {
  await withDatabaseCommitted((tx) =>
    tx.outboxEvent.updateMany({ where: { publishedAt: null }, data: { publishedAt: new Date() } }),
  );
}

/**
 * FR-001–FR-006, User Story 1. The properties under test are delivery and
 * loss-freedom, neither of which a unit test can show: both are about what a
 * real database and a real queue hold after a real tick.
 */
describe('the outbox relay sweep (US1, FR-001–FR-006)', () => {
  beforeAll(() => {
    // Read by the sweep when it builds its publisher; ElasticMQ ignores the
    // credentials, but the AWS SDK refuses to send a request with none.
    process.env.RELAY_QUEUE_ENDPOINT = ENDPOINT;
    process.env.RELAY_QUEUE_REGION = REGION;
    process.env.AWS_ACCESS_KEY_ID ??= 'elasticmq-placeholder';
    process.env.AWS_SECRET_ACCESS_KEY ??= 'elasticmq-placeholder';
  });

  afterAll(() => {
    client.destroy();
  });

  beforeEach(clearUnpublishedBacklog);

  // T024 / SC-001
  it('delivers a seeded row to its queue within 5 s, envelope intact, and marks the row published', async () => {
    const aggregateId = randomUUID();
    const correlationId = randomUUID();
    const occurredAt = new Date(Date.now() - 1_000);
    const payload = { note: 'T024', nested: { count: 2 } };
    const { id: eventId } = await withDatabaseCommitted((tx) =>
      seedOutboxEvent(tx, {
        eventType: PING,
        aggregateType: 'RelayFixture',
        aggregateId,
        payload,
        correlationId,
        occurredAt,
      }),
    );

    const startedAt = Date.now();
    await runOutboxRelaySweep(realClock);
    const envelope = await receiveEnvelope(eventId, startedAt + DELIVERY_BUDGET_MS);
    const elapsedMs = Date.now() - startedAt;

    // contracts/relay-interfaces.md §3: these seven fields, and no others.
    expect(envelope).toEqual({
      eventId,
      eventType: PING,
      aggregateType: 'RelayFixture',
      aggregateId,
      occurredAt: occurredAt.toISOString(),
      correlationId,
      payload,
    });
    expect(elapsedMs).toBeLessThan(DELIVERY_BUDGET_MS);

    const row = await withDatabase((tx) =>
      tx.outboxEvent.findUniqueOrThrow({ where: { id: eventId } }),
    );
    expect(row.publishedAt).not.toBeNull();
  });

  // T025 / SC-002, FR-006, FR-022
  it('loses nothing when a tick is interrupted after the send and before the commit', async () => {
    const { id: eventId } = await withDatabaseCommitted((tx) =>
      seedOutboxEvent(tx, { eventType: PING, payload: { note: 'T025' } }),
    );

    // The crash: `send` has succeeded, the claim transaction has not committed.
    // `afterSend` is the sweep's interrupt seam (mirroring `OverdueSweepHooks`);
    // an exception escaping the tick is the closest a test gets to the process
    // simply not coming back.
    const sentBeforeCrash: string[] = [];
    await expect(
      runOutboxRelaySweep(realClock, {
        afterSend(sentEventId: string) {
          sentBeforeCrash.push(sentEventId);
          throw new Error('simulated crash between send and commit');
        },
      }),
    ).rejects.toThrow('simulated crash');
    expect(sentBeforeCrash).toEqual([eventId]);

    // The claim rolled back, so the row is still eligible for a later tick...
    expect(await publishedAtOf(eventId)).toBeNull();
    // ...and the send was real: the message is already on the queue.
    expect(await receiveEnvelope(eventId, Date.now() + DELIVERY_BUDGET_MS)).toMatchObject({
      eventId,
    });

    // "Restart": the next tick reclaims the row and finishes the job. It sends
    // again — a duplicate is the documented cost of at-least-once delivery
    // (quickstart.md Scenario 2), and SC-002 is about loss, not duplication.
    await runOutboxRelaySweep(realClock);
    expect(await publishedAtOf(eventId)).not.toBeNull();
    expect(await receiveEnvelope(eventId, Date.now() + DELIVERY_BUDGET_MS)).toMatchObject({
      eventId,
    });
  });
});
