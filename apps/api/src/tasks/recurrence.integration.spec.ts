import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapTasksApp, type FixedClock } from './test-support/bootstrap-tasks-app.js';
import {
  buildHousehold,
  cancelTask,
  completeTask,
  createTask,
  dateDue,
  dateTimeDue,
  patchTask,
  reopenTask,
  required,
  type CloseBody,
  type Household,
  type TaskBody,
} from './test-support/household.js';

/** 2026-10-22 and 2026-10-29 are Thursdays, straddling the 25 October fall back. */
const THURSDAY = 'FREQ=WEEKLY;BYDAY=TH';

describe('recurring chores (US4, FR-019–FR-023)', () => {
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

  const recurring = (overrides: Record<string, unknown> = {}) =>
    createTask(server, home.familyId, home.ada, {
      title: 'Take the bins out',
      due: dateDue('2026-09-17'),
      recurrenceRule: THURSDAY,
      ...overrides,
    });

  it('creates a head with a new series id and the rule attached', async () => {
    const task = await recurring();
    expect(task.recurrenceRule).toContain('FREQ=WEEKLY');
    expect(task.seriesId).not.toBeNull();
    expect(task.isSeriesHead).toBe(true);
    expect(task.predecessorId).toBeNull();
  });

  it('spawns the successor on completion, in the same series, pointing back', async () => {
    const task = await recurring();
    const response = await completeTask(server, home.familyId, home.ada, task.taskId, task.version);
    expect(response.status).toBe(200);

    const body = response.body as CloseBody;
    expect(body.task.status).toBe('completed');
    expect(body.task.isSeriesHead).toBe(false);

    const successor = body.successor;
    expect(successor).not.toBeNull();
    expect(successor).toMatchObject({
      status: 'open',
      isSeriesHead: true,
      seriesId: task.seriesId,
      predecessorId: task.taskId,
      title: 'Take the bins out',
      version: 1,
    });
    expect(successor?.due).toMatchObject({ kind: 'date', date: '2026-09-24' });
  });

  /** research.md §2: same wall-clock time, one hour more in UTC across the change. */
  it('keeps the wall-clock time across the autumn change, 7 days plus an hour later', async () => {
    clock.set('2026-10-22T20:00:00Z');
    const task = await createTask(server, home.familyId, home.ada, {
      title: 'Thursday swimming',
      due: dateTimeDue('2026-10-22', '19:00'),
      recurrenceRule: THURSDAY,
    });
    expect(task.dueAt).toBe('2026-10-22T18:00:00.000Z');

    const response = await completeTask(server, home.familyId, home.ada, task.taskId, task.version);
    const successor = (response.body as CloseBody).successor;
    expect(successor?.due).toMatchObject({ kind: 'date_time', date: '2026-10-29', time: '19:00' });
    expect(successor?.dueAt).toBe('2026-10-29T19:00:00.000Z');

    const before = new Date(required(task.dueAt, "the head's due moment")).getTime();
    const after = new Date(
      required(required(successor, 'a successor').dueAt, "the successor's due moment"),
    ).getTime();
    expect((after - before) / 3_600_000).toBe(7 * 24 + 1);
    clock.set('2026-09-16T10:00:00Z');
  });

  describe('cancelling', () => {
    it('spawns a successor for scope: instance', async () => {
      const task = await recurring({ title: 'Skip this week' });
      const response = await cancelTask(
        server,
        home.familyId,
        home.ada,
        task.taskId,
        task.version,
        'instance',
      );
      expect(response.status).toBe(200);
      expect((response.body as CloseBody).successor).not.toBeNull();
    });

    it('spawns nothing for scope: series, and the closed row stays the head', async () => {
      const task = await recurring({ title: 'Stop the series' });
      const response = await cancelTask(
        server,
        home.familyId,
        home.ada,
        task.taskId,
        task.version,
        'series',
      );
      expect(response.status).toBe(200);

      const body = response.body as CloseBody;
      expect(body.successor).toBeNull();
      // It remains the (closed) head of an ended series.
      expect(body.task.isSeriesHead).toBe(true);
      expect(body.task.status).toBe('cancelled');
    });
  });

  it('gives no successor on the second close of a COUNT=2 series', async () => {
    const first = await createTask(server, home.familyId, home.ada, {
      title: 'Twice only',
      due: dateDue('2026-09-17'),
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=2',
    });

    const firstClose = await completeTask(
      server,
      home.familyId,
      home.ada,
      first.taskId,
      first.version,
    );
    const second = (firstClose.body as CloseBody).successor;
    expect(second).not.toBeNull();
    if (second === null) return;

    const secondClose = await completeTask(
      server,
      home.familyId,
      home.ada,
      second.taskId,
      second.version,
    );
    expect(secondClose.status).toBe(200);
    expect((secondClose.body as CloseBody).successor).toBeNull();
  });

  /** FR-019: a reopened former head is not the head, so it never spawns a second successor. */
  it('gives successor: null when a reopened former head is completed again', async () => {
    const task = await recurring({ title: 'Reopened head' });
    const firstClose = await completeTask(
      server,
      home.familyId,
      home.ada,
      task.taskId,
      task.version,
    );
    expect((firstClose.body as CloseBody).successor).not.toBeNull();
    const closedVersion = (firstClose.body as CloseBody).task.version;

    const reopened = await reopenTask(server, home.familyId, home.ada, task.taskId, closedVersion);
    expect(reopened.status).toBe(200);
    expect((reopened.body as TaskBody).isSeriesHead).toBe(false);

    const again = await completeTask(
      server,
      home.familyId,
      home.ada,
      task.taskId,
      (reopened.body as TaskBody).version,
    );
    expect(again.status).toBe(200);
    expect((again.body as CloseBody).successor).toBeNull();
  });

  it('gives a Friday rule due 2026-12-18 a successor due 2026-12-25, unmoved', async () => {
    clock.set('2026-12-18T12:00:00Z');
    const task = await createTask(server, home.familyId, home.ada, {
      title: 'Friday bins',
      due: dateDue('2026-12-18'),
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR',
    });
    const response = await completeTask(server, home.familyId, home.ada, task.taskId, task.version);
    // Christmas Day is not special to the rule; nothing shifts it.
    expect((response.body as CloseBody).successor?.due).toMatchObject({ date: '2026-12-25' });
    clock.set('2026-09-16T10:00:00Z');
  });

  describe('rules the kernel does not accept', () => {
    it('refuses FREQ=HOURLY with 422 task/recurrence_unsupported naming the part', async () => {
      const response = await request(server)
        .post(`/v1/families/${home.familyId}/tasks`)
        .set('Authorization', `Bearer ${home.ada.token}`)
        .send({ title: 'Hourly', due: dateDue('2026-09-17'), recurrenceRule: 'FREQ=HOURLY' });
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ type: 'task/recurrence_unsupported' });
      expect((response.body as { part: string }).part).toBeTruthy();
    });

    it('refuses gibberish with 422 task/recurrence_invalid and a reason', async () => {
      const response = await request(server)
        .post(`/v1/families/${home.familyId}/tasks`)
        .set('Authorization', `Bearer ${home.ada.token}`)
        .send({ title: 'Nonsense', due: dateDue('2026-09-17'), recurrenceRule: 'NOT A RULE' });
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ type: 'task/recurrence_invalid' });
    });

    it('refuses a rule with no due date with 422 task/recurrence_requires_due', async () => {
      const response = await request(server)
        .post(`/v1/families/${home.familyId}/tasks`)
        .set('Authorization', `Bearer ${home.ada.token}`)
        .send({ title: 'Undated chore', recurrenceRule: THURSDAY });
      expect(response.status).toBe(422);
      expect(response.body).toEqual({ type: 'task/recurrence_requires_due' });
    });

    it('refuses clearing the due date of a task that still recurs', async () => {
      const task = await recurring({ title: 'Still recurring' });
      const response = await patchTask(server, home.familyId, home.ada, task.taskId, {
        expectedVersion: task.version,
        due: null,
      });
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ type: 'task/recurrence_requires_due' });
    });
  });

  describe('editing the rule', () => {
    it('applies to the successor but not to instances already closed', async () => {
      const task = await recurring({ title: 'Rule change' });
      const firstClose = await completeTask(
        server,
        home.familyId,
        home.ada,
        task.taskId,
        task.version,
      );
      const successor = (firstClose.body as CloseBody).successor;
      expect(successor?.due).toMatchObject({ date: '2026-09-24' });
      if (successor === null) return;

      // Move the series to Fridays, re-anchoring on the successor's new due.
      const edited = await patchTask(server, home.familyId, home.ada, successor.taskId, {
        expectedVersion: successor.version,
        due: dateDue('2026-09-25'),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR',
      });
      expect(edited.status).toBe(200);

      const nextClose = await completeTask(
        server,
        home.familyId,
        home.ada,
        successor.taskId,
        (edited.body as TaskBody).version,
      );
      expect((nextClose.body as CloseBody).successor?.due).toMatchObject({ date: '2026-10-02' });

      // The already-closed first instance is untouched by the rule change.
      const closedAgain = await request(server)
        .get(`/v1/families/${home.familyId}/tasks/${task.taskId}`)
        .set('Authorization', `Bearer ${home.ada.token}`);
      expect((closedAgain.body as TaskBody).due).toMatchObject({ date: '2026-09-17' });
      expect((closedAgain.body as TaskBody).recurrenceRule).toContain('BYDAY=TH');
    });

    it('removes the rule and the head flag while keeping the series id', async () => {
      const task = await recurring({ title: 'No longer recurring' });
      const response = await patchTask(server, home.familyId, home.ada, task.taskId, {
        expectedVersion: task.version,
        recurrenceRule: null,
      });
      expect(response.status).toBe(200);

      const body = response.body as TaskBody;
      expect(body.recurrenceRule).toBeNull();
      expect(body.isSeriesHead).toBe(false);
      expect(body.seriesId).toBe(task.seriesId);

      // And it no longer spawns.
      const closed = await completeTask(server, home.familyId, home.ada, task.taskId, body.version);
      expect((closed.body as CloseBody).successor).toBeNull();
    });
  });
});
