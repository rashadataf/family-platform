import type { FamilyId, FamilyMemberId } from '@fp/kernel';
import { prisma } from '../../client.js';

/**
 * Constitution Principle XI for the Tasks context (spec 010 T090).
 *
 * `eraseTasksForFamily` is one statement: `task_assignment` references its
 * task through the composite `(task_id, family_id)` key with `ON DELETE
 * CASCADE`, and `predecessor_id` is `ON DELETE SET NULL`, so deleting the
 * family's tasks in any order removes the rest and never trips on the
 * successor chain. Scoped by `app.family_id`.
 */
export async function eraseTasksForFamily(familyId: FamilyId): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
    await tx.task.deleteMany({});
  });
}

/**
 * `eraseTasksForMember` removes that member's assignments and nothing else.
 * Tasks they created, completed or cancelled stay as the family's own record;
 * those actor columns already point at the tombstone Family's own
 * `eraseForMember` leaves, so they never dangle. Titles and notes are free text
 * the household wrote and are NOT scrubbed — the stated limitation.
 *
 * Discovery runs behind `app.is_erasure` (`task_assignment_erasure_select`);
 * each delete runs under the ordinary family scope.
 */
export async function eraseTasksForMember(memberId: FamilyMemberId): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_erasure', 'true', true)`;
    const families = await tx.taskAssignment.findMany({
      where: { memberId },
      select: { familyId: true },
      distinct: ['familyId'],
    });

    for (const { familyId } of families) {
      await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
      await tx.taskAssignment.deleteMany({ where: { memberId, familyId } });
    }
  });
}
