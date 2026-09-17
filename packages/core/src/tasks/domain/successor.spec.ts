import {
  asFamilyId,
  asFamilyMemberId,
  asTaskId,
  asTaskSeriesId,
  type DomainError,
  type Result,
} from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { dueMomentOf, parseDue, type Due } from './due.js';
import { successorDueOf } from './successor.js';
import { Task } from './task.aggregate.js';

const familyId = asFamilyId('11111111-1111-7111-8111-111111111111');
const taskId = asTaskId('22222222-2222-7222-8222-222222222222');
const newSeriesId = asTaskSeriesId('33333333-3333-7333-8333-333333333333');
const ada = asFamilyMemberId('44444444-4444-7444-8444-444444444444');
const LONDON = 'Europe/London';

function dateDue(date: string): Due {
  const parsed = parseDue({ kind: 'date', date, timeZone: LONDON });
  if (!parsed.ok) throw new Error('fixture did not parse');
  return parsed.value;
}

function timedDue(date: string, time: string): Due {
  const parsed = parseDue({ kind: 'date_time', date, time, timeZone: LONDON });
  if (!parsed.ok) throw new Error('fixture did not parse');
  return parsed.value;
}

function head(params: { due: Due; rule: string; title?: string }): Task {
  const created = Task.create({
    id: taskId,
    familyId,
    newSeriesId,
    title: params.title ?? 'Take the bins out',
    due: params.due,
    recurrenceRule: params.rule,
    assignees: [ada],
    createdByMemberId: ada,
    now: new Date('2026-09-01T10:00:00Z'),
  });
  if (!created.ok) throw new Error(`fixture did not create: ${created.error.kind}`);
  return created.value;
}

function due(result: Result<Due | null, DomainError>): Due | null {
  if (!result.ok) throw new Error(`expected a due, got ${result.error.kind}`);
  return result.value;
}

/** Narrows a due a test has just asserted is present. */
function mustDue(value: Due | null): Due {
  if (value === null) throw new Error('expected a due date to be present');
  return value;
}

