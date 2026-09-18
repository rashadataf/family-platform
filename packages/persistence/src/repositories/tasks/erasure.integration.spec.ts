import { randomUUID } from 'node:crypto';
import { asFamilyId, asFamilyMemberId } from '@fp/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { withCommit, type TransactionClient } from '../../testing.js';
import { eraseTasksForFamily, eraseTasksForMember } from './erasure.js';

/**
 * Constitution Principle XI: deletion is designed, not retrofitted. These go
 * through the real erasure functions and then read the tables back, because the
 * failure they exist for is a row that survives an erasure nobody re-checked.
 *
 * Rows are seeded inline rather than through `@fp/testing`'s factories: that
 * package depends on THIS one (it wraps `withCommit`), so importing it here
 * would be a cycle. `tasks-context.integration.spec.ts` seeds the same way for
 * the same reason.
 */

const LONDON = 'Europe/London';

async function scopeTo(tx: TransactionClient, familyId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
}

interface Fixture {
  familyId: string;
  ownerMemberId: string;
  graceId: string;
  childId: string;
  plainTaskId: string;
  headTaskId: string;
  successorTaskId: string;
}

async function seedFixture(): Promise<Fixture> {
  const familyId = randomUUID();
  const ownerMemberId = randomUUID();
  const graceId = randomUUID();
  const childId = randomUUID();
  const plainTaskId = randomUUID();
  const headTaskId = randomUUID();
  const successorTaskId = randomUUID();
  const seriesId = randomUUID();

  await withCommit(async (tx) => {
    await scopeTo(tx, familyId);
    await tx.family.create({ data: { id: familyId, name: 'Erasure Probe' } });
    await tx.familyMember.createMany({
      data: [
        {
          id: ownerMemberId,
          familyId,
          kind: 'adult',
          role: 'owner',
          userId: randomUUID(),
          displayName: 'Ada',
        },
        {
          id: graceId,
          familyId,
          kind: 'adult',
          role: 'adult',
          userId: randomUUID(),
          displayName: 'Grace',
        },
        {
          id: childId,
          familyId,
          kind: 'child',
          role: 'viewer',
          userId: null,
          displayName: 'Charlie',
          dateOfBirth: new Date('2019-04-02'),
        },
      ],
    });
    await tx.guardianship.create({
      data: { id: randomUUID(), familyId, guardianMemberId: ownerMemberId, childMemberId: childId },
    });

    const dated = {
      dueKind: 'date' as const,
      timeZone: LONDON,
    };

    await tx.task.create({
      data: {
        id: plainTaskId,
        familyId,
        title: 'Take the bins out',
        createdByMemberId: ownerMemberId,
        dueDate: new Date('2026-09-16T00:00:00Z'),
        dueAt: new Date('2026-09-16T23:00:00Z'),
        ...dated,
      },
    });

    // A series chain, so erasure has to cope with `predecessor_id` too.
    await tx.task.create({
      data: {
        id: headTaskId,
        familyId,
        title: 'Weekly chore',
        createdByMemberId: ownerMemberId,
        dueDate: new Date('2026-09-17T00:00:00Z'),
        dueAt: new Date('2026-09-17T23:00:00Z'),
        recurrenceRule: 'FREQ=WEEKLY',
        recurrenceAnchor: new Date('2026-09-17T00:00:00Z'),
        seriesId,
        isSeriesHead: false,
        ...dated,
      },
    });
    await tx.task.create({
      data: {
        id: successorTaskId,
        familyId,
        title: 'Weekly chore',
        createdByMemberId: ownerMemberId,
        dueDate: new Date('2026-09-24T00:00:00Z'),
        dueAt: new Date('2026-09-24T23:00:00Z'),
        recurrenceRule: 'FREQ=WEEKLY',
        recurrenceAnchor: new Date('2026-09-17T00:00:00Z'),
        seriesId,
        isSeriesHead: true,
        predecessorId: headTaskId,
        ...dated,
      },
    });

    await tx.taskAssignment.createMany({
      data: [
        { taskId: plainTaskId, familyId, memberId: graceId },
        { taskId: plainTaskId, familyId, memberId: childId },
        { taskId: headTaskId, familyId, memberId: graceId },
        { taskId: successorTaskId, familyId, memberId: graceId },
      ],
    });
  });

  return {
    familyId,
    ownerMemberId,
    graceId,
    childId,
    plainTaskId,
    headTaskId,
    successorTaskId,
  };
}

/** Reads inside the family's own scope, since both tables are under FORCE RLS. */
async function inFamily<T>(
  familyId: string,
  work: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return withCommit(async (tx) => {
    await scopeTo(tx, familyId);
    return work(tx);
  });
}

