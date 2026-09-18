import {
  asFamilyId,
  asFamilyMemberId,
  asTaskId,
  asTaskSeriesId,
  type FamilyMemberId,
} from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { parseDue, type Due } from './due.js';
import { isOverdue, needsOverdueReport } from './overdue.js';
import { Task } from './task.aggregate.js';

const familyId = asFamilyId('11111111-1111-7111-8111-111111111111');
const taskId = asTaskId('22222222-2222-7222-8222-222222222222');
const newSeriesId = asTaskSeriesId('33333333-3333-7333-8333-333333333333');
const ada: FamilyMemberId = asFamilyMemberId('44444444-4444-7444-8444-444444444444');

/** 2026-09-16 in London: due at the start of the 17th, which is 23:00Z on the 16th. */
const DUE_AT = new Date('2026-09-16T23:00:00Z');
const BEFORE = new Date('2026-09-16T22:30:00Z');
const AFTER = new Date('2026-09-16T23:30:00Z');

function dateDue(date: string): Due {
  const parsed = parseDue({ kind: 'date', date, timeZone: 'Europe/London' });
  if (!parsed.ok) throw new Error('fixture did not parse');
  return parsed.value;
}

function task(options: { due?: Due | null } = {}): Task {
  const created = Task.create({
    id: taskId,
    familyId,
    newSeriesId,
    title: 'Take the bins out',
    due: options.due === undefined ? dateDue('2026-09-16') : options.due,
    createdByMemberId: ada,
    now: new Date('2026-09-01T10:00:00Z'),
  });
  if (!created.ok) throw new Error('fixture did not create');
  return created.value;
}

describe('isOverdue (FR-025)', () => {
  it('is false before the due moment and true at or after it', () => {
    const subject = task();
    expect(subject.dueAt?.toISOString()).toBe(DUE_AT.toISOString());
    expect(isOverdue(subject, BEFORE)).toBe(false);
    expect(isOverdue(subject, DUE_AT)).toBe(true);
    expect(isOverdue(subject, AFTER)).toBe(true);
  });

  it('is false for an undated task at any clock', () => {
    expect(isOverdue(task({ due: null }), new Date('2099-01-01T00:00:00Z'))).toBe(false);
  });

  it('is false once the task is closed, however late', () => {
    const completed = task();
    completed.complete(ada, AFTER);
    expect(isOverdue(completed, AFTER)).toBe(false);

    const cancelled = task();
    cancelled.cancel(ada, AFTER);
    expect(isOverdue(cancelled, AFTER)).toBe(false);
  });
});

/**
 * FR-027, research.md §5. This predicate IS the sweep's contract: it must match
 * `task_overdue_unreported_idx` exactly, so the index and the re-check under
 * the row lock can never disagree.
 */
describe('needsOverdueReport (FR-027)', () => {
  it('is true for an open task whose due moment has passed and was never reported', () => {
    expect(needsOverdueReport(task(), AFTER)).toBe(true);
  });

  it('is false before the due moment', () => {
    expect(needsOverdueReport(task(), BEFORE)).toBe(false);
  });

  it('is true exactly at the due moment', () => {
    expect(needsOverdueReport(task(), DUE_AT)).toBe(true);
  });

  it('is false once the marker equals the due moment — reported once per due moment', () => {
    const subject = task();
    subject.recordOverdueReported();
    expect(subject.overdueReportedFor?.toISOString()).toBe(DUE_AT.toISOString());
    expect(needsOverdueReport(subject, AFTER)).toBe(false);
  });

  /** Re-dating re-arms it: the marker and the new due moment are distinct again. */
  it('is true again after the due date moves, even though it was reported once', () => {
    const subject = task();
    subject.recordOverdueReported();
    expect(needsOverdueReport(subject, AFTER)).toBe(false);

    const moved = subject.update({ due: dateDue('2026-09-18') }, { now: AFTER, newSeriesId });
    expect(moved.ok).toBe(true);
    // Not yet due at AFTER…
    expect(needsOverdueReport(subject, AFTER)).toBe(false);
    // …but due, and unreported, once the new moment passes.
    expect(needsOverdueReport(subject, new Date('2026-09-19T00:00:00Z'))).toBe(true);
  });

  it('is false for a task completed before its due moment', () => {
    const subject = task();
    subject.complete(ada, BEFORE);
    expect(needsOverdueReport(subject, AFTER)).toBe(false);
  });

  it('is false for a task cancelled before its due moment', () => {
    const subject = task();
    subject.cancel(ada, BEFORE);
    expect(needsOverdueReport(subject, AFTER)).toBe(false);
  });

  it('is false for an undated task', () => {
    expect(needsOverdueReport(task({ due: null }), new Date('2099-01-01T00:00:00Z'))).toBe(false);
  });

  /** The marker is not a member's change, so it must not consume the version. */
  it('does not bump the version when the marker is recorded', () => {
    const subject = task();
    const before = subject.version;
    subject.recordOverdueReported();
    expect(subject.version).toBe(before);
  });
});
