import {
  ok,
  type Clock,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type Result,
  type TaskId,
  type TaskSeriesId,
} from '@fp/kernel';
import type { Due } from '../../domain/due.js';
import { taskAssignedEvent, taskCreatedEvent } from '../../domain/events.js';
import { Task, type TaskCategory, type TaskPriority } from '../../domain/task.aggregate.js';
import { AssigneeNotInFamilyError } from '../ports/task-assignment.repository.js';
import type { TasksUnitOfWorkPort } from '../ports/tasks-unit-of-work.port.js';
import { catchRollback, RollbackWithError } from '../rollback.js';

export interface CreateTaskInput {
  familyId: FamilyId;
  taskId: TaskId;
  newSeriesId: TaskSeriesId;
  createdByMemberId: FamilyMemberId;
  title: string;
  notes?: string | null;
  priority?: TaskPriority;
  category?: TaskCategory | null;
  due?: Due | null;
  recurrenceRule?: string | null;
  assigneeIds?: readonly FamilyMemberId[];
  correlationId: string;
}

/**
 * FR-001–FR-004, FR-013, FR-017. Validates through the aggregate before any
 * I/O, then writes the task, its assignments and its outbox rows in ONE
 * transaction — so a foreign assignee leaves nothing behind.
 *
 * Creating a task assigned to a child the creator does not guard is allowed
 * (contracts/tasks-api.md): writing is `tasks:write`, and the task simply
 * becomes invisible to its creator on the next read. That is asserted, not
 * accidental.
 */
export async function createTask(
  input: CreateTaskInput,
  deps: { unitOfWork: TasksUnitOfWorkPort; clock: Clock },
): Promise<Result<Task, DomainError>> {
  const now = deps.clock.now();
  const created = Task.create({
    id: input.taskId,
    familyId: input.familyId,
    newSeriesId: input.newSeriesId,
    title: input.title,
    notes: input.notes,
    priority: input.priority,
    category: input.category,
    due: input.due,
    recurrenceRule: input.recurrenceRule,
    assignees: input.assigneeIds,
    createdByMemberId: input.createdByMemberId,
    now,
  });
  if (!created.ok) return created;
  const task = created.value;

  return catchRollback(() =>
    deps.unitOfWork.withTasksFamilyContext(input.familyId, async (uow) => {
      await uow.tasks.insert(task);
      try {
        await uow.assignments.add(task.id, task.assignees, input.createdByMemberId);
      } catch (error) {
        if (error instanceof AssigneeNotInFamilyError) {
          throw new RollbackWithError({ kind: 'AssigneeInvalid' });
        }
        throw error;
      }

      await uow.outbox.append(
        taskCreatedEvent({
          familyId: input.familyId,
          taskId: task.id,
          seriesId: task.seriesId,
          predecessorId: null,
          dueKind: task.due?.kind ?? 'none',
          correlationId: input.correlationId,
        }),
      );
      for (const memberId of task.assignees) {
        await uow.outbox.append(
          taskAssignedEvent({
            familyId: input.familyId,
            taskId: task.id,
            memberId,
            correlationId: input.correlationId,
          }),
        );
      }
      return ok(task);
    }),
  );
}
