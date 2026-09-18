import {
  ok,
  type Clock,
  type DomainError,
  type Result,
  type TaskId,
  type TaskSeriesId,
} from '@fp/kernel';
import type { MemberVisibilityPort } from '../../../family/application/ports/member-visibility.port.js';
import { taskUpdatedEvent } from '../../domain/events.js';
import type { Task, TaskPatch } from '../../domain/task.aggregate.js';
import { lockVisibleTask } from '../access.js';
import type { TasksUnitOfWorkPort } from '../ports/tasks-unit-of-work.port.js';
import { resolveVisibility, type Reader } from '../visibility.js';

/**
 * `PATCH …/tasks/:taskId` — FR-010, FR-011. Any writer may edit any open task
 * they can see (spec.md Assumptions). A no-op edit changes nothing, publishes
 * nothing and does not bump the version.
 */
export async function updateTask(
  input: Reader & {
    taskId: TaskId;
    expectedVersion: number;
    patch: TaskPatch;
    newSeriesId: TaskSeriesId;
  },
  deps: { unitOfWork: TasksUnitOfWorkPort; visibility: MemberVisibilityPort; clock: Clock },
): Promise<Result<Task, DomainError>> {
  const now = deps.clock.now();
  const visibility = await resolveVisibility(deps.visibility, input);

  return deps.unitOfWork.withTasksFamilyContext(input.familyId, async (uow) => {
    const locked = await lockVisibleTask(
      uow,
      input,
      visibility,
      input.taskId,
      input.expectedVersion,
    );
    if (!locked.ok) return locked;
    const task = locked.value;

    const changed = task.update(input.patch, { now, newSeriesId: input.newSeriesId });
    if (!changed.ok) return changed;

    if (changed.value.length > 0) {
      await uow.tasks.save(task);
      await uow.outbox.append(
        taskUpdatedEvent({
          familyId: input.familyId,
          taskId: task.id,
          changed: changed.value,
          correlationId: input.correlationId,
        }),
      );
    }
    return ok(task);
  });
}
