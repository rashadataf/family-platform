import { randomUUID } from 'node:crypto';
import type { Clock, ProcessedEventPort } from '@fp/kernel';
import { claimUnpublishedOutboxEvents, measureOutboxLag } from '@fp/persistence';
import { createSqsClient, SqsConsumer, SqsMessagePublisher } from '@fp/platform';
import { seedOutboxEvent, withDatabase, withDatabaseCommitted } from '@fp/testing';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { captureLogs } from '../test-support/capture-logs.js';
import { runOutboxRelaySweep } from './outbox-relay.sweep.js';
import { QUEUE_TOPOLOGY, type QueueDefinition } from './queue-topology.js';

/**
 * This file runs against its OWN copy of the topology, so a test can change who
 * subscribes to what (T042, FR-020) without touching the committed
 * `QUEUE_TOPOLOGY`. The copy starts identical to it, and `resolveDestinations`
 * is still the real one — only the data it resolves against is swapped, so
 * every other test here sees exactly the committed topology.
 */
vi.mock('./queue-topology.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./queue-topology.js')>();
  const topology: QueueDefinition[] = original.QUEUE_TOPOLOGY.map((queue) => ({ ...queue }));
  return {
    ...original,
    QUEUE_TOPOLOGY: topology,
    resolveDestinations: (eventType: string, against: readonly QueueDefinition[] = topology) =>
      original.resolveDestinations(eventType, against),
  };
});

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

/**
 * How long a claimer waits for the other before giving up on the rendezvous.
 * Only ever reached if a claimer BLOCKS on the other's row locks — which is
 * exactly the failure `SKIP LOCKED` exists to prevent — so the test then goes
 * on to fail on its assertions instead of hanging until the transaction times out.
 */
const RENDEZVOUS_TIMEOUT_MS = 5_000;

/**
 * Returns a function each claimer awaits from inside its claim transaction:
 * it resolves once BOTH have claimed, so the two transactions are provably
 * holding their row locks at the same moment.
 */
function rendezvousOfTwo(): () => Promise<void> {
  let arrived = 0;
  let openGate: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });

  return async () => {
    arrived += 1;
    if (arrived === 2) openGate();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, RENDEZVOUS_TIMEOUT_MS);
    });
    await Promise.race([gate, timeout]);
    clearTimeout(timer);
  };
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

  // T026 / SC-003, FR-023
  it('never hands the same row to two concurrent claimers', async () => {
    const seededIds = await withDatabaseCommitted(async (tx) => {
      const ids: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        const { id } = await seedOutboxEvent(tx, {
          eventType: PING,
          payload: { note: 'T026', i },
          occurredAt: new Date(Date.now() - (6 - i) * 1_000),
        });
        ids.push(id);
      }
      return ids;
    });

    // Both claims run against the same connection pool, and each holds its
    // transaction — and so its row locks — open until the other has claimed.
    const rendezvous = rendezvousOfTwo();
    const claim = () =>
      claimUnpublishedOutboxEvents(3, async (claimed) => {
        await rendezvous();
        return claimed.map((row) => row.id);
      });
    const [first, second] = await Promise.all([claim(), claim()]);

    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect(first.filter((id) => second.includes(id))).toEqual([]);
    // Skipping a locked row is not the same as skipping a row: nothing is left over.
    expect([...first, ...second].sort()).toEqual([...seededIds].sort());
  });
});

/**
 * FR-017, User Story 3: what an operator reads to tell whether a queue is
 * keeping up — per configured queue, how many messages this tick delivered,
 * how many are waiting on it, and how many sit on its dead-letter queue.
 */
describe('the outbox relay sweep reports per-queue counts (US3, FR-017)', () => {
  beforeAll(() => {
    process.env.RELAY_QUEUE_ENDPOINT = ENDPOINT;
    process.env.RELAY_QUEUE_REGION = REGION;
    process.env.AWS_ACCESS_KEY_ID ??= 'elasticmq-placeholder';
    process.env.AWS_SECRET_ACCESS_KEY ??= 'elasticmq-placeholder';
  });

  beforeEach(clearUnpublishedBacklog);

  // T037 / FR-017
  it('reports, for each configured queue, a delivered count, a pending count and a DLQ depth', async () => {
    const verification = QUEUE_TOPOLOGY.find((queue) => queue.name === QUEUE);
    expect(verification, `${QUEUE} is in QUEUE_TOPOLOGY`).toBeDefined();
    if (verification === undefined) return;

    const depths = new SqsMessagePublisher(client);
    const seeded = 2;
    await withDatabaseCommitted(async (tx) => {
      for (let i = 0; i < seeded; i += 1) {
        await seedOutboxEvent(tx, { eventType: PING, payload: { note: 'T037', i } });
      }
    });

    const lines = await captureLogs(() => runOutboxRelaySweep(realClock));
    const summaries = lines.filter((line) => line.startsWith('outbox_relay_run'));
    expect(summaries, 'one summary line per tick').toHaveLength(1);
    const summary = summaries[0] ?? '';

    // One group per configured queue, and every queue in the topology has one.
    for (const queue of QUEUE_TOPOLOGY) {
      expect(summary).toMatch(
        new RegExp(`queue=${queue.name} delivered=\\d+ pending=\\d+ dlq=\\d+`),
      );
    }

    const match = new RegExp(
      `queue=${QUEUE} delivered=(\\d+) pending=(\\d+) dlq=(\\d+)`,
    ).exec(summary);
    const [delivered, pending, dlq] = [1, 2, 3].map((group) => Number(match?.[group]));

    // Delivered: what this tick put on the queue — the two rows it just claimed.
    expect(delivered).toBe(seeded);
    // Pending: those two are visible on the queue right now, along with any
    // leftovers another spec parked there, so "at least".
    expect(pending).toBeGreaterThanOrEqual(seeded);
    // DLQ depth: the DLQ's own depth, whatever it holds.
    expect(dlq).toBe(await depths.approximateDepth(verification.dlqName));
  });
});

