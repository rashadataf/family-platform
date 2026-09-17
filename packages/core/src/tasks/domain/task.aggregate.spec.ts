import {
  asFamilyId,
  asFamilyMemberId,
  asTaskId,
  asTaskSeriesId,
  type DomainError,
  type Result,
} from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { parseDue, type Due } from './due.js';
import { NOTES_MAX, Task, TITLE_MAX } from './task.aggregate.js';

const familyId = asFamilyId('11111111-1111-7111-8111-111111111111');
const taskId = asTaskId('22222222-2222-7222-8222-222222222222');
const newSeriesId = asTaskSeriesId('33333333-3333-7333-8333-333333333333');
const ada = asFamilyMemberId('44444444-4444-7444-8444-444444444444');
const charlie = asFamilyMemberId('55555555-5555-7555-8555-555555555555');
const NOW = new Date('2026-09-16T10:00:00Z');
const LATER = new Date('2026-09-16T11:00:00Z');

function dueOn(date: string): Due {
  const parsed = parseDue({ kind: 'date', date, timeZone: 'Europe/London' });
  if (!parsed.ok) throw new Error('fixture did not parse');
  return parsed.value;
}

function create(overrides: Partial<Parameters<typeof Task.create>[0]> = {}) {
  return Task.create({
    id: taskId,
    familyId,
    newSeriesId,
    title: 'Take the bins out',
    createdByMemberId: ada,
    now: NOW,
    ...overrides,
  });
}

function value(result: Result<Task, DomainError>): Task {
  if (!result.ok) throw new Error(`expected a task, got ${result.error.kind}`);
  return result.value;
}

