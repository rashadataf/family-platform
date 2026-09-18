import { tasks } from '@fp/core';
import { asFamilyMemberId, type FamilyId, type FamilyMemberId, type TaskId } from '@fp/kernel';
import { Prisma } from '../../generated/prisma/index.js';
import type { TransactionClient } from '../../testing.js';

/** PostgreSQL's foreign_key_violation, as Prisma reports it for a model call. */
const FOREIGN_KEY_VIOLATION = 'P2003';

export class PrismaTaskAssignmentRepository implements tasks.TaskAssignmentRepository {
  constructor(
    private readonly tx: TransactionClient,
    private readonly familyId: FamilyId,
  ) {}

  async add(
    taskId: TaskId,
    memberIds: readonly FamilyMemberId[],
    assignedByMemberId: FamilyMemberId | null,
  ): Promise<void> {
    if (memberIds.length === 0) return;
    try {
      // The composite foreign key onto `family_member (id, family_id)` is the
      // check (FR-016). Foreign-key checks are not subject to row-level
      // security, so this is the database answering "is this a member of THIS
      // family" — not Tasks reading a Family table (FR-030).
      await this.tx.taskAssignment.createMany({
        data: memberIds.map((memberId) => ({
          taskId,
          familyId: this.familyId,
          memberId,
          assignedByMemberId,
        })),
        skipDuplicates: true,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === FOREIGN_KEY_VIOLATION
      ) {
        throw new tasks.AssigneeNotInFamilyError();
      }
      throw error;
    }
  }

  async remove(taskId: TaskId, memberId: FamilyMemberId): Promise<void> {
    await this.tx.taskAssignment.deleteMany({ where: { taskId, memberId } });
  }

  async listForTask(taskId: TaskId): Promise<readonly tasks.TaskAssignment[]> {
    const rows = await this.tx.taskAssignment.findMany({
      where: { taskId },
      orderBy: [{ assignedAt: 'asc' }, { memberId: 'asc' }],
    });
    return rows.map((row) => ({
      memberId: asFamilyMemberId(row.memberId),
      assignedAt: row.assignedAt,
    }));
  }
}
