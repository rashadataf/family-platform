import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDatabase } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import {
  bootstrapTasksApp,
  TASKS_TEST_NOW,
  type FixedClock,
} from './test-support/bootstrap-tasks-app.js';
import {
  buildHousehold,
  cancelTask,
  completeTask,
  createTask,
  dateDue,
  listOpenTasks,
  listTaskHistory,
  reopenTask,
  type CloseBody,
  type Household,
  type TaskBody,
} from './test-support/household.js';

async function eventsFor(taskId: string) {
  // Ordered by when they happened: `id` is a random UUID, so it says nothing
  // about sequence. Rows written in one transaction share `occurred_at`, which
  // is exactly the granularity these assertions need.
  const rows = await withDatabase((tx) =>
    tx.outboxEvent.findMany({ where: { aggregateId: taskId }, orderBy: { occurredAt: 'asc' } }),
  );
  return rows.map((row) => ({ type: row.eventType, payload: row.payload }));
}

/** The pinned clock as the wire serialises it. */
const NOW_ISO = new Date(TASKS_TEST_NOW).toISOString();

/** A window comfortably around the pinned clock, within the 400-day cap. */
const HISTORY_RANGE = { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' };

describe('the task lifecycle (US3, FR-008, FR-009)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let home: Household;
  let clock: FixedClock;

  beforeAll(async () => {
    ({ app, server, mailer, clock } = await bootstrapTasksApp());
    home = await buildHousehold(server, mailer);
  });

  afterAll(async () => {
    await app.close();
  });

  const fresh = (overrides: Record<string, unknown> = {}) =>
    createTask(server, home.familyId, home.ada, { title: 'Take the bins out', ...overrides });

  describe('completing', () => {
    it('removes the task from the open list and publishes TaskCompleted', async () => {
      const task = await fresh({ title: 'Complete me' });
      const response = await completeTask(
        server,
        home.familyId,
        home.ada,
        task.taskId,
        task.version,
      );
      expect(response.status).toBe(200);

      const body = response.body as CloseBody;
      expect(body.task.status).toBe('completed');
      expect(body.task.completedAt).toBe(NOW_ISO);
      expect(body.task.completedByMemberId).toBe(home.ada.memberId);
      expect(body.task.cancelledAt).toBeNull();
      expect(body.successor).toBeNull();

      const open = await listOpenTasks(server, home.familyId, home.ada, { limit: 200 });
      expect(open.body.items.map((t) => t.taskId)).not.toContain(task.taskId);

      const events = await eventsFor(task.taskId);
      expect(events.map((e) => e.type)).toEqual(['tasks.TaskCreated.v1', 'tasks.TaskCompleted.v1']);
      expect(events[1]?.payload).toMatchObject({ completedByMemberId: home.ada.memberId });
    });

    /** FR-009: the actor is whoever ticked it off, not whoever it was assigned to. */
    it('records the guardian who completed a child’s task, not the child', async () => {
      const task = await fresh({ title: 'Charlie: homework', assigneeIds: [home.charlieId] });
      const response = await completeTask(
        server,
        home.familyId,
        home.ada,
        task.taskId,
        task.version,
      );
      expect(response.status).toBe(200);
      expect((response.body as CloseBody).task.completedByMemberId).toBe(home.ada.memberId);
    });
  });

  describe('reopening', () => {
    it('clears the completion fields and publishes TaskUpdated{status}', async () => {
      const task = await fresh({ title: 'Reopen me' });
      const completed = await completeTask(
        server,
        home.familyId,
        home.ada,
        task.taskId,
        task.version,
      );
      const afterComplete = (completed.body as CloseBody).task;

      const response = await reopenTask(
        server,
        home.familyId,
        home.ada,
        task.taskId,
        afterComplete.version,
      );
      expect(response.status).toBe(200);

      const body = response.body as TaskBody;
      expect(body.status).toBe('open');
      expect(body.completedAt).toBeNull();
      expect(body.completedByMemberId).toBeNull();

      const open = await listOpenTasks(server, home.familyId, home.ada, { limit: 200 });
      expect(open.body.items.map((t) => t.taskId)).toContain(task.taskId);

      const events = await eventsFor(task.taskId);
      expect(events.at(-1)?.type).toBe('tasks.TaskUpdated.v1');
      expect(events.at(-1)?.payload).toMatchObject({ changed: ['status'] });
    });
  });

  describe('cancelling', () => {
    it('publishes TaskCancelled carrying the scope, and records the actor', async () => {
      const task = await fresh({ title: 'Cancel me' });
      const response = await cancelTask(
        server,
        home.familyId,
        home.grace,
        task.taskId,
        task.version,
      );
      expect(response.status).toBe(200);

      const body = response.body as CloseBody;
      expect(body.task.status).toBe('cancelled');
      expect(body.task.cancelledByMemberId).toBe(home.grace.memberId);
      expect(body.task.cancelledAt).toBe(NOW_ISO);
      expect(body.task.completedAt).toBeNull();

      const events = await eventsFor(task.taskId);
      expect(events.at(-1)?.type).toBe('tasks.TaskCancelled.v1');
      expect(events.at(-1)?.payload).toMatchObject({ scope: 'instance' });
    });

    /** Cancellation is terminal: there is no way back, by either route. */
    it('refuses both reopen and complete on a cancelled task with 409 invalid_transition', async () => {
      const task = await fresh({ title: 'Terminal' });
      const cancelled = await cancelTask(
        server,
        home.familyId,
        home.ada,
        task.taskId,
        task.version,
      );
      const version = (cancelled.body as CloseBody).task.version;

      const reopened = await reopenTask(server, home.familyId, home.ada, task.taskId, version);
      expect(reopened.status).toBe(409);
      expect(reopened.body).toMatchObject({
        type: 'task/invalid_transition',
        from: 'cancelled',
        command: 'reopen',
      });

      const completed = await completeTask(server, home.familyId, home.ada, task.taskId, version);
      expect(completed.status).toBe(409);
      expect(completed.body).toMatchObject({
        type: 'task/invalid_transition',
        from: 'cancelled',
        command: 'complete',
      });
    });

    it('refuses reopening a task that was never completed', async () => {
      const task = await fresh({ title: 'Never completed' });
      const response = await reopenTask(server, home.familyId, home.ada, task.taskId, task.version);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ from: 'open', command: 'reopen' });
    });
  });

  describe('GET …/tasks/history', () => {
    it('returns closed tasks newest first, with their actors', async () => {
      // The clock is pinned for the whole suite, so two closures would otherwise
      // share a `closed_at` to the millisecond and the ordering under test would
      // fall back to the tiebreaker. Move it between them.
      const first = await fresh({ title: 'Closed first' });
      await completeTask(server, home.familyId, home.ada, first.taskId, first.version);

      clock.set('2026-09-17T10:00:00Z');
      const second = await fresh({ title: 'Closed second' });
      await cancelTask(server, home.familyId, home.grace, second.taskId, second.version);
      clock.set(TASKS_TEST_NOW);

      const { status, body } = await listTaskHistory(
        server,
        home.familyId,
        home.ada,
        HISTORY_RANGE,
      );
      expect(status).toBe(200);

      const ids = body.items.map((t) => t.taskId);
      expect(ids).toContain(first.taskId);
      expect(ids).toContain(second.taskId);
      // Newest closure first.
      expect(ids.indexOf(second.taskId)).toBeLessThan(ids.indexOf(first.taskId));

      for (const item of body.items) {
        expect(item.status).not.toBe('open');
      }
    });

    it('never includes an open task', async () => {
      const open = await fresh({ title: 'Still open', due: dateDue('2026-09-20') });
      const { body } = await listTaskHistory(server, home.familyId, home.ada, HISTORY_RANGE);
      expect(body.items.map((t) => t.taskId)).not.toContain(open.taskId);
    });

    it('refuses a window wider than 400 days', async () => {
      const { status, body } = await listTaskHistory(server, home.familyId, home.ada, {
        from: '2025-01-01T00:00:00Z',
        to: '2026-10-01T00:00:00Z',
      });
      expect(status).toBe(422);
      expect(body).toMatchObject({ type: 'task/range_too_wide', maxDays: 400 });
    });

    it('applies the same guardian filter as the open list', async () => {
      const childTask = await createTask(server, home.familyId, home.ada, {
        title: 'Charlie: closed chore',
        assigneeIds: [home.charlieId],
      });
      await completeTask(server, home.familyId, home.ada, childTask.taskId, childTask.version);

      const guardian = await listTaskHistory(server, home.familyId, home.ada, HISTORY_RANGE);
      expect(guardian.body.items.map((t) => t.taskId)).toContain(childTask.taskId);

      const nonGuardian = await listTaskHistory(server, home.familyId, home.grace, HISTORY_RANGE);
      expect(nonGuardian.body.items.map((t) => t.taskId)).not.toContain(childTask.taskId);
    });
  });
});
