import { err, ok, type DomainError, type Result, type TaskId } from '@fp/kernel';
import type { Task } from '../domain/task.aggregate.js';
import type { TasksUnitOfWork } from './ports/tasks-unit-of-work.port.js';
import {
  auditChildAssignment,
  hiddenAssignees,
  type Reader,
  type ResolvedVisibility,
} from './visibility.js';

/**
 * The ordering every write addressing an existing task follows
 * (contracts/tasks-api.md): lock the row, apply visibility, and only then
 * compare versions. A hidden task is `NotFound` before its version is looked
 * at, so a `409` can never confirm that a hidden task exists.
 */
export async function lockVisibleTask(
  uow: TasksUnitOfWork,
  reader: Reader,
  visibility: ResolvedVisibility,
  taskId: TaskId,
  expectedVersion: number | null,
): Promise<Result<Task, DomainError>> {
  const task = await uow.tasks.lockById(taskId);
  if (task === null) return err({ kind: 'NotFound' });

  const hidden = hiddenAssignees(task.assignees, visibility);
  if (hidden.length > 0) {
    await auditChildAssignment(uow.audit, {
      reader,
      taskId: task.id,
      childMemberIds: hidden,
      view: 'task change',
      result: 'denied',
    });
    return err({ kind: 'NotFound' });
  }

  if (expectedVersion !== null && expectedVersion !== task.version) {
    return err({ kind: 'VersionConflict', currentVersion: task.version });
  }
  return ok(task);
}
