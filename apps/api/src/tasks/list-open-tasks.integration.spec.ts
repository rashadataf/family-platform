import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeTo, seedDateOnlyTask, withDatabaseCommitted } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapTasksApp, TASKS_TEST_NOW } from './test-support/bootstrap-tasks-app.js';
import {
  buildHousehold,
  createTask,
  dateDue,
  dateTimeDue,
  listOpenTasks,
  required,
  taskRequest,
  type Household,
} from './test-support/household.js';

/**
 * US1's second half: what the family still has outstanding. The clock is pinned
 * at `TASKS_TEST_NOW` (2026-09-16T10:00:00Z — 11:00 BST), which every
 * overdue assertion here is measured against.
 */
describe('GET /v1/families/:familyId/tasks (US1, FR-005, FR-025)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let home: Household;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTasksApp());
    home = await buildHousehold(server, mailer);
  });

  afterAll(async () => {
    await app.close();
  });

  const list = (query: Record<string, string | number> = {}) =>
    listOpenTasks(server, home.familyId, home.ada, query);

  it('orders by due moment ascending and puts undated tasks last', async () => {
    const later = await createTask(server, home.familyId, home.ada, {
      title: 'Later',
      due: dateDue('2026-10-05'),
    });
    const undated = await createTask(server, home.familyId, home.ada, { title: 'Undated' });
    const sooner = await createTask(server, home.familyId, home.ada, {
      title: 'Sooner',
      due: dateDue('2026-09-20'),
    });

    const { status, body } = await list();
    expect(status).toBe(200);

    const ids = body.items.map((t) => t.taskId);
    expect(ids.indexOf(sooner.taskId)).toBeLessThan(ids.indexOf(later.taskId));
    expect(ids.indexOf(later.taskId)).toBeLessThan(ids.indexOf(undated.taskId));
    // An undated task sorts last, not first, however early it was written down.
    expect(body.items.at(-1)?.taskId).toBe(undated.taskId);
  });

  /** FR-014: a count is a cheap inference channel for a task the reader cannot see. */
  it('returns no total count anywhere in the body', async () => {
    const { body } = await list();
    expect(Object.keys(body).sort()).toEqual(['items', 'nextCursor']);
    expect(JSON.stringify(body)).not.toMatch(/"total"|"count"/);
  });

  it('pages by keyset cursor, without repeating or skipping a task', async () => {
    const first = await list({ limit: 2 });
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).not.toBeNull();

    const second = await list({
      limit: 2,
      cursor: required(first.body.nextCursor, 'a next cursor'),
    });
    expect(second.status).toBe(200);

    const firstIds = first.body.items.map((t) => t.taskId);
    const secondIds = second.body.items.map((t) => t.taskId);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);

    const all = await list({ limit: 200 });
    expect(all.body.items.map((t) => t.taskId).slice(0, 4)).toEqual([...firstIds, ...secondIds]);
  });

  it('closes the last page with a null cursor', async () => {
    const all = await list({ limit: 200 });
    expect(all.body.nextCursor).toBeNull();
  });

  it('refuses a cursor it did not issue rather than guessing', async () => {
    const { status } = await list({ limit: 2, cursor: 'not-a-cursor' });
    expect(status).toBe(400);
  });

  describe('the dueFrom/dueTo window', () => {
    it('is half-open, including the lower bound and excluding the upper', async () => {
      const onBoundary = await createTask(server, home.familyId, home.ada, {
        title: 'On the boundary',
        due: dateTimeDue('2026-11-02', '09:00'),
      });
      const dueAt = required(onBoundary.dueAt, 'a due moment');

      const included = await list({ dueFrom: dueAt, dueTo: '2026-11-30T00:00:00Z' });
      expect(included.body.items.map((t) => t.taskId)).toContain(onBoundary.taskId);

      const excluded = await list({ dueFrom: '2026-11-01T00:00:00Z', dueTo: dueAt });
      expect(excluded.body.items.map((t) => t.taskId)).not.toContain(onBoundary.taskId);
    });

    it('excludes undated tasks entirely once either bound is given', async () => {
      const undated = await createTask(server, home.familyId, home.ada, {
        title: 'Undated, windowed out',
      });
      const { body } = await list({
        dueFrom: '2020-01-01T00:00:00Z',
        dueTo: '2021-01-01T00:00:00Z',
      });
      expect(body.items.map((t) => t.taskId)).not.toContain(undated.taskId);
    });

    it('refuses a window wider than 400 days with 422 task/range_too_wide', async () => {
      const response = await listOpenTasks(server, home.familyId, home.ada, {
        dueFrom: '2026-01-01T00:00:00Z',
        dueTo: '2027-06-01T00:00:00Z',
      });
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ type: 'task/range_too_wide', maxDays: 400 });
    });

    it('refuses a window that ends before it starts', async () => {
      const response = await listOpenTasks(server, home.familyId, home.ada, {
        dueFrom: '2026-10-01T00:00:00Z',
        dueTo: '2026-09-01T00:00:00Z',
      });
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ type: 'task/invalid_range' });
    });
  });

  describe('overdue (FR-025)', () => {
    /**
     * The assertion that pins FR-025: overdue is read from the clock on the way
     * out, not from a column a sweep writes. No sweep runs in this suite at all.
     */
    it('marks a task due one minute ago as overdue without any sweep having run', async () => {
      // 10:59 BST is 09:59Z — one minute before the pinned clock.
      const justLate = await createTask(server, home.familyId, home.ada, {
        title: 'One minute late',
        due: dateTimeDue('2026-09-16', '10:59'),
      });
      expect(justLate.dueAt).toBe('2026-09-16T09:59:00.000Z');
      expect(justLate.isOverdue).toBe(true);

      const { body } = await list({ limit: 200 });
      const found = body.items.find((t) => t.taskId === justLate.taskId);
      expect(found?.isOverdue).toBe(true);
    });

    it('does not mark a task due one minute from now as overdue', async () => {
      const notYet = await createTask(server, home.familyId, home.ada, {
        title: 'One minute early',
        due: dateTimeDue('2026-09-16', '11:01'),
      });
      expect(notYet.dueAt).toBe('2026-09-16T10:01:00.000Z');
      expect(notYet.isOverdue).toBe(false);
    });

    it('returns only overdue tasks when asked, and never an undated one', async () => {
      const { status, body } = await list({ overdue: 'true', limit: 200 });
      expect(status).toBe(200);
      expect(body.items.length).toBeGreaterThan(0);
      for (const task of body.items) {
        expect(task.isOverdue, task.taskId).toBe(true);
        expect(task.dueAt, task.taskId).not.toBeNull();
      }
    });
  });

  it('never returns a completed or cancelled task, even one written straight to the table', async () => {
    const closed = await withDatabaseCommitted(async (tx) => {
      await scopeTo(tx, home.familyId);
      const completed = await seedDateOnlyTask(tx, {
        familyId: home.familyId,
        title: 'Already done',
        date: '2026-09-10',
        dueAt: new Date('2026-09-10T23:00:00Z'),
        status: 'completed',
        closedAt: new Date(TASKS_TEST_NOW),
        closedByMemberId: home.ada.memberId,
      });
      const cancelled = await seedDateOnlyTask(tx, {
        familyId: home.familyId,
        title: 'Called off',
        date: '2026-09-11',
        dueAt: new Date('2026-09-11T23:00:00Z'),
        status: 'cancelled',
        closedAt: new Date(TASKS_TEST_NOW),
        closedByMemberId: home.ada.memberId,
      });
      return [completed.taskId, cancelled.taskId];
    });

    const { body } = await list({ limit: 200 });
    const ids = body.items.map((t) => t.taskId);
    for (const taskId of closed) expect(ids).not.toContain(taskId);
  });

  it('shows a family only its own tasks', async () => {
    const mine = await createTask(server, home.familyId, home.ada, taskRequest({ title: 'Ours' }));
    const theirs = await createTask(server, home.outsiderFamilyId, home.outsider, {
      title: 'Theirs',
    });

    const ours = await list({ limit: 200 });
    expect(ours.body.items.map((t) => t.taskId)).toContain(mine.taskId);
    expect(ours.body.items.map((t) => t.taskId)).not.toContain(theirs.taskId);
  });
});