describe('Task creation (US1, FR-001, FR-004)', () => {
  it('starts open, at version 1, stamped with the clock it was given', () => {
    const task = value(create());
    expect(task.status).toBe('open');
    expect(task.isOpen).toBe(true);
    expect(task.version).toBe(1);
    expect(task.createdAt).toEqual(NOW);
    expect(task.updatedAt).toEqual(NOW);
    expect(task.state).toEqual({ status: 'open' });
  });

  it('defaults priority to normal, and everything optional to null or empty', () => {
    const task = value(create());
    expect(task.priority).toBe('normal');
    expect(task.category).toBeNull();
    expect(task.notes).toBeNull();
    expect(task.due).toBeNull();
    expect(task.dueAt).toBeNull();
    expect(task.assignees).toEqual([]);
    expect(task.recurrenceRule).toBeNull();
    expect(task.seriesId).toBeNull();
    expect(task.isSeriesHead).toBe(false);
    expect(task.predecessorId).toBeNull();
    expect(task.overdueReportedFor).toBeNull();
  });

  it('keeps each priority and category it is given', () => {
    expect(value(create({ priority: 'high' })).priority).toBe('high');
    expect(value(create({ priority: 'low' })).priority).toBe('low');
    expect(value(create({ category: 'school' })).category).toBe('school');
  });

  describe('title', () => {
    it('accepts 1 through 200 characters', () => {
      expect(value(create({ title: 'x' })).title).toBe('x');
      expect(value(create({ title: 'x'.repeat(TITLE_MAX) })).title).toHaveLength(TITLE_MAX);
    });

    it('trims, and judges the length after trimming', () => {
      expect(value(create({ title: '  Take the bins out  ' })).title).toBe('Take the bins out');
      expect(create({ title: ` ${'x'.repeat(TITLE_MAX)} ` }).ok).toBe(true);
    });

    it('refuses a blank or whitespace-only title', () => {
      for (const title of ['', '   ', '\t\n']) {
        expect(create({ title }).ok, JSON.stringify(title)).toBe(false);
      }
    });

    it('refuses one character over the limit', () => {
      expect(create({ title: 'x'.repeat(TITLE_MAX + 1) }).ok).toBe(false);
    });
  });

  describe('notes', () => {
    it('accepts up to 4,000 characters and refuses one more', () => {
      expect(value(create({ notes: 'x'.repeat(NOTES_MAX) })).notes).toHaveLength(NOTES_MAX);
      expect(create({ notes: 'x'.repeat(NOTES_MAX + 1) }).ok).toBe(false);
    });

    it('treats an absent, null and empty note alike, as no note', () => {
      expect(value(create()).notes).toBeNull();
      expect(value(create({ notes: null })).notes).toBeNull();
      expect(value(create({ notes: '   ' })).notes).toBeNull();
    });
  });

  describe('due', () => {
    /**
     * "No due date" is the absence of a `Due`, not a third arm — so an undated
     * task cannot be holding a zone, in the domain any more than in the column
     * shape `task_due_shape` enforces.
     */
    it('leaves an undated task with no zone at all', () => {
      const task = value(create());
      expect(task.due).toBeNull();
      expect(task.dueAt).toBeNull();
    });

    it('derives the due moment from the due, not from the clock', () => {
      const task = value(create({ due: dueOn('2026-09-30') }));
      expect(task.due).toMatchObject({ kind: 'date', timeZone: 'Europe/London' });
      expect(task.dueAt?.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    });

    it('is not overdue before its due moment, and is after it', () => {
      const task = value(create({ due: dueOn('2026-09-30') }));
      expect(task.isOverdue(new Date('2026-09-30T22:59:00Z'))).toBe(false);
      expect(task.isOverdue(new Date('2026-09-30T23:00:00Z'))).toBe(true);
    });

    it('is never overdue when it has no due date, however late the clock', () => {
      expect(value(create()).isOverdue(new Date('2099-01-01T00:00:00Z'))).toBe(false);
    });
  });

  describe('assignees', () => {
    it('keeps member ids and nothing else about a person', () => {
      const task = value(create({ assignees: [ada, charlie] }));
      expect(task.assignees).toEqual([ada, charlie]);
    });

    it('de-duplicates a member named twice', () => {
      expect(value(create({ assignees: [ada, ada] })).assignees).toEqual([ada]);
    });
  });

  describe('recurrence at creation', () => {
    it('allocates the series and makes the task its head when a rule is given with a due', () => {
      const task = value(create({ due: dueOn('2026-09-30'), recurrenceRule: 'FREQ=WEEKLY' }));
      expect(task.recurrenceRule?.toString()).toContain('FREQ=WEEKLY');
      expect(task.seriesId).toBe(newSeriesId);
      expect(task.isSeriesHead).toBe(true);
      // Anchored on the due's LOCAL reading, which is what stops COUNT restarting.
      expect(task.recurrenceAnchor).toEqual({
        year: 2026,
        month: 9,
        day: 30,
        hour: 0,
        minute: 0,
        second: 0,
      });
    });

    it('refuses a rule on a task with no due date', () => {
      const result = create({ recurrenceRule: 'FREQ=WEEKLY' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('RecurrenceRequiresDue');
    });

    it('allocates no series to a non-recurring task', () => {
      const task = value(create({ due: dueOn('2026-09-30') }));
      expect(task.seriesId).toBeNull();
      expect(task.isSeriesHead).toBe(false);
      expect(task.recurrenceAnchor).toBeNull();
    });
  });

  it('records who created it, and tolerates nobody (an erased member)', () => {
    expect(value(create()).createdByMemberId).toBe(ada);
    expect(value(create({ createdByMemberId: null })).createdByMemberId).toBeNull();
  });
});

describe('the lifecycle (US3, FR-008, data-model.md)', () => {
  type Command = 'edit' | 'complete' | 'reopen' | 'cancel' | 'assign' | 'unassign';

  function inState(status: 'open' | 'completed' | 'cancelled'): Task {
    const task = value(create({ assignees: [ada] }));
    if (status === 'completed') task.complete(ada, LATER);
    if (status === 'cancelled') task.cancel(ada, LATER);
    return task;
  }

  function apply(task: Task, command: Command): Result<unknown, DomainError> {
    switch (command) {
      case 'edit':
        return task.update({ title: 'Edited' }, { now: LATER, newSeriesId });
      case 'complete':
        return task.complete(ada, LATER);
      case 'reopen':
        return task.reopen(LATER);
      case 'cancel':
        return task.cancel(ada, LATER);
      case 'assign':
        return task.assign(charlie, LATER);
      case 'unassign':
        return task.unassign(ada, LATER);
    }
  }

  /**
   * Every status × every command, against data-model.md's table. Written out in
   * full rather than derived, so that widening the domain — a new command, or a
   * status that starts accepting one — has to be stated here deliberately.
   */
  const TABLE: Record<'open' | 'completed' | 'cancelled', Record<Command, boolean>> = {
    open: { edit: true, complete: true, reopen: false, cancel: true, assign: true, unassign: true },
    completed: {
      edit: false,
      complete: false,
      reopen: true,
      cancel: false,
      assign: false,
      unassign: false,
    },
    // Terminal: nothing at all is accepted.
    cancelled: {
      edit: false,
      complete: false,
      reopen: false,
      cancel: false,
      assign: false,
      unassign: false,
    },
  };

  for (const [status, commands] of Object.entries(TABLE)) {
    for (const [command, allowed] of Object.entries(commands)) {
      it(`${allowed ? 'accepts' : 'refuses'} ${command} on a ${status} task`, () => {
        const from = status as 'open' | 'completed' | 'cancelled';
        const result = apply(inState(from), command as Command);
        expect(result.ok).toBe(allowed);
        if (result.ok) return;
        expect(result.error).toMatchObject({ kind: 'InvalidTransition', from, command });
      });
    }
  }

  it('carries both the status it refused from and the command attempted', () => {
    const result = inState('cancelled').complete(ada, LATER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: 'InvalidTransition',
      from: 'cancelled',
      command: 'complete',
    });
  });

  it('records who completed it and when', () => {
    const task = inState('open');
    task.complete(charlie, LATER);
    expect(task.state).toEqual({ status: 'completed', at: LATER, by: charlie });
    expect(task.status).toBe('completed');
    expect(task.isOpen).toBe(false);
  });

  it('records who cancelled it and when', () => {
    const task = inState('open');
    task.cancel(charlie, LATER);
    expect(task.state).toEqual({ status: 'cancelled', at: LATER, by: charlie });
  });

  it('clears the completion entirely on reopen', () => {
    const task = inState('completed');
    task.reopen(LATER);
    expect(task.state).toEqual({ status: 'open' });
  });

  it('increments the version on every accepted change', () => {
    const task = inState('open');
    const start = task.version;
    task.complete(ada, LATER);
    expect(task.version).toBe(start + 1);
    task.reopen(LATER);
    expect(task.version).toBe(start + 2);
    task.cancel(ada, LATER);
    expect(task.version).toBe(start + 3);
  });

  it('leaves the version untouched when a transition is refused', () => {
    const task = inState('cancelled');
    const before = task.version;
    task.complete(ada, LATER);
    task.reopen(LATER);
    expect(task.version).toBe(before);
  });

  /** FR-027: the sweep's marker is not a member's change, so it must not bump the version. */
  it('does not bump the version when the overdue marker is recorded', () => {
    const task = inState('open');
    const before = task.version;
    task.recordOverdueReported();
    expect(task.version).toBe(before);
  });
});
