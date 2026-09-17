import { ok, type Clock, type DomainError, type Result, type TaskId } from '@fp/kernel';
import type { MemberVisibilityPort } from '../../../family/application/ports/member-visibility.port.js';
import {
  taskCancelledEvent,
  taskCompletedEvent,
  taskCreatedEvent,
  taskUpdatedEvent,
} from '../../domain/events.js';
import { successorDueOf } from '../../domain/successor.js';
import { Task } from '../../domain/task.aggregate.js';
import { lockVisibleTask } from '../access.js';
import type { TasksUnitOfWork, TasksUnitOfWorkPort } from '../ports/tasks-unit-of-work.port.js';
import { catchRollback, orRollback } from '../rollback.js';
import { resolveVisibility, type Reader } from '../visibility.js';

export interface CloseTaskOutcome {
  readonly task: Task;
  readonly successor: Task | null;
}

interface Deps {
  unitOfWork: TasksUnitOfWorkPort;
  visibility: MemberVisibilityPort;
  clock: Clock;
}
type CloseInput = Reader & { taskId: TaskId; expectedVersion: number; successorId: TaskId };

/**
 * FR-020–FR-023, research.md §3: spawns the successor of a closing head in the
 * closing transaction, so no reader ever sees the head closed without it.
 *
 * The head flag is cleared on the closing row BEFORE the successor is inserted:
 * `task_one_head_per_series` is a partial unique index checked per statement.
 * A reopened former head is not the head, so it never spawns a second
 * successor; `UNIQUE (predecessor_id)` is the backstop if that ever regresses.
 */
async function spawnSuccessor(
  uow: TasksUnitOfWork,
  head: Task,
  input: CloseInput,
  now: Date,
): Promise<Task | null> {
  const due = orRollback(successorDueOf(head, now));
  if (due === null) return null;

  const successor = Task.successorOf({
    id: input.successorId,
    head,
    due,
    createdByMemberId: input.memberId,
    now,
  });
  head.relinquishHead();
  // One call, because the ORDER is the invariant: the old head's flag is
  // cleared before the successor is inserted, and the repository refuses a
  // predecessor that is still flagged (research.md §3, FR-019).
  await uow.tasks.handOverHead(head, successor);
  // Copied assignments emit no TaskAssigned: nobody assigned anything, and
  // TaskCreated with a predecessorId already implies them (research.md §7).
  await uow.assignments.add(successor.id, successor.assignees, input.memberId);
  await uow.outbox.append(
    taskCreatedEvent({
      familyId: input.familyId,
      taskId: successor.id,
      seriesId: successor.seriesId,
      predecessorId: head.id,
      dueKind: successor.due?.kind ?? 'none',
      correlationId: input.correlationId,
    }),
  );
  return successor;
}

/** `POST …/tasks/:taskId/complete` — FR-008, FR-009. */
export async function completeTask(
  input: CloseInput,
  deps: Deps,
): Promise<Result<CloseTaskOutcome, DomainError>> {
  const now = deps.clock.now();
  const visibility = await resolveVisibility(deps.visibility, input);

  return catchRollback(() =>
    deps.unitOfWork.withTasksFamilyContext(input.familyId, async (uow) => {
      const locked = await lockVisibleTask(
        uow,
        input,
        visibility,
        input.taskId,
        input.expectedVersion,
      );
      if (!locked.ok) return locked;
      const task = locked.value;

      const completed = task.complete(input.memberId, now);
      if (!completed.ok) return completed;
      await uow.tasks.save(task);
      await uow.outbox.append(
        taskCompletedEvent({
          familyId: input.familyId,
          taskId: task.id,
          completedByMemberId: input.memberId,
          correlationId: input.correlationId,
        }),
      );

      const successor = await spawnSuccessor(uow, task, input, now);
      return ok({ task, successor });
    }),
  );
}

/**
 * `POST …/tasks/:taskId/cancel` — FR-008. `scope: 'instance'` skips this one
 * and the series carries on; `scope: 'series'` stops it, and the cancelled row
 * stays the (closed) head of an ended series. On a task that is not a recurring
 * head the two are identical.
 */
export async function cancelTask(
  input: CloseInput & { scope: 'instance' | 'series' },
  deps: Deps,
): Promise<Result<CloseTaskOutcome, DomainError>> {
  const now = deps.clock.now();
  const visibility = await resolveVisibility(deps.visibility, input);

  return catchRollback(() =>
    deps.unitOfWork.withTasksFamilyContext(input.familyId, async (uow) => {
      const locked = await lockVisibleTask(
        uow,
        input,
        visibility,
        input.taskId,
        input.expectedVersion,
      );
      if (!locked.ok) return locked;
      const task = locked.value;

      const cancelled = task.cancel(input.memberId, now);
      if (!cancelled.ok) return cancelled;
      await uow.tasks.save(task);
      await uow.outbox.append(
        taskCancelledEvent({
          familyId: input.familyId,
          taskId: task.id,
          scope: input.scope,
          correlationId: input.correlationId,
        }),
      );

      const successor =
        input.scope === 'series' ? null : await spawnSuccessor(uow, task, input, now);
      return ok({ task, successor });
    }),
  );
}

/** `POST …/tasks/:taskId/reopen` — FR-008. Never spawns, never becomes head again (FR-019). */
export async function reopenTask(
  input: Reader & { taskId: TaskId; expectedVersion: number },
  deps: Deps,
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

    const reopened = task.reopen(now);
    if (!reopened.ok) return reopened;
    await uow.tasks.save(task);
    await uow.outbox.append(
      taskUpdatedEvent({
        familyId: input.familyId,
        taskId: task.id,
        changed: ['status'],
        correlationId: input.correlationId,
      }),
    );
    return ok(task);
  });
}
