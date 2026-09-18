import { SystemClock } from '@fp/platform';
import {
  scopeTo,
  seedDateOnlyTask,
  seedFamily,
  withDatabase,
  withDatabaseCommitted,
} from '@fp/testing';
import { describe, expect, it } from 'vitest';
import { SWEEPS } from '../sweeps/registry.js';
import { SweepScheduler, type SchedulerLogger } from './scheduler.js';

const ONE_HOUR = 3_600;

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
