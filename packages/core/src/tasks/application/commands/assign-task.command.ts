import {
  ok,
  type Clock,
  type DomainError,
  type FamilyMemberId,
  type Result,
  type TaskId,
} from '@fp/kernel';
import type { MemberVisibilityPort } from '../../../family/application/ports/member-visibility.port.js';
import { taskAssignedEvent, taskUpdatedEvent } from '../../domain/events.js';
import type { Task } from '../../domain/task.aggregate.js';
import { lockVisibleTask } from '../access.js';
import { AssigneeNotInFamilyError } from '../ports/task-assignment.repository.js';
import type { TasksUnitOfWorkPort } from '../ports/tasks-unit-of-work.port.js';
import { catchRollback, RollbackWithError } from '../rollback.js';
import { resolveVisibility, type Reader } from '../visibility.js';

interface Deps {
  unitOfWork: TasksUnitOfWorkPort;
  visibility: MemberVisibilityPort;
  clock: Clock;
}
type Input = Reader & { taskId: TaskId; assigneeId: FamilyMemberId };

/**
 * `PUT …/tasks/:taskId/assignees/:memberId` — FR-013, FR-016. Idempotent by
 * construction: assigning an existing assignee returns the task and publishes
 * nothing. No `expectedVersion` — the intent is unambiguous whatever else
 * changed (contracts/tasks-api.md).
 */
export async function assignTask(input: Input, deps: Deps): Promise<Result<Task, DomainError>> {
  const now = deps.clock.now();
  const visibility = await resolveVisibility(deps.visibility, input);

  return catchRollback(() =>
    deps.unitOfWork.withTasksFamilyContext(input.familyId, async (uow) => {
      const locked = await lockVisibleTask(uow, input, visibility, input.taskId, null);
      if (!locked.ok) return locked;
      const task = locked.value;

      const assigned = task.assign(input.assigneeId, now);
      if (!assigned.ok) return assigned;
      if (!assigned.value) return ok(task);

      try {
        await uow.assignments.add(task.id, [input.assigneeId], input.memberId);
      } catch (error) {
        if (error instanceof AssigneeNotInFamilyError) {
          throw new RollbackWithError({ kind: 'AssigneeInvalid' });
        }
        throw error;
      }
      await uow.tasks.save(task);
      await uow.outbox.append(
        taskAssignedEvent({
          familyId: input.familyId,
          taskId: task.id,
          memberId: input.assigneeId,
          correlationId: input.correlationId,
        }),
      );
      return ok(task);
    }),
  );
}

/** `DELETE …/tasks/:taskId/assignees/:memberId`. Idempotent; the task stays, possibly unassigned. */
export async function unassignTask(input: Input, deps: Deps): Promise<Result<Task, DomainError>> {
  const now = deps.clock.now();
  const visibility = await resolveVisibility(deps.visibility, input);

  return deps.unitOfWork.withTasksFamilyContext(input.familyId, async (uow) => {
    const locked = await lockVisibleTask(uow, input, visibility, input.taskId, null);
    if (!locked.ok) return locked;
    const task = locked.value;

    const unassigned = task.unassign(input.assigneeId, now);
    if (!unassigned.ok) return unassigned;
    if (!unassigned.value) return ok(task);

    await uow.assignments.remove(task.id, input.assigneeId);
    await uow.tasks.save(task);
    await uow.outbox.append(
      taskUpdatedEvent({
        familyId: input.familyId,
        taskId: task.id,
        changed: ['assignees'],
        correlationId: input.correlationId,
      }),
    );
    return ok(task);
  });
}
