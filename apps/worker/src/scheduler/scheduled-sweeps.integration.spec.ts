import { SystemClock } from '@fp/platform';
import {
  scopeTo,
  seedDateOnlyTask,
  seedFamily,
  withDatabase,
  withDatabaseCommitted,
} from '@fp/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { SWEEPS } from '../sweeps/registry.js';
import { SweepScheduler, type SchedulerLogger } from './scheduler.js';

const ONE_HOUR = 3_600;

/**
 * The relay is a registered sweep, so every scheduler running the real registry
 * now builds its publisher. Host-run defaults for the compose `elasticmq`
 * service, as `outbox-relay.sweep.integration.spec.ts` uses — without
 * overriding anything the environment already sets.
 */
const RELAY_ENDPOINT = process.env.RELAY_QUEUE_ENDPOINT ?? 'http://localhost:9324';
const RELAY_REGION = process.env.RELAY_QUEUE_REGION ?? 'elasticmq';

beforeAll(() => {
  process.env.RELAY_QUEUE_ENDPOINT = RELAY_ENDPOINT;
  process.env.RELAY_QUEUE_REGION = RELAY_REGION;
  process.env.AWS_ACCESS_KEY_ID ??= 'elasticmq-placeholder';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'elasticmq-placeholder';
});

/** Waits for `check` to hold, polling, up to `timeoutMs`. */
async function eventually(
  check: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 100,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Phase 8's independent test, against the real database: the platform's sweeps
 * run on their own, with nothing invoked by hand.
 *
 * Before this feature no sweep had ever run automatically anywhere — the
 * worker's module was empty. So the assertion that matters is not that the
 * overdue sweep works (US5 covers that) but that *starting the process* is
 * enough to make it happen.
 */
describe('the scheduler running the real registry (Phase 8, FR-037)', () => {
  it('reports an already-overdue task with no manual invocation, and runs every sweep once', async () => {
    const family = await withDatabaseCommitted((tx) =>
      seedFamily(tx, { name: 'Scheduled Sweeps' }),
    );

    // Due in the past relative to the real clock the scheduler will use.
    const seeded = await withDatabaseCommitted(async (tx) => {
      await scopeTo(tx, family.familyId);
      return seedDateOnlyTask(tx, {
        familyId: family.familyId,
        title: 'Overdue before the worker even started',
        date: '2020-01-01',
        dueAt: new Date('2020-01-02T00:00:00Z'),
      });
    });

    const lines: string[] = [];
    const logger: SchedulerLogger = {
      log: (line) => lines.push(line),
      warn: (line) => lines.push(line),
      error: (line) => lines.push(line),
    };

    // The overdue sweep every second; everything else hourly, so each runs
    // exactly once — at startup — inside this test.
    const cadences = Object.fromEntries(
      SWEEPS.map((sweep) => [sweep.name, sweep.name === 'report-overdue-tasks' ? 1 : ONE_HOUR]),
    );

    const scheduler = new SweepScheduler({
      sweeps: SWEEPS,
      cadences,
      clock: new SystemClock(),
      heartbeatPath: '/tmp/fp-worker-heartbeat-test',
      logger,
      // No jitter, so every sweep's first run happens promptly.
      random: () => 0,
    });

    let stopped = false;
    try {
      scheduler.start();

      const reported = await eventually(async () => {
        const rows = await withDatabase((tx) =>
          tx.outboxEvent.findMany({
            where: { aggregateId: seeded.taskId, eventType: 'tasks.TaskOverdue.v1' },
          }),
        );
        return rows.length === 1;
      }, 3_000);
      expect(reported, 'a TaskOverdue row within 3 seconds').toBe(true);

      // Every registered sweep logged at least one successful run.
      const succeeded = await eventually(
        () =>
          Promise.resolve(
            SWEEPS.every((sweep) =>
              lines.some(
                (line) =>
                  line.includes(`sweep=${sweep.name}`) && line.includes('outcome=succeeded'),
              ),
            ),
          ),
        10_000,
      );
      const missing = SWEEPS.filter(
        (sweep) =>
          !lines.some(
            (line) => line.includes(`sweep=${sweep.name}`) && line.includes('outcome=succeeded'),
          ),
      ).map((sweep) => sweep.name);
      expect(missing).toEqual([]);
      expect(succeeded).toBe(true);

      // No sweep failed.
      expect(lines.filter((line) => line.includes('outcome=failed'))).toEqual([]);

      await expect(scheduler.stop(15_000)).resolves.toBe(true);
      stopped = true;
    } finally {
      if (!stopped) await scheduler.stop(15_000);
    }

    // A clean stop means no sweep is still holding a transaction: the pool is
    // immediately usable again. Asserted this way rather than by calling
    // `disconnectDatabase()` — the connection pool belongs to the process, not
    // to a test, and closing it here broke later suites in the same runner with
    // aborted requests.
    const usable = await withDatabase((tx) => tx.task.count({}));
    expect(usable).toBeGreaterThanOrEqual(0);

    // And no further ticks happen once stopped.
    const before = await withDatabase((tx) =>
      tx.outboxEvent.count({ where: { eventType: 'tasks.TaskOverdue.v1' } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const after = await withDatabase((tx) =>
      tx.outboxEvent.count({ where: { eventType: 'tasks.TaskOverdue.v1' } }),
    );
    expect(after).toBe(before);
  });
});

/**
 * FR-025, User Story 3: the relay needs no scheduling or stall-detection code
 * of its own — being a registered sweep is enough. Confirmed here against the
 * real registry entry rather than assumed, because "no new code" is exactly the
 * claim a later edit to `registry.ts` or `scheduler.ts` could quietly break.
 */
describe('the outbox relay under the scheduler (US3, FR-025)', () => {
  const relay = SWEEPS.find((sweep) => sweep.name === 'outbox-relay');

  function recordingLogger(lines: string[]): SchedulerLogger {
    return {
      log: (line) => lines.push(line),
      warn: (line) => lines.push(line),
      error: (line) => lines.push(line),
    };
  }

  const succeededRuns = (lines: readonly string[]) =>
    lines.filter(
      (line) => line.includes('sweep=outbox-relay') && line.includes('outcome=succeeded'),
    ).length;

  // T036
  it('is registered at a one-second cadence, and the scheduler runs it repeatedly on its own', async () => {
    expect(relay, 'outbox-relay is in SWEEPS').toBeDefined();
    if (relay === undefined) return;
    expect(relay.defaultCadenceSeconds).toBe(1);

    const lines: string[] = [];
    const scheduler = new SweepScheduler({
      sweeps: [relay],
      cadences: { [relay.name]: relay.defaultCadenceSeconds },
      clock: new SystemClock(),
      heartbeatPath: '/tmp/fp-worker-heartbeat-test',
      logger: recordingLogger(lines),
      random: () => 0,
    });

    try {
      scheduler.start();
      // Three runs at a one-second cadence: it is ticking, not just started once.
      const ticking = await eventually(() => Promise.resolve(succeededRuns(lines) >= 3), 8_000);
      expect(ticking, `outbox-relay ran ${String(succeededRuns(lines))} time(s)`).toBe(true);
    } finally {
      await scheduler.stop(15_000);
    }
  });

  // T036 / FR-025
  it('is flagged by the scheduler’s existing stall alert once it stops succeeding', async () => {
    expect(relay, 'outbox-relay is in SWEEPS').toBeDefined();
    if (relay === undefined) return;

    // A clock the test can move, so "three cadences without a success" does not
    // have to be waited out in real time.
    let offsetMs = 0;
    const clock = { now: () => new Date(Date.now() + offsetMs) };

    const lines: string[] = [];
    const scheduler = new SweepScheduler({
      sweeps: [relay],
      cadences: { [relay.name]: relay.defaultCadenceSeconds },
      clock,
      heartbeatPath: '/tmp/fp-worker-heartbeat-test',
      logger: recordingLogger(lines),
      random: () => 0,
    });

    const stalledLines = () => lines.filter((line) => line.includes('ALERT sweep_stalled'));

    try {
      scheduler.start();
      expect(await eventually(() => Promise.resolve(succeededRuns(lines) >= 1), 8_000)).toBe(true);
      expect(stalledLines(), 'no stall while it is succeeding').toEqual([]);

      // Break the relay the way an outage would: its queue endpoint stops answering.
      process.env.RELAY_QUEUE_ENDPOINT = 'http://127.0.0.1:1';
      // Three cadences (STALL_CADENCE_MULTIPLE) plus a margin, with no success in between.
      offsetMs += 10_000;

      const flagged = await eventually(() => Promise.resolve(stalledLines().length >= 1), 15_000);
      expect(flagged, 'ALERT sweep_stalled for outbox-relay').toBe(true);
      expect(stalledLines()).toHaveLength(1);
      expect(stalledLines()[0]).toContain('sweep=outbox-relay');
    } finally {
      process.env.RELAY_QUEUE_ENDPOINT = RELAY_ENDPOINT;
      await scheduler.stop(15_000);
    }
  });
});
