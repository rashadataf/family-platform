import type { Task } from './task.aggregate.js';

/**
 * FR-025: an open task whose due moment has passed. Read against a clock at
 * response time, so a task reads as overdue the moment it is, whether or not
 * the sweep has run.
 */
export function isOverdue(task: Task, now: Date): boolean {
  return task.isOverdue(now);
}

/**
 * FR-027: whether the sweep still owes this task a `TaskOverdue` for its
 * current due moment (research.md §5). True once per due moment: after
 * reporting, the marker equals `dueAt`; moving the due date makes them
 * distinct again, which re-arms it.
 *
 * The same predicate as the `task_overdue_unreported_idx` partial index, which
 * is what lets the command re-check it under the row lock.
 */
export function needsOverdueReport(task: Task, now: Date): boolean {
  const dueAt = task.dueAt;
  if (!task.isOverdue(now) || dueAt === null) return false;
  return task.overdueReportedFor?.getTime() !== dueAt.getTime();
}
