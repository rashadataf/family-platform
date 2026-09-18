import { err, ok, type DomainError, type Result, type TaskId } from '@fp/kernel';
import type { MemberVisibilityPort } from '../../../family/application/ports/member-visibility.port.js';
import type { Task } from '../../domain/task.aggregate.js';
import type { TasksUnitOfWorkPort } from '../ports/tasks-unit-of-work.port.js';
import {
  auditChildAssignment,
  guardedChildAssignees,
  hiddenAssignees,
  resolveVisibility,
  type Reader,
} from '../visibility.js';

/**
 * `GET …/tasks/:taskId`. A task with an assignee the reader may not see is
 * `NotFound`, indistinguishable from a missing one (FR-014, SC-004), and
 * guardianship is read fresh on every call. Every read touching a child's
 * assignment is audited, granted or denied (FR-015).
 */
export async function getTask(
  input: Reader & { taskId: TaskId },
  deps: { unitOfWork: TasksUnitOfWorkPort; visibility: MemberVisibilityPort },
): Promise<Result<Task, DomainError>> {
  const visibility = await resolveVisibility(deps.visibility, input);

  return deps.unitOfWork.withTasksFamilyContext(input.familyId, async (uow) => {
    const task = await uow.tasks.findById(input.taskId);
    if (task === null) return err({ kind: 'NotFound' });

    const hidden = hiddenAssignees(task.assignees, visibility);
    if (hidden.length > 0) {
      await auditChildAssignment(uow.audit, {
        reader: input,
        taskId: task.id,
        childMemberIds: hidden,
        view: 'task detail',
        result: 'denied',
      });
      return err({ kind: 'NotFound' });
    }

    await auditChildAssignment(uow.audit, {
      reader: input,
      taskId: task.id,
      childMemberIds: guardedChildAssignees(task.assignees, visibility),
      view: 'task detail',
      result: 'granted',
    });
    return ok(task);
  });
}
