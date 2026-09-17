import type { FamilyMemberId, TaskId } from '@fp/kernel';
import type { TaskAssignment } from '../../domain/task-assignment.js';

/**
 * Raised when an assignee is not a member of the scoped family. The database
 * decides it — `task_assignment`'s composite foreign key onto
 * `family_member (id, family_id)` — so Tasks never reads a Family table to find
 * out (FR-016, FR-030). Carries nothing about the member.
 */
export class AssigneeNotInFamilyError extends Error {
  constructor() {
    super('An assignee is not a member of this family.');
    this.name = 'AssigneeNotInFamilyError';
  }
}

/** Scoped by construction. */
export interface TaskAssignmentRepository {
  /**
   * Adds assignments, skipping ones that already exist. Throws
   * `AssigneeNotInFamilyError` if any member is not in the scoped family; the
   * caller rolls the whole transaction back.
   */
  add(
    taskId: TaskId,
    memberIds: readonly FamilyMemberId[],
    assignedByMemberId: FamilyMemberId | null,
  ): Promise<void>;

  remove(taskId: TaskId, memberId: FamilyMemberId): Promise<void>;

  listForTask(taskId: TaskId): Promise<readonly TaskAssignment[]>;
}
