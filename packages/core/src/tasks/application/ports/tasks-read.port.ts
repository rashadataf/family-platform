import type { DomainError, FamilyMemberId, Result } from '@fp/kernel';
import type { Task } from '../../domain/task.aggregate.js';
import type { ClosedCursor, OpenCursor } from './task.repository.js';
import type { Reader } from '../visibility.js';
import type { TaskPage } from '../queries/list-tasks.query.js';

/**
 * The read side, published as a port (ARCHITECTURE.md §7.1) so the dashboard
 * aggregate and the AI read path can depend on it later without this context
 * changing shape. Guardian-filtered and audited exactly as the HTTP routes are
 * — a second consumer gets no more permissive a read.
 */
export interface TasksReadPort {
  listOpenTasks(
    input: Reader & {
      assignee?: FamilyMemberId;
      overdueAt?: Date;
      dueFrom?: Date;
      dueTo?: Date;
      after?: OpenCursor;
      limit?: number;
    },
  ): Promise<Result<TaskPage<OpenCursor>, DomainError>>;

  listTaskHistory(
    input: Reader & { from: Date; to: Date; after?: ClosedCursor; limit?: number },
  ): Promise<Result<TaskPage<ClosedCursor>, DomainError>>;

  getTask(input: Reader & { taskId: Task['id'] }): Promise<Result<Task, DomainError>>;
}
