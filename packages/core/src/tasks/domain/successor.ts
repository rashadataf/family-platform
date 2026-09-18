import { ok, type DomainError, type Result } from '@fp/kernel';
import { nextOccurrenceAfter } from '@fp/kernel/recurrence';
import type { Due } from './due.js';
import type { Task } from './task.aggregate.js';

/**
 * The successor rule (FR-020–FR-023, data-model.md), pure.
 *
 * Given a closing head and the moment it closed, the successor's due date is
 * the first date the rule produces strictly after BOTH the head's due moment
 * and the closing moment:
 *
 * - closed early, it advances exactly one scheduled date;
 * - closed weeks late, it lands on the first date after "now", and the missed
 *   dates are never created as a backlog of already-overdue chores.
 *
 * The rule is expanded from the SERIES anchor, never from this instance's due
 * date — so `COUNT` ends when it should, and a one-off move of this instance
 * does not drag the series with it (research.md §2).
 *
 * `null` means no successor: the task is not a recurring head, or the rule has
 * ended. That is a normal end of series, not an error.
 */
export function successorDueOf(head: Task, closedAt: Date): Result<Due | null, DomainError> {
  const rule = head.recurrenceRule;
  const anchor = head.recurrenceAnchor;
  const due = head.due;
  const dueAt = head.dueAt;
  if (!head.isSeriesHead || rule === null || anchor === null || due === null || dueAt === null) {
    return ok(null);
  }

  const next = nextOccurrenceAfter({
    rule,
    dtstart: anchor,
    timeZone: due.timeZone,
    after: new Date(Math.max(dueAt.getTime(), closedAt.getTime())),
  });
  if (!next.ok) return next;
  if (next.value === null) return ok(null);

  const { year, month, day, hour, minute } = next.value.local;
  const date = { year, month, day };
  return ok(
    due.kind === 'date'
      ? { kind: 'date', date, timeZone: due.timeZone }
      : { kind: 'date_time', date, time: { hour, minute }, timeZone: due.timeZone },
  );
}
