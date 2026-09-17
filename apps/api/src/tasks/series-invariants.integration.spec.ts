import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeTo, withDatabase, withDatabaseCommitted } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapTasksApp } from './test-support/bootstrap-tasks-app.js';
import {
  buildHousehold,
  completeTask,
  createTask,
  dateDue,
  required,
  type CloseBody,
  type Household,
  type TaskBody,
} from './test-support/household.js';

const THURSDAY = 'FREQ=WEEKLY;BYDAY=TH';

async function successorsOf(predecessorId: string, familyId: string) {
  return withDatabase(async (tx) => {
    await scopeTo(tx, familyId);
    return tx.task.findMany({ where: { predecessorId } });
  });
}

async function headsOf(seriesId: string, familyId: string) {
  return withDatabase(async (tx) => {
    await scopeTo(tx, familyId);
    return tx.task.findMany({ where: { seriesId, isSeriesHead: true } });
  });
}

/**
 * SC-006: exactly one successor, never missing and never doubled. The design
 * makes each half a database constraint rather than a discipline, so these
 * tests go at the constraints directly as well as through the routes — a lock
 * that regressed would still leave the index refusing.
 */
describe('series invariants (US4, FR-019, FR-022, SC-006)', () => {
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

  const recurring = (title: string) =>
    createTask(server, home.familyId, home.ada, {
      title,
      due: dateDue('2026-09-17'),
      recurrenceRule: THURSDAY,
    });

  it('refuses a second successor for one predecessor — UNIQUE (predecessor_id)', async () => {
    const task = await recurring('One successor only');
    const closed = await completeTask(server, home.familyId, home.ada, task.taskId, task.version);
    expect((closed.body as CloseBody).successor).not.toBeNull();

    await expect(
      withDatabaseCommitted(async (tx) => {
        await scopeTo(tx, home.familyId);
        await tx.task.create({
          data: {
            id: randomUUID(),
            familyId: home.familyId,
            title: 'Impostor successor',
            predecessorId: task.taskId,
            dueKind: 'date',
            dueDate: new Date('2026-09-24T00:00:00Z'),
            timeZone: 'Europe/London',
            dueAt: new Date('2026-09-24T23:00:00Z'),
          },
        });
      }),
    ).rejects.toThrow();

    expect(await successorsOf(task.taskId, home.familyId)).toHaveLength(1);
  });

  it('refuses a second head in one series — the partial unique index', async () => {
    const task = await recurring('One head only');
    const seriesId = task.seriesId;
    expect(seriesId).not.toBeNull();
    if (seriesId === null) return;

    await expect(
      withDatabaseCommitted(async (tx) => {
        await scopeTo(tx, home.familyId);
        await tx.task.create({
          data: {
            id: randomUUID(),
            familyId: home.familyId,
            title: 'Second head',
            seriesId,
            isSeriesHead: true,
            recurrenceRule: THURSDAY,
            recurrenceAnchor: new Date('2026-09-17T00:00:00Z'),
            dueKind: 'date',
            dueDate: new Date('2026-09-17T00:00:00Z'),
            timeZone: 'Europe/London',
            dueAt: new Date('2026-09-17T23:00:00Z'),
          },
        });
      }),
    ).rejects.toThrow();

    expect(await headsOf(seriesId, home.familyId)).toHaveLength(1);
  });

  /** A closed head is not a head, so the index leaves room for exactly its successor. */
  it('keeps exactly one head per series across a close', async () => {
    const task = await recurring('Head moves on');
    const seriesId = required(task.seriesId, 'a series id');
    expect(await headsOf(seriesId, home.familyId)).toHaveLength(1);

    const closed = await completeTask(server, home.familyId, home.ada, task.taskId, task.version);
    const successor = (closed.body as CloseBody).successor;

    const heads = await headsOf(seriesId, home.familyId);
    expect(heads).toHaveLength(1);
    expect(heads[0]?.id).toBe(successor?.taskId);
  });

  it('yields exactly one successor when one head is completed in parallel', async () => {
    const task = await recurring('Contested head');

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        completeTask(server, home.familyId, home.ada, task.taskId, task.version),
      ),
    );

    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    // The assertion SC-006 is really about: one row, not four.
    expect(await successorsOf(task.taskId, home.familyId)).toHaveLength(1);
    expect(await headsOf(required(task.seriesId, 'a series id'), home.familyId)).toHaveLength(1);
  });

  it('yields exactly one successor when the close is replayed under one Idempotency-Key', async () => {
    const task = await recurring('Replayed close');
    const key = randomUUID();

    const send = () =>
      request(server)
        .post(`/v1/families/${home.familyId}/tasks/${task.taskId}/complete`)
        .set('Authorization', `Bearer ${home.ada.token}`)
        .set('Idempotency-Key', key)
        .send({ expectedVersion: task.version });

    const first = await send();
    const second = await send();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await successorsOf(task.taskId, home.familyId)).toHaveLength(1);
  });

  it('never leaves a series with no head while its rule is still running', async () => {
    const task = await recurring('Always a head');
    let current: TaskBody | null = task;
    const seriesId = required(task.seriesId, 'a series id');

    // Close three generations, checking the head count after each.
    for (let i = 0; i < 3 && current !== null; i += 1) {
      const closed = await completeTask(
        server,
        home.familyId,
        home.ada,
        current.taskId,
        current.version,
      );
      expect(closed.status).toBe(200);
      expect(await headsOf(seriesId, home.familyId)).toHaveLength(1);
      current = (closed.body as CloseBody).successor;
    }
  });
});
