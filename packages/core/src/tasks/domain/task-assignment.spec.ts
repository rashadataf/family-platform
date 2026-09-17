import {
  asFamilyId,
  asFamilyMemberId,
  asTaskId,
  asTaskSeriesId,
  type DomainError,
  type Result,
} from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import type { TaskAssignment } from './task-assignment.js';
import { Task } from './task.aggregate.js';

const familyId = asFamilyId('11111111-1111-7111-8111-111111111111');
const taskId = asTaskId('22222222-2222-7222-8222-222222222222');
const newSeriesId = asTaskSeriesId('33333333-3333-7333-8333-333333333333');
const ada = asFamilyMemberId('44444444-4444-7444-8444-444444444444');
const charlie = asFamilyMemberId('55555555-5555-7555-8555-555555555555');
const NOW = new Date('2026-09-16T10:00:00Z');
const LATER = new Date('2026-09-16T11:00:00Z');

function newTask(assignees: readonly ReturnType<typeof asFamilyMemberId>[] = []): Task {
  const created = Task.create({
    id: taskId,
    familyId,
    newSeriesId,
    title: 'Take the bins out',
    assignees,
    createdByMemberId: ada,
    now: NOW,
  });
  if (!created.ok) throw new Error('fixture did not create');
  return created.value;
}

function changed(result: Result<boolean, DomainError>): boolean {
  if (!result.ok) throw new Error(`expected a change flag, got ${result.error.kind}`);
  return result.value;
}

describe('task assignments (US2, FR-013, FR-016)', () => {
  /**
   * The shape is the point. An assignment holds a member id and when it was
   * made — no `kind`, no date of birth, no guardian. Whether a task concerns a
   * child is answered at READ time by asking Family, so revoking a guardianship
   * changes the very next read with no cached classification to go stale
   * (research.md §1, §7).
   */
  it('holds a member id and a time, and nothing else about the person', () => {
    const assignment: TaskAssignment = { memberId: charlie, assignedAt: NOW };
    expect(Object.keys(assignment).sort()).toEqual(['assignedAt', 'memberId']);
  });

  it('is assignable at creation, preserving the order given', () => {
    expect(newTask([ada, charlie]).assignees).toEqual([ada, charlie]);
  });

  describe('assigning', () => {
    it('adds a member and reports that something changed', () => {
      const task = newTask();
      expect(changed(task.assign(charlie, LATER))).toBe(true);
      expect(task.assignees).toEqual([charlie]);
    });

    /** Idempotent by construction: re-assigning is a no-op, not an error. */
    it('reports no change when the member is already an assignee, and does not fail', () => {
      const task = newTask([charlie]);
      const result = task.assign(charlie, LATER);
      expect(result.ok).toBe(true);
      expect(changed(result)).toBe(false);
      expect(task.assignees).toEqual([charlie]);
    });

    it('does not bump the version on a no-op re-assignment', () => {
      const task = newTask([charlie]);
      const before = task.version;
      task.assign(charlie, LATER);
      expect(task.version).toBe(before);
      expect(task.updatedAt).toEqual(NOW);
    });

    it('bumps the version and the timestamp on a real assignment', () => {
      const task = newTask();
      const before = task.version;
      task.assign(charlie, LATER);
      expect(task.version).toBe(before + 1);
      expect(task.updatedAt).toEqual(LATER);
    });

    it('treats a child assignee exactly as any other member', () => {
      const task = newTask();
      // The aggregate cannot tell a child from an adult, by design.
      expect(changed(task.assign(charlie, LATER))).toBe(true);
      expect(task.assignees).toContain(charlie);
    });
  });

  describe('unassigning', () => {
    it('removes a member and reports that something changed', () => {
      const task = newTask([ada, charlie]);
      expect(changed(task.unassign(ada, LATER))).toBe(true);
      expect(task.assignees).toEqual([charlie]);
    });

    it('reports no change when the member was never assigned, and does not fail', () => {
      const task = newTask([ada]);
      const result = task.unassign(charlie, LATER);
      expect(result.ok).toBe(true);
      expect(changed(result)).toBe(false);
      expect(task.assignees).toEqual([ada]);
    });

    /** FR-013: the task survives losing its last assignee; it does not close itself. */
    it('leaves the task open and intact when the last assignee goes', () => {
      const task = newTask([ada]);
      task.unassign(ada, LATER);
      expect(task.assignees).toEqual([]);
      expect(task.status).toBe('open');
    });
  });

  describe('on a closed task', () => {
    it('refuses both assign and unassign with InvalidTransition naming the command', () => {
      for (const command of ['assign', 'unassign'] as const) {
        const task = newTask([ada]);
        task.complete(ada, LATER);

        const result =
          command === 'assign' ? task.assign(charlie, LATER) : task.unassign(ada, LATER);
        expect(result.ok, command).toBe(false);
        if (result.ok) continue;
        expect(result.error, command).toMatchObject({
          kind: 'InvalidTransition',
          from: 'completed',
          command,
        });
      }
    });
  });
});
