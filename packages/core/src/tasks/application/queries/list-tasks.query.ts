import { err, ok, type DomainError, type FamilyMemberId, type Result } from '@fp/kernel';
import type { MemberVisibilityPort } from '../../../family/application/ports/member-visibility.port.js';
import type { Task } from '../../domain/task.aggregate.js';
import type { ClosedCursor, OpenCursor, TaskRepository } from '../ports/task.repository.js';
import type { TasksUnitOfWork, TasksUnitOfWorkPort } from '../ports/tasks-unit-of-work.port.js';
import {
  auditChildAssignment,
  guardedChildAssignees,
  resolveVisibility,
  type Reader,
  type ResolvedVisibility,
} from '../visibility.js';

/** Wider than this and a range is refused rather than quietly slow (contracts/tasks-api.md). */
export const MAX_RANGE_DAYS = 400;
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

const MS_PER_DAY = 86_400_000;

export interface TaskPage<C> {
  readonly items: readonly Task[];
  readonly next: C | null;
}

function checkRange(from: Date | undefined, to: Date | undefined): DomainError | null {
  for (const value of [from, to]) {
    if (value !== undefined && Number.isNaN(value.getTime())) {
      return { kind: 'InvalidTimeRange', reason: 'Range bounds must be real instants.' };
    }
  }
  if (from !== undefined && to !== undefined) {
    if (to.getTime() <= from.getTime()) {
      return { kind: 'InvalidTimeRange', reason: 'The end of a range must be after its start.' };
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * MS_PER_DAY) {
      return { kind: 'RangeTooWide', maxDays: MAX_RANGE_DAYS };
    }
  }
  return null;
}

function pageSize(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
}

/** Audited once per task returned that has a guarded child assignee — never per page (contracts/tasks-api.md). */
async function auditPage(
  uow: TasksUnitOfWork,
  reader: Reader,
  visibility: ResolvedVisibility,
  items: readonly Task[],
  view: 'task list' | 'task history',
): Promise<void> {
  for (const task of items) {
    await auditChildAssignment(uow.audit, {
      reader,
      taskId: task.id,
      childMemberIds: guardedChildAssignees(task.assignees, visibility),
      view,
      result: 'granted',
    });
  }
}

/** Fetch one more than asked, so "is there a next page" costs no count query — and no count is ever exposed. */
async function page<C>(
  fetch: (repository: TaskRepository, limit: number) => Promise<readonly Task[]>,
  uow: TasksUnitOfWork,
  limit: number,
  cursorOf: (task: Task) => C,
): Promise<TaskPage<C>> {
  const rows = await fetch(uow.tasks, limit + 1);
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, next: rows.length > limit && last !== undefined ? cursorOf(last) : null };
}

/**
 * `GET …/tasks` — FR-005. Open tasks only, due moment ascending with undated
 * last. The visibility filter is applied IN the query, so neither a page's
 * length nor its cursor carries a trace of a hidden task (FR-014).
 *
 * A non-guardian filtering by a child's id gets an empty page, not an error:
 * an error would confirm the id is a child in this family.
 */
export async function listOpenTasks(
  input: Reader & {
    assignee?: FamilyMemberId;
    overdueAt?: Date;
    dueFrom?: Date;
    dueTo?: Date;
    after?: OpenCursor;
    limit?: number;
  },
  deps: { unitOfWork: TasksUnitOfWorkPort; visibility: MemberVisibilityPort },
): Promise<Result<TaskPage<OpenCursor>, DomainError>> {
  const invalid = checkRange(input.dueFrom, input.dueTo);
  if (invalid !== null) return err(invalid);
  const limit = pageSize(input.limit);
  const visibility = await resolveVisibility(deps.visibility, input);

  return deps.unitOfWork.withTasksFamilyContext(input.familyId, async (uow) => {
    const result = await page(
      (repository, fetchLimit) =>
        repository.listOpen({
          visibleMemberIds: visibility.visibleMemberIds,
          assignee: input.assignee,
          overdueAt: input.overdueAt,
          dueFrom: input.dueFrom,
          dueTo: input.dueTo,
          after: input.after,
          limit: fetchLimit,
        }),
      uow,
      limit,
      (task) => ({ dueAt: task.dueAt, id: task.id }),
    );
    await auditPage(uow, input, visibility, result.items, 'task list');
    return ok(result);
  });
}

/** `GET …/tasks/history` — FR-006. Closed tasks by closure time, newest first, visibility in the query. */
export async function listTaskHistory(
  input: Reader & { from: Date; to: Date; after?: ClosedCursor; limit?: number },
  deps: { unitOfWork: TasksUnitOfWorkPort; visibility: MemberVisibilityPort },
): Promise<Result<TaskPage<ClosedCursor>, DomainError>> {
  const invalid = checkRange(input.from, input.to);
  if (invalid !== null) return err(invalid);
  const limit = pageSize(input.limit);
  const visibility = await resolveVisibility(deps.visibility, input);

  return deps.unitOfWork.withTasksFamilyContext(input.familyId, async (uow) => {
    const result = await page(
      (repository, fetchLimit) =>
        repository.listClosed({
          visibleMemberIds: visibility.visibleMemberIds,
          from: input.from,
          to: input.to,
          after: input.after,
          limit: fetchLimit,
        }),
      uow,
      limit,
      (task) => {
        const state = task.state;
        // Unreachable: listClosed returns closed tasks only.
        if (state.status === 'open') throw new Error(`task ${task.id} in history is open`);
        return { closedAt: state.at, id: task.id };
      },
    );
    await auditPage(uow, input, visibility, result.items, 'task history');
    return ok(result);
  });
}