describe('Tasks erasure (Phase 9, Principle XI)', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  describe('eraseTasksForFamily', () => {
    it('leaves no task or assignment referencing the family', async () => {
      await eraseTasksForFamily(asFamilyId(fixture.familyId));

      const remaining = await inFamily(fixture.familyId, async (tx) => ({
        tasks: await tx.task.count({}),
        assignments: await tx.taskAssignment.count({}),
      }));
      expect(remaining).toEqual({ tasks: 0, assignments: 0 });
    });

    it('removes a whole series chain without tripping on predecessor_id', async () => {
      await eraseTasksForFamily(asFamilyId(fixture.familyId));

      const found = await inFamily(fixture.familyId, (tx) =>
        tx.task.count({ where: { id: { in: [fixture.headTaskId, fixture.successorTaskId] } } }),
      );
      expect(found).toBe(0);
    });

    it('touches no other family’s tasks', async () => {
      const other = await seedFixture();
      await eraseTasksForFamily(asFamilyId(fixture.familyId));

      const survived = await inFamily(other.familyId, (tx) => tx.task.count({}));
      expect(survived).toBe(3);
    });

    it('is safe to run twice', async () => {
      await eraseTasksForFamily(asFamilyId(fixture.familyId));
      await expect(eraseTasksForFamily(asFamilyId(fixture.familyId))).resolves.toBeUndefined();
    });

    it('is a no-op for a family with no tasks', async () => {
      const emptyFamilyId = randomUUID();
      await withCommit(async (tx) => {
        await scopeTo(tx, emptyFamilyId);
        await tx.family.create({ data: { id: emptyFamilyId, name: 'Empty' } });
      });
      await expect(eraseTasksForFamily(asFamilyId(emptyFamilyId))).resolves.toBeUndefined();
    });
  });

  describe('eraseTasksForMember', () => {
    it('removes every assignment for that member and no other', async () => {
      await eraseTasksForMember(asFamilyMemberId(fixture.graceId));

      const rows = await inFamily(fixture.familyId, (tx) =>
        tx.taskAssignment.findMany({ select: { memberId: true } }),
      );
      expect(rows.map((row) => row.memberId)).toEqual([fixture.childId]);
    });

    /**
     * The stated limitation, asserted rather than left implicit: the tasks
     * survive with their titles untouched. They are the household's own record
     * of what happened, and the free text is theirs, not the departing
     * member's.
     */
    it('leaves the tasks themselves in place, titles untouched', async () => {
      await eraseTasksForMember(asFamilyMemberId(fixture.graceId));

      const tasks = await inFamily(fixture.familyId, (tx) =>
        tx.task.findMany({ select: { title: true } }),
      );
      expect(tasks).toHaveLength(3);
      expect(tasks.map((t) => t.title).sort()).toEqual([
        'Take the bins out',
        'Weekly chore',
        'Weekly chore',
      ]);
    });

    it('leaves the series chain intact', async () => {
      await eraseTasksForMember(asFamilyMemberId(fixture.graceId));

      const successor = await inFamily(fixture.familyId, (tx) =>
        tx.task.findUnique({
          where: { id: fixture.successorTaskId },
          select: { predecessorId: true },
        }),
      );
      expect(successor?.predecessorId).toBe(fixture.headTaskId);
    });

    /**
     * Actor columns carry no foreign key precisely so Family's own member
     * erasure can tombstone the member row without Tasks having to cascade.
     * Afterwards they point at a tombstone rather than dangling.
     */
    it('tolerates an actor column whose member row has been tombstoned', async () => {
      await inFamily(fixture.familyId, async (tx) => {
        await tx.task.updateMany({
          where: { id: fixture.plainTaskId },
          data: { createdByMemberId: null },
        });
      });
      await eraseTasksForMember(asFamilyMemberId(fixture.graceId));

      const task = await inFamily(fixture.familyId, (tx) =>
        tx.task.findUnique({
          where: { id: fixture.plainTaskId },
          select: { createdByMemberId: true },
        }),
      );
      expect(task?.createdByMemberId).toBeNull();
    });

    it('is a no-op for a member with no assignments anywhere', async () => {
      await expect(eraseTasksForMember(asFamilyMemberId(randomUUID()))).resolves.toBeUndefined();
    });

    it('is safe to run twice', async () => {
      await eraseTasksForMember(asFamilyMemberId(fixture.graceId));
      await expect(eraseTasksForMember(asFamilyMemberId(fixture.graceId))).resolves.toBeUndefined();
    });

    it('touches no other family’s assignments for a member of this one', async () => {
      const other = await seedFixture();
      await eraseTasksForMember(asFamilyMemberId(fixture.graceId));

      const survived = await inFamily(other.familyId, (tx) => tx.taskAssignment.count({}));
      expect(survived).toBe(4);
    });
  });
});
