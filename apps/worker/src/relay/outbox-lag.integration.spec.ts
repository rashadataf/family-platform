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

/**
 * FR-016, SC-010, User Story 3. Lag is what a tick could NOT fix — a tick marks
 * everything it claims — so the only way to observe it is a backlog bigger than
 * one batch. `2 × RELAY_BATCH_SIZE + 1` old rows take three ticks to clear and
 * leave the oldest unpublished row over the threshold after the first two:
 * alert, no repeat, then cleared.
 */
describe('the outbox relay sweep reports how far behind it is (US3, FR-016, SC-010)', () => {
  beforeAll(() => {
    process.env.RELAY_QUEUE_ENDPOINT = ENDPOINT;
    process.env.RELAY_QUEUE_REGION = REGION;
    process.env.AWS_ACCESS_KEY_ID ??= 'elasticmq-placeholder';
    process.env.AWS_SECRET_ACCESS_KEY ??= 'elasticmq-placeholder';
  });

  beforeEach(clearUnpublishedBacklog);

  // T035 / SC-010, FR-016
  it('alerts once when the oldest unpublished row is over 300 s old, and not again until it recovers', async () => {
    const occurredAt = new Date(NOW.getTime() - ROW_AGE_SECONDS * 1_000);
    await withDatabaseCommitted(async (tx) => {
      for (let i = 0; i < 2 * RELAY_BATCH_SIZE + 1; i += 1) {
        await seedOutboxEvent(tx, {
          eventType: UNSUBSCRIBED,
          aggregateId: randomUUID(),
          occurredAt,
        });
      }
    });

    // First tick: a batch is cleared, the rest are as old as ever. The alert fires.
    const crossing = await captureLogs(() => runOutboxRelaySweep(fixedClock));
    expect(await unpublishedCount()).toBe(RELAY_BATCH_SIZE + 1);
    expect(alertLines(crossing)).toHaveLength(1);
    expect(alertLines(crossing)[0]).toContain(
      `ALERT outbox_lag_seconds=${String(ROW_AGE_SECONDS)} threshold=${String(LAG_ALERT_SECONDS)}`,
    );
    // The lag is reported on every tick, alert or not.
    expect(lagLines(crossing).map((line) => line.trim())).toEqual([
      `outbox_relay_lag_seconds=${String(ROW_AGE_SECONDS)}`,
    ]);

    // Second tick: still over the threshold, and still reported — but already alerted.
    const stillBehind = await captureLogs(() => runOutboxRelaySweep(fixedClock));
    expect(await unpublishedCount()).toBe(1);
    expect(alertLines(stillBehind)).toEqual([]);
    expect(lagLines(stillBehind).map((line) => line.trim())).toEqual([
      `outbox_relay_lag_seconds=${String(ROW_AGE_SECONDS)}`,
    ]);

    // Third tick claims the last row: nothing outstanding, so nothing to alert on.
    const caughtUp = await captureLogs(() => runOutboxRelaySweep(fixedClock));
    expect(await unpublishedCount()).toBe(0);
    expect(alertLines(caughtUp)).toEqual([]);
    expect(lagLines(caughtUp).map((line) => line.trim())).toEqual(['outbox_relay_lag_seconds=0']);
  });
});
