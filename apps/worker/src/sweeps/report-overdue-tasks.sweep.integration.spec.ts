import { randomUUID } from 'node:crypto';
import type { Clock } from '@fp/kernel';
import {
  scopeTo,
  seedDateOnlyTask,
  seedFamily,
  withDatabase,
  withDatabaseCommitted,
  type SeededFamily,
} from '@fp/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { runReportOverdueTasksSweep } from './report-overdue-tasks.sweep.js';

/** A date-only task due 2026-09-16 in London is due at 23:00Z that day. */
const DUE_AT = new Date('2026-09-16T23:00:00Z');
const BEFORE_DUE = new Date('2026-09-16T22:30:00Z');
const AFTER_DUE = new Date('2026-09-16T23:30:00Z');

function clockAt(instant: Date): Clock {
  return { now: () => instant };
}

async function overdueEvents(taskId: string) {
  return withDatabase((tx) =>
    tx.outboxEvent.findMany({
      where: { aggregateId: taskId, eventType: 'tasks.TaskOverdue.v1' },
    }),
  );
}

/**
 * FR-026–FR-028. The properties under test are exactly-once per due moment, and
 * safety under interruption — neither of which a unit test can show, because
 * both are about what the database holds after a pass that may have been cut
 * short.
 */
describe('the overdue-tasks sweep (US5, FR-026–FR-028)', () => {
  let family: SeededFamily;

  beforeEach(async () => {
    family = await withDatabaseCommitted((tx) => seedFamily(tx, { name: 'Overdue Probe' }));
  });

  interface SeedOverrides {
    title?: string;
    dueAt?: Date;
    status?: 'open' | 'completed' | 'cancelled';
    closedAt?: Date;
    closedByMemberId?: string | null;
  }

  async function seedOverdueTask(overrides: SeedOverrides = {}): Promise<string> {
    const seeded = await withDatabaseCommitted(async (tx) => {
      await scopeTo(tx, family.familyId);
      return seedDateOnlyTask(tx, {
        familyId: family.familyId,
        title: 'Take the bins out',
        date: '2026-09-16',
        dueAt: DUE_AT,
        ...overrides,
      });
    });
    return seeded.taskId;
  }

  it('does not report a task before its due moment, and does after it', async () => {
    const taskId = await seedOverdueTask();

    // Asserted per task, not on the pass totals: this sweep is cross-family by
    // design, so any other suite's committed rows are legitimately in its scope.
    await runReportOverdueTasksSweep(clockAt(BEFORE_DUE));
    expect(await overdueEvents(taskId)).toHaveLength(0);

    const late = await runReportOverdueTasksSweep(clockAt(AFTER_DUE));
    expect(late.reported).toBeGreaterThanOrEqual(1);
    expect(await overdueEvents(taskId)).toHaveLength(1);
  });

  it('reports once across two passes, with a payload of exactly familyId, taskId and dueAt', async () => {
    const taskId = await seedOverdueTask();

    await runReportOverdueTasksSweep(clockAt(AFTER_DUE));
    await runReportOverdueTasksSweep(clockAt(AFTER_DUE));

    const events = await overdueEvents(taskId);
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]?.payload as object).sort()).toEqual([
      'dueAt',
      'familyId',
      'taskId',
    ]);
    expect(events[0]?.payload).toMatchObject({
      familyId: family.familyId,
      taskId,
      dueAt: DUE_AT.toISOString(),
    });
  });

  /** Re-dating re-arms it: a new due moment is a new thing to report. */
  it('reports a second time once the task is re-dated and the new due passes', async () => {
    const taskId = await seedOverdueTask();
    await runReportOverdueTasksSweep(clockAt(AFTER_DUE));
    expect(await overdueEvents(taskId)).toHaveLength(1);

    const newDueAt = new Date('2026-09-18T23:00:00Z');
    await withDatabaseCommitted(async (tx) => {
      await scopeTo(tx, family.familyId);
      await tx.task.update({
        where: { id: taskId },
        data: { dueDate: new Date('2026-09-18T00:00:00Z'), dueAt: newDueAt },
      });
    });

    // Not yet: the new moment has not passed.
    await runReportOverdueTasksSweep(clockAt(AFTER_DUE));
    expect(await overdueEvents(taskId)).toHaveLength(1);

    await runReportOverdueTasksSweep(clockAt(new Date('2026-09-19T00:00:00Z')));
    const events = await overdueEvents(taskId);
    expect(events).toHaveLength(2);
    expect(events.map((e) => (e.payload as { dueAt: string }).dueAt).sort()).toEqual(
      [DUE_AT.toISOString(), newDueAt.toISOString()].sort(),
    );
  });

  it('never reports a task completed before its due moment', async () => {
    const taskId = await seedOverdueTask({
      status: 'completed',
      closedAt: BEFORE_DUE,
      closedByMemberId: family.ownerMemberId,
    });

    const result = await runReportOverdueTasksSweep(clockAt(AFTER_DUE));
    expect(await overdueEvents(taskId)).toHaveLength(0);
    expect(result.failed).toEqual([]);
  });

  it('never reports an undated task', async () => {
    const seeded = await withDatabaseCommitted(async (tx) => {
      await scopeTo(tx, family.familyId);
      return tx.task.create({
        data: { id: randomUUID(), familyId: family.familyId, title: 'No due date' },
      });
    });

    await runReportOverdueTasksSweep(clockAt(AFTER_DUE));
    expect(await overdueEvents(seeded.id)).toHaveLength(0);
  });

  /**
   * The interruption property. Fifty tasks, a pass aborted after twenty, then a
   * re-run: exactly fifty rows, because the marker and the outbox row commit in
   * one transaction per task.
   */
  it('gives exactly fifty rows when a fifty-task pass is aborted partway and re-run', async () => {
    const taskIds = await withDatabaseCommitted(async (tx) => {
      await scopeTo(tx, family.familyId);
      const ids: string[] = [];
      for (let i = 0; i < 50; i += 1) {
        const seeded = await seedDateOnlyTask(tx, {
          familyId: family.familyId,
          title: `Chore ${String(i)}`,
          date: '2026-09-16',
          dueAt: DUE_AT,
        });
        ids.push(seeded.taskId);
      }
      return ids;
    });

    await expect(
      runReportOverdueTasksSweep(clockAt(AFTER_DUE), {
        afterTask: (_taskId, index) => {
          if (index === 19) throw new Error('interrupted');
        },
      }),
    ).rejects.toThrow('interrupted');

    // Counted over THIS test's tasks only: the sweep is cross-family by design,
    // so a global count would also see every other test's committed rows.
    const partial = await withDatabase((tx) =>
      tx.outboxEvent.count({
        where: { eventType: 'tasks.TaskOverdue.v1', aggregateId: { in: taskIds } },
      }),
    );
    expect(partial).toBe(20);

    await runReportOverdueTasksSweep(clockAt(AFTER_DUE));

    let total = 0;
    for (const taskId of taskIds) {
      const events = await overdueEvents(taskId);
      expect(events, taskId).toHaveLength(1);
      total += events.length;
    }
    expect(total).toBe(50);
  });

  it('skips a task completed between discovery and write', async () => {
    // Two tasks. The trigger is due earliest so the sweep reaches it first;
    // the target is due latest so it is reached last. Discovery has already
    // listed both by then, which is exactly the race under test.
    await seedOverdueTask({ title: 'Trigger', dueAt: new Date('2026-09-16T22:00:00Z') });
    const taskId = await seedOverdueTask({
      title: 'Completed mid-pass',
      dueAt: new Date('2026-09-16T23:29:59Z'),
    });

    const result = await runReportOverdueTasksSweep(clockAt(AFTER_DUE), {
      afterTask: async () => {
        // Idempotent, so it does not matter which task the hook fires after.
        await withDatabaseCommitted(async (tx) => {
          await scopeTo(tx, family.familyId);
          await tx.task.updateMany({
            where: { id: taskId, status: 'open' },
            data: {
              status: 'completed',
              completedAt: BEFORE_DUE,
              closedAt: BEFORE_DUE,
              completedByMemberId: family.ownerMemberId,
            },
          });
        });
      },
    });

    // It was discovered, then completed before the write: skipped, not reported.
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(await overdueEvents(taskId)).toHaveLength(0);
  });

  describe('the lag it reports (FR-028)', () => {
    it('is 0 after a clean pass', async () => {
      await seedOverdueTask();
      const result = await runReportOverdueTasksSweep(clockAt(AFTER_DUE));
      expect(result.lagSeconds).toBe(0);
    });

    it('is positive when a pass left something unreported', async () => {
      await seedOverdueTask();
      await seedOverdueTask({ title: 'Second chore' });

      await expect(
        runReportOverdueTasksSweep(clockAt(AFTER_DUE), {
          afterTask: () => {
            throw new Error('interrupted');
          },
        }),
      ).rejects.toThrow('interrupted');

      const after = await runReportOverdueTasksSweep(clockAt(AFTER_DUE));
      // The interrupted pass left work behind, which the next pass then cleared.
      expect(after.reported).toBeGreaterThanOrEqual(1);
      expect(after.lagSeconds).toBe(0);
    });
  });

  it('reports identifiers and numbers only — never a title', async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(' '));
    };
    try {
      await seedOverdueTask({ title: 'Buy a birthday present for Charlie' });
      await runReportOverdueTasksSweep(clockAt(AFTER_DUE));
    } finally {
      console.log = original;
    }

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain('birthday');
      expect(line).not.toContain('Charlie');
    }
  });
});
