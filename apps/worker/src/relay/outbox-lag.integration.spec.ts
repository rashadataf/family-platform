import { randomUUID } from 'node:crypto';
import type { Clock } from '@fp/kernel';
import { seedOutboxEvent, withDatabase, withDatabaseCommitted } from '@fp/testing';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { captureLogs } from '../test-support/capture-logs.js';
import { RELAY_BATCH_SIZE, runOutboxRelaySweep } from './outbox-relay.sweep.js';

/** Host-run defaults for the compose `elasticmq` service; see `outbox-relay.sweep.integration.spec.ts`. */
const ENDPOINT = process.env.RELAY_QUEUE_ENDPOINT ?? 'http://localhost:9324';
const REGION = process.env.RELAY_QUEUE_REGION ?? 'elasticmq';

/** SC-010 (clarified): five minutes. */
const LAG_ALERT_SECONDS = 300;

/** An event type no queue subscribes to (FR-004): the tick marks its rows published and sends nothing. */
const UNSUBSCRIBED = 'relay.LagFixture.v1';

/** Twice the threshold, so the lag is unambiguously over it. */
const ROW_AGE_SECONDS = 2 * LAG_ALERT_SECONDS;

/**
 * A clock that does not move. The lag is `now − oldest unpublished
 * occurred_at`; with both ends fixed it is exactly `ROW_AGE_SECONDS`, not
 * "about", and the test does not depend on how long a tick takes.
 */
const NOW = new Date();
const fixedClock: Clock = { now: () => NOW };

const alertLines = (lines: readonly string[]) =>
  lines.filter((line) => line.includes('ALERT outbox_lag_seconds='));

const lagLines = (lines: readonly string[]) =>
  lines.filter((line) => line.includes('outbox_relay_lag_seconds='));

async function unpublishedCount(): Promise<number> {
  return withDatabase((tx) => tx.outboxEvent.count({ where: { publishedAt: null } }));
}

/**
 * `claimUnpublishedOutboxEvents` takes a batch of the OLDEST unpublished rows,
 * cross-suite: other specs commit outbox rows and never publish them, and any
 * of those would change both the lag and the count this test asserts on.
 */
async function clearUnpublishedBacklog(): Promise<void> {
  await withDatabaseCommitted((tx) =>
    tx.outboxEvent.updateMany({ where: { publishedAt: null }, data: { publishedAt: new Date() } }),
  );
}

/** Seeds `count` unpublished rows, all as old as the fixed clock's threshold breach. */
async function seedAgedRows(count: number): Promise<void> {
  const occurredAt = new Date(NOW.getTime() - ROW_AGE_SECONDS * 1_000);
  await withDatabaseCommitted(async (tx) => {
    for (let i = 0; i < count; i += 1) {
      await seedOutboxEvent(tx, { eventType: UNSUBSCRIBED, aggregateId: randomUUID(), occurredAt });
    }
  });
}

/**
 * FR-016, SC-010, User Story 3. The lag is measured BEFORE each tick's claim, so
 * it reports how far behind the relay was found rather than what it fixed on the
 * way past. That distinction is the whole of SC-010: a relay stopped for ten
 * minutes clears its backlog on the first tick after a restart, and measuring
 * afterwards would report zero for the one situation ADR-005 calls the most
 * important to see.
 */
describe('the outbox relay sweep reports how far behind it is (US3, FR-016, SC-010)', () => {
  beforeAll(() => {
    process.env.RELAY_QUEUE_ENDPOINT = ENDPOINT;
    process.env.RELAY_QUEUE_REGION = REGION;
    process.env.AWS_ACCESS_KEY_ID ??= 'elasticmq-placeholder';
    process.env.AWS_SECRET_ACCESS_KEY ??= 'elasticmq-placeholder';
  });

  beforeEach(clearUnpublishedBacklog);

  // T035 / SC-010, FR-016 — quickstart Scenario 5, without the five-minute wait.
  it('alerts on the first tick after a stopped relay restarts, even though that tick clears the backlog', async () => {
    // Small enough that ONE tick publishes all of it: the restart case exactly.
    await seedAgedRows(20);

    const firstTick = await captureLogs(() => runOutboxRelaySweep(fixedClock));

    // The tick did clear the backlog...
    expect(await unpublishedCount()).toBe(0);
    // ...and still reported the ten-minute lag it found on arrival, and alerted.
    expect(lagLines(firstTick).map((line) => line.trim())).toEqual([
      `outbox_relay_lag_seconds=${String(ROW_AGE_SECONDS)}`,
    ]);
    expect(alertLines(firstTick)).toHaveLength(1);
    expect(alertLines(firstTick)[0]).toContain(
      `ALERT outbox_lag_seconds=${String(ROW_AGE_SECONDS)} threshold=${String(LAG_ALERT_SECONDS)}`,
    );

    // Caught up: the lag is still reported every tick, and the alert clears.
    const caughtUp = await captureLogs(() => runOutboxRelaySweep(fixedClock));
    expect(alertLines(caughtUp)).toEqual([]);
    expect(lagLines(caughtUp).map((line) => line.trim())).toEqual(['outbox_relay_lag_seconds=0']);
  });

  // T035 / FR-016 — edge-triggered, like `SweepScheduler.checkStalled`.
  it('does not repeat the alert while the relay stays behind, and raises it again after a recovery', async () => {
    // More than one batch, so the backlog outlives the tick that first alerts.
    await seedAgedRows(RELAY_BATCH_SIZE + 1);

    const crossing = await captureLogs(() => runOutboxRelaySweep(fixedClock));
    expect(alertLines(crossing)).toHaveLength(1);
    expect(await unpublishedCount()).toBe(1);

    // Still behind on arrival, so still reported — but not alerted a second time.
    const stillBehind = await captureLogs(() => runOutboxRelaySweep(fixedClock));
    expect(alertLines(stillBehind)).toEqual([]);
    expect(lagLines(stillBehind).map((line) => line.trim())).toEqual([
      `outbox_relay_lag_seconds=${String(ROW_AGE_SECONDS)}`,
    ]);
    expect(await unpublishedCount()).toBe(0);

    // Recovered, which clears the flag...
    const recovered = await captureLogs(() => runOutboxRelaySweep(fixedClock));
    expect(alertLines(recovered)).toEqual([]);

    // ...so a fresh backlog alerts again rather than staying silent.
    await seedAgedRows(1);
    const secondCrossing = await captureLogs(() => runOutboxRelaySweep(fixedClock));
    expect(alertLines(secondCrossing)).toHaveLength(1);
  });
});
