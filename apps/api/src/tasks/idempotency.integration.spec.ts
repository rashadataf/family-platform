import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDatabase } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapTasksApp } from './test-support/bootstrap-tasks-app.js';
import {
  buildHousehold,
  createTask,
  type Household,
  type TaskBody,
} from './test-support/household.js';

async function outboxCount(taskId: string): Promise<number> {
  const rows = await withDatabase((tx) =>
    tx.outboxEvent.findMany({ where: { aggregateId: taskId } }),
  );
  return rows.length;
}

/**
 * ADR-006 and Principle IX, for every route that changes something. A replay is
 * not merely "does not crash": it must return the SAME body and write no second
 * outbox row, because the retry a flaky phone makes is indistinguishable from a
 * second deliberate tap.
 */
describe('Idempotency-Key on every mutating Tasks route (US3, FR-023)', () => {
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

  const auth = () => `Bearer ${home.ada.token}`;
  const base = () => `/v1/families/${home.familyId}/tasks`;

  /** Sends the same request twice under one key and returns both responses. */
  async function twice(send: (key: string) => request.Test) {
    const key = randomUUID();
    const first = await send(key);
    const second = await send(key);
    return { first, second };
  }

  it('replays createTask to one row and an identical body', async () => {
    const { first, second } = await twice((key) =>
      request(server)
        .post(base())
        .set('Authorization', auth())
        .set('Idempotency-Key', key)
        .send({ title: 'Idempotent create' }),
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await outboxCount((first.body as TaskBody).taskId)).toBe(1);
  });

  it('replays updateTask without a second version bump or event', async () => {
    const task = await createTask(server, home.familyId, home.ada, { title: 'Patch me' });
    const before = await outboxCount(task.taskId);

    const { first, second } = await twice((key) =>
      request(server)
        .patch(`${base()}/${task.taskId}`)
        .set('Authorization', auth())
        .set('Idempotency-Key', key)
        .send({ expectedVersion: task.version, title: 'Patched once' }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    // Without the replay guard the second call would be a 409, not a 200.
    expect((second.body as TaskBody).version).toBe(task.version + 1);
    expect(await outboxCount(task.taskId)).toBe(before + 1);
  });

  it('replays completeTask without a second TaskCompleted', async () => {
    const task = await createTask(server, home.familyId, home.ada, { title: 'Complete me once' });
    const before = await outboxCount(task.taskId);

    const { first, second } = await twice((key) =>
      request(server)
        .post(`${base()}/${task.taskId}/complete`)
        .set('Authorization', auth())
        .set('Idempotency-Key', key)
        .send({ expectedVersion: task.version }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await outboxCount(task.taskId)).toBe(before + 1);
  });

  it('replays reopenTask without a second TaskUpdated', async () => {
    const task = await createTask(server, home.familyId, home.ada, { title: 'Reopen me once' });
    const completed = await request(server)
      .post(`${base()}/${task.taskId}/complete`)
      .set('Authorization', auth())
      .send({ expectedVersion: task.version });
    const version = (completed.body as { task: TaskBody }).task.version;
    const before = await outboxCount(task.taskId);

    const { first, second } = await twice((key) =>
      request(server)
        .post(`${base()}/${task.taskId}/reopen`)
        .set('Authorization', auth())
        .set('Idempotency-Key', key)
        .send({ expectedVersion: version }),
    );

    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await outboxCount(task.taskId)).toBe(before + 1);
  });

  it('replays cancelTask without a second TaskCancelled', async () => {
    const task = await createTask(server, home.familyId, home.ada, { title: 'Cancel me once' });
    const before = await outboxCount(task.taskId);

    const { first, second } = await twice((key) =>
      request(server)
        .post(`${base()}/${task.taskId}/cancel`)
        .set('Authorization', auth())
        .set('Idempotency-Key', key)
        .send({ expectedVersion: task.version, scope: 'instance' }),
    );

    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await outboxCount(task.taskId)).toBe(before + 1);
  });

  it('replays assignTask without a second TaskAssigned', async () => {
    const task = await createTask(server, home.familyId, home.ada, { title: 'Assign me once' });
    const before = await outboxCount(task.taskId);

    const { first, second } = await twice((key) =>
      request(server)
        .put(`${base()}/${task.taskId}/assignees/${home.grace.memberId}`)
        .set('Authorization', auth())
        .set('Idempotency-Key', key)
        .send(),
    );

    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await outboxCount(task.taskId)).toBe(before + 1);
  });

  it('replays unassignTask without a second TaskUpdated', async () => {
    const task = await createTask(server, home.familyId, home.ada, {
      title: 'Unassign me once',
      assigneeIds: [home.grace.memberId],
    });
    const before = await outboxCount(task.taskId);

    const { first, second } = await twice((key) =>
      request(server)
        .delete(`${base()}/${task.taskId}/assignees/${home.grace.memberId}`)
        .set('Authorization', auth())
        .set('Idempotency-Key', key)
        .send(),
    );

    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await outboxCount(task.taskId)).toBe(before + 1);
  });

  /** Only a SUCCESS is stored: a refusal wrote nothing, so a fresh attempt replays it for free. */
  it('does not store a refusal, so the same key can succeed afterwards', async () => {
    const key = randomUUID();
    const refused = await request(server)
      .post(base())
      .set('Authorization', auth())
      .set('Idempotency-Key', key)
      .send({ title: 'Bad zone', due: { kind: 'date', date: '2026-09-30', timeZone: 'Mars/X' } });
    expect(refused.status).toBe(422);

    const accepted = await request(server)
      .post(base())
      .set('Authorization', auth())
      .set('Idempotency-Key', key)
      .send({ title: 'Now valid' });
    expect(accepted.status).toBe(201);
    expect((accepted.body as TaskBody).title).toBe('Now valid');
  });

  it('scopes the key per route, so the same key on two routes is two operations', async () => {
    const key = randomUUID();
    const created = await request(server)
      .post(base())
      .set('Authorization', auth())
      .set('Idempotency-Key', key)
      .send({ title: 'Shared key' });
    expect(created.status).toBe(201);

    const taskId = (created.body as TaskBody).taskId;
    const completed = await request(server)
      .post(`${base()}/${taskId}/complete`)
      .set('Authorization', auth())
      .set('Idempotency-Key', key)
      .send({ expectedVersion: 1 });
    expect(completed.status).toBe(200);
  });
});