/** The successor's due date as `YYYY-MM-DD`, for readable assertions. */
function dateOf(value: Due | null): string | null {
  if (value === null) return null;
  const { year, month, day } = value.date;
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

describe('the successor rule (US4, FR-020–FR-023, data-model.md)', () => {
  /** 2026-09-17 is a Thursday. */
  const THURSDAY_RULE = 'FREQ=WEEKLY;BYDAY=TH';

  describe('after = max(dueAt, closedAt)', () => {
    it('advances exactly one scheduled date when closed early', () => {
      const task = head({ due: dateDue('2026-09-17'), rule: THURSDAY_RULE });
      // Closed two days before it was due.
      const next = due(successorDueOf(task, new Date('2026-09-15T10:00:00Z')));
      expect(dateOf(next)).toBe('2026-09-24');
    });

    it('advances one date when closed on the day, before the due moment', () => {
      const task = head({ due: dateDue('2026-09-17'), rule: THURSDAY_RULE });
      const next = due(successorDueOf(task, new Date('2026-09-17T12:00:00Z')));
      expect(dateOf(next)).toBe('2026-09-24');
    });

    /**
     * The rule that stops a backlog: closing three weeks late produces the first
     * date after NOW, not four already-overdue chores.
     */
    it('lands on the first date after now when closed three weeks late, with no backlog', () => {
      const task = head({ due: dateDue('2026-09-17'), rule: THURSDAY_RULE });
      const next = due(successorDueOf(task, new Date('2026-10-08T12:00:00Z')));
      expect(dateOf(next)).toBe('2026-10-15');
    });
  });

  it('carries every authored field forward, assignees included', () => {
    const task = head({ due: dateDue('2026-09-17'), rule: THURSDAY_RULE, title: 'Bins' });
    const nextDue = due(successorDueOf(task, new Date('2026-09-17T12:00:00Z')));
    expect(nextDue).not.toBeNull();
    if (nextDue === null) return;

    const successor = Task.successorOf({
      id: asTaskId('66666666-6666-7666-8666-666666666666'),
      head: task,
      due: nextDue,
      createdByMemberId: ada,
      now: new Date('2026-09-17T12:00:00Z'),
    });

    expect(successor.title).toBe('Bins');
    expect(successor.assignees).toEqual([ada]);
    expect(successor.seriesId).toBe(task.seriesId);
    expect(successor.predecessorId).toBe(task.id);
    expect(successor.isSeriesHead).toBe(true);
    expect(successor.status).toBe('open');
    expect(successor.version).toBe(1);
    // The anchor is the SERIES', carried unchanged — not this instance's due.
    expect(successor.recurrenceAnchor).toEqual(task.recurrenceAnchor);
  });

  it('keeps a date-only series date-only', () => {
    const task = head({ due: dateDue('2026-09-17'), rule: THURSDAY_RULE });
    const next = due(successorDueOf(task, new Date('2026-09-17T12:00:00Z')));
    expect(next?.kind).toBe('date');
  });

  it('keeps a timed series timed, at the same wall-clock time', () => {
    const task = head({ due: timedDue('2026-09-17', '19:00'), rule: THURSDAY_RULE });
    const next = due(successorDueOf(task, new Date('2026-09-17T20:00:00Z')));
    expect(next?.kind).toBe('date_time');
    expect(next).toMatchObject({ time: { hour: 19, minute: 0 }, timeZone: LONDON });
    expect(dateOf(next)).toBe('2026-09-24');
  });

  /**
   * research.md §2's payoff, and the bank-holiday-week answer: moving THIS
   * instance's due date moves that instance alone, because the rule is expanded
   * from the series anchor.
   */
  it('leaves the series on Thursdays when only this instance’s due date moves', () => {
    const task = head({ due: dateDue('2026-09-17'), rule: THURSDAY_RULE });
    // Pushed to the Saturday, without touching the rule.
    const moved = task.update(
      { due: dateDue('2026-09-19') },
      { now: new Date('2026-09-16T10:00:00Z'), newSeriesId },
    );
    expect(moved.ok).toBe(true);
    expect(task.recurrenceAnchor).toEqual({
      year: 2026,
      month: 9,
      day: 17,
      hour: 0,
      minute: 0,
      second: 0,
    });

    const next = due(successorDueOf(task, new Date('2026-09-19T12:00:00Z')));
    expect(dateOf(next)).toBe('2026-09-24');
  });

  it('re-anchors when the RULE is edited', () => {
    const task = head({ due: dateDue('2026-09-17'), rule: THURSDAY_RULE });
    const edited = task.update(
      { due: dateDue('2026-09-18'), recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR' },
      { now: new Date('2026-09-16T10:00:00Z'), newSeriesId },
    );
    expect(edited.ok).toBe(true);
    expect(task.recurrenceAnchor).toMatchObject({ year: 2026, month: 9, day: 18 });

    const next = due(successorDueOf(task, new Date('2026-09-18T12:00:00Z')));
    expect(dateOf(next)).toBe('2026-09-25');
  });

  describe('no successor', () => {
    it('gives none once COUNT is exhausted', () => {
      const task = head({ due: dateDue('2026-09-17'), rule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=1' });
      expect(due(successorDueOf(task, new Date('2026-09-17T12:00:00Z')))).toBeNull();
    });

    it('counts COUNT from the anchor, so the second close of a COUNT=2 series ends it', () => {
      const task = head({ due: dateDue('2026-09-17'), rule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=2' });
      const second = due(successorDueOf(task, new Date('2026-09-17T12:00:00Z')));
      expect(dateOf(second)).toBe('2026-09-24');

      // The successor, closed in turn, produces nothing further.
      const successor = Task.successorOf({
        id: asTaskId('77777777-7777-7777-8777-777777777777'),
        head: task,
        due: mustDue(second),
        createdByMemberId: ada,
        now: new Date('2026-09-17T12:00:00Z'),
      });
      expect(due(successorDueOf(successor, new Date('2026-09-24T12:00:00Z')))).toBeNull();
    });

    it('gives none once UNTIL has passed', () => {
      const task = head({
        due: dateDue('2026-09-17'),
        rule: 'FREQ=WEEKLY;BYDAY=TH;UNTIL=20260920T000000Z',
      });
      expect(due(successorDueOf(task, new Date('2026-09-17T12:00:00Z')))).toBeNull();
    });

    it('gives none for a task with no rule at all', () => {
      const created = Task.create({
        id: taskId,
        familyId,
        newSeriesId,
        title: 'One-off',
        due: dateDue('2026-09-17'),
        createdByMemberId: ada,
        now: new Date('2026-09-01T10:00:00Z'),
      });
      if (!created.ok) throw new Error('fixture did not create');
      expect(due(successorDueOf(created.value, new Date('2026-09-17T12:00:00Z')))).toBeNull();
    });

    /** FR-019: a reopened former head is not the head, so it can never spawn a second successor. */
    it('gives none for a non-head instance that still carries the rule', () => {
      const task = head({ due: dateDue('2026-09-17'), rule: THURSDAY_RULE });
      task.relinquishHead();
      expect(task.recurrenceRule).not.toBeNull();
      expect(task.isSeriesHead).toBe(false);
      expect(due(successorDueOf(task, new Date('2026-09-17T12:00:00Z')))).toBeNull();
    });
  });

  it('moves the successor’s instant by 7 days plus an hour across the autumn change', () => {
    // 2026-10-22 and 2026-10-29 straddle the 25 October fall back.
    const task = head({ due: timedDue('2026-10-22', '19:00'), rule: THURSDAY_RULE });
    const next = due(successorDueOf(task, new Date('2026-10-22T20:00:00Z')));
    expect(dateOf(next)).toBe('2026-10-29');

    const before = dueMomentOf(mustDue(task.due));
    const after = dueMomentOf(mustDue(next));
    const hours = (after.getTime() - before.getTime()) / 3_600_000;
    // Same wall-clock time, one hour more in UTC: 7 days plus an hour.
    expect(hours).toBe(7 * 24 + 1);
  });
});