/**
 * FR-004, FR-020, SC-006, User Story 4. Today every real event type has zero
 * subscribers, so "an event nobody consumes" is the ordinary case, not an edge:
 * it must be marked published on its first claim, send nothing, and never show
 * up as lag — or the alarm would fire permanently on a healthy system.
 */
describe('the outbox relay sweep and events nobody subscribes to (US4, FR-004, FR-020, SC-006)', () => {
  /** A real context's event, of a type that appears nowhere in `QUEUE_TOPOLOGY`. */
  const UNSUBSCRIBED = 'tasks.TaskCreated.v1';

  /** Every message the sweep tried to send: the spy calls through, so nothing is stubbed out. */
  let send: MockInstance<SqsMessagePublisher['send']>;

  const sentEventIds = (): string[] =>
    send.mock.calls.map(([message]) => (JSON.parse(message.body) as { eventId: string }).eventId);

  beforeAll(() => {
    process.env.RELAY_QUEUE_ENDPOINT = ENDPOINT;
    process.env.RELAY_QUEUE_REGION = REGION;
    process.env.AWS_ACCESS_KEY_ID ??= 'elasticmq-placeholder';
    process.env.AWS_SECRET_ACCESS_KEY ??= 'elasticmq-placeholder';
  });

  beforeEach(async () => {
    await clearUnpublishedBacklog();
    send = vi.spyOn(SqsMessagePublisher.prototype, 'send');
  });

  afterEach(() => {
    send.mockRestore();
  });

  // T041 / SC-006, FR-004
  it('marks a row with no subscriber published on its first claim, sends nothing, and leaves no lag', async () => {
    const { id: eventId } = await withDatabaseCommitted((tx) =>
      seedOutboxEvent(tx, { eventType: UNSUBSCRIBED, payload: { note: 'T041' } }),
    );

    const result = await runOutboxRelaySweep(realClock);

    expect(result).toMatchObject({ claimed: 1, published: 1, sent: 0, failed: [] });
    expect(await publishedAtOf(eventId)).not.toBeNull();
    expect(send).not.toHaveBeenCalled();

    // A burst of them, each old enough that leaving one behind would show as lag.
    const oldEnough = new Date(Date.now() - 60_000);
    const burst = 50;
    await withDatabaseCommitted(async (tx) => {
      for (let i = 0; i < burst; i += 1) {
        await seedOutboxEvent(tx, { eventType: UNSUBSCRIBED, occurredAt: oldEnough });
      }
    });

    const afterBurst = await runOutboxRelaySweep(realClock);

    expect(afterBurst).toMatchObject({ claimed: burst, published: burst, sent: 0, failed: [] });
    expect(send).not.toHaveBeenCalled();
    expect(await measureOutboxLag(realClock.now())).toBe(0);
  });

  // T042 / FR-020
  it('never sends a past event retroactively when its type later gains a subscriber', async () => {
    const LATE = 'relay.LateSubscriber.v1';
    // The file-local copy of the topology (see `vi.mock` above), not the committed one.
    const topology = QUEUE_TOPOLOGY as QueueDefinition[];
    const index = topology.findIndex((queue) => queue.name === QUEUE);
    const original = topology[index];
    expect(original, `${QUEUE} is in the topology`).toBeDefined();
    if (original === undefined) return;

    try {
      const { id: before } = await withDatabaseCommitted((tx) =>
        seedOutboxEvent(tx, { eventType: LATE, payload: { note: 'T042 before' } }),
      );
      await runOutboxRelaySweep(realClock);
      expect(await publishedAtOf(before)).not.toBeNull();
      expect(sentEventIds()).toEqual([]);

      // The queue starts consuming LATE events. `before` is already published,
      // so nothing should ever look at it again.
      topology[index] = {
        ...original,
        subscribedEventTypes: [...original.subscribedEventTypes, LATE],
      };

      const { id: after } = await withDatabaseCommitted((tx) =>
        seedOutboxEvent(tx, { eventType: LATE, payload: { note: 'T042 after' } }),
      );
      await runOutboxRelaySweep(realClock);
      await runOutboxRelaySweep(realClock);

      // Only the second event was ever sent — once — and it really is on the queue.
      expect(sentEventIds()).toEqual([after]);
      expect(await receiveEnvelope(after, Date.now() + DELIVERY_BUDGET_MS)).toMatchObject({
        eventId: after,
        eventType: LATE,
      });
    } finally {
      topology[index] = original;
    }
  });
});
