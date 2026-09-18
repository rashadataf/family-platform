import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDatabase } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapTasksApp } from './test-support/bootstrap-tasks-app.js';
import {
  buildHousehold,
  completeTask,
  createTask,
  dateDue,
  dateTimeDue,
  patchTask,
  type CloseBody,
  type Household,
  type TaskBody,
} from './test-support/household.js';

async function lastUpdate(taskId: string) {
  const rows = await withDatabase((tx) =>
    tx.outboxEvent.findMany({ where: { aggregateId: taskId }, orderBy: { occurredAt: 'asc' } }),
  );
  return rows.filter((row) => row.eventType === 'tasks.TaskUpdated.v1').at(-1);
}

describe('PATCH /v1/families/:familyId/tasks/:taskId (US3, FR-010, FR-011)', () => {
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

  const fresh = (overrides: Record<string, unknown> = {}) =>
    createTask(server, home.familyId, home.ada, { title: 'Take the bins out', ...overrides });

  const patch = (taskId: string, body: Record<string, unknown>) =>
    patchTask(server, home.familyId, home.ada, taskId, body);

  it('edits the title, notes, priority and category, bumping the version once', async () => {
    const task = await fresh();
    const response = await patch(task.taskId, {
      expectedVersion: task.version,
      title: 'Take the recycling out',
      notes: 'Green bin this week',
      priority: 'high',
      category: 'household',
    });
    expect(response.status).toBe(200);

    const body = response.body as TaskBody;
    expect(body).toMatchObject({
      title: 'Take the recycling out',
      notes: 'Green bin this week',
      priority: 'high',
      category: 'household',
      version: task.version + 1,
    });
  });

  it('recomputes dueAt when the due date moves', async () => {
    const task = await fresh({ due: dateDue('2026-09-30') });
    expect(task.dueAt).toBe('2026-09-30T23:00:00.000Z');

    const response = await patch(task.taskId, {
      expectedVersion: task.version,
      due: dateTimeDue('2026-12-01', '09:00'),
    });
    expect(response.status).toBe(200);
    expect((response.body as TaskBody).dueAt).toBe('2026-12-01T09:00:00.000Z');
  });

  it('clears the due date with due: null', async () => {
    const task = await fresh({ due: dateDue('2026-09-30') });
    const response = await patch(task.taskId, { expectedVersion: task.version, due: null });
    expect(response.status).toBe(200);
    expect((response.body as TaskBody).due).toBeNull();
    expect((response.body as TaskBody).dueAt).toBeNull();
  });

  it('clears the notes with notes: null', async () => {
    const task = await fresh({ notes: 'Something' });
    const response = await patch(task.taskId, { expectedVersion: task.version, notes: null });
    expect(response.status).toBe(200);
    expect((response.body as TaskBody).notes).toBeNull();
  });

  describe('TaskUpdated.changed names field GROUPS, never values', () => {
    it('reports details for a title change', async () => {
      const task = await fresh();
      await patch(task.taskId, { expectedVersion: task.version, title: 'Renamed' });
      expect((await lastUpdate(task.taskId))?.payload).toMatchObject({ changed: ['details'] });
    });

    it('reports due for a due change', async () => {
      const task = await fresh({ due: dateDue('2026-09-30') });
      await patch(task.taskId, { expectedVersion: task.version, due: dateDue('2026-10-01') });
      expect((await lastUpdate(task.taskId))?.payload).toMatchObject({ changed: ['due'] });
    });

    it('reports both when both move, and carries no title or date', async () => {
      const task = await fresh({ due: dateDue('2026-09-30') });
      await patch(task.taskId, {
        expectedVersion: task.version,
        title: 'Renamed again',
        due: dateDue('2026-10-02'),
      });
      const event = await lastUpdate(task.taskId);
      const changed = (event?.payload as { changed: string[] }).changed;
      expect(changed.sort()).toEqual(['details', 'due']);
      expect(JSON.stringify(event?.payload)).not.toContain('Renamed again');
      expect(JSON.stringify(event?.payload)).not.toContain('2026-10-02');
    });
  });

  it('treats a no-op edit as a no-op: no version bump and no event', async () => {
    const task = await fresh({ title: 'Unchanged' });
    const before = await lastUpdate(task.taskId);

    const response = await patch(task.taskId, {
      expectedVersion: task.version,
      title: 'Unchanged',
    });
    expect(response.status).toBe(200);
    expect((response.body as TaskBody).version).toBe(task.version);
    expect(await lastUpdate(task.taskId)).toEqual(before);
  });

  it('refuses an edit to a completed task with 409 invalid_transition', async () => {
    const task = await fresh({ title: 'Completed then edited' });
    const completed = await completeTask(
      server,
      home.familyId,
      home.ada,
      task.taskId,
      task.version,
    );
    const version = (completed.body as CloseBody).task.version;

    const response = await patch(task.taskId, { expectedVersion: version, title: 'Too late' });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      type: 'task/invalid_transition',
      from: 'completed',
      command: 'edit',
    });
  });

  describe('optimistic concurrency (FR-011)', () => {
    it('refuses a stale expectedVersion with 409 version_conflict', async () => {
      const task = await fresh({ title: 'Versioned' });
      await patch(task.taskId, { expectedVersion: task.version, title: 'First edit' });

      const stale = await patch(task.taskId, {
        expectedVersion: task.version,
        title: 'Second edit',
      });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({
        type: 'task/version_conflict',
        currentVersion: task.version + 1,
      });
    });

    /** It carries the current version and nothing else — no title, no state. */
    it('carries only the current version in the conflict body', async () => {
      const task = await fresh({ title: 'Secret title' });
      await patch(task.taskId, { expectedVersion: task.version, title: 'Moved on' });

      const stale = await patch(task.taskId, { expectedVersion: task.version, title: 'Nope' });
      expect(stale.status).toBe(409);
      expect(Object.keys(stale.body as object).sort()).toEqual(['currentVersion', 'type']);
      expect(JSON.stringify(stale.body)).not.toContain('Secret title');
      expect(JSON.stringify(stale.body)).not.toContain('Moved on');
    });

    it('requires expectedVersion at the contract', async () => {
      const task = await fresh();
      const response = await patch(task.taskId, { title: 'No version' });
      expect(response.status).toBe(400);
    });
  });

  it('refuses a status change through PATCH — transitions have their own routes', async () => {
    const task = await fresh();
    const response = await patch(task.taskId, {
      expectedVersion: task.version,
      status: 'completed',
    });
    expect(response.status).toBe(400);
  });
});
