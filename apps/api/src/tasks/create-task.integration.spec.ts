import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeTo, withDatabase } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapTasksApp } from './test-support/bootstrap-tasks-app.js';
import {
  buildHousehold,
  dateDue,
  dateTimeDue,
  taskRequest,
  type Household,
  type TaskBody,
} from './test-support/household.js';

describe('POST /v1/families/:familyId/tasks (US1, FR-001–FR-004)', () => {
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

  const post = (body: Record<string, unknown>, key?: string) => {
    const call = request(server)
      .post(`/v1/families/${home.familyId}/tasks`)
      .set('Authorization', `Bearer ${home.ada.token}`);
    return (key === undefined ? call : call.set('Idempotency-Key', key)).send(body);
  };

  it('creates an undated task, open at version 1, and publishes exactly one TaskCreated', async () => {
    const response = await post(taskRequest({ title: 'Renew the passports' }));
    expect(response.status).toBe(201);

    const body = response.body as TaskBody;
    expect(body).toMatchObject({
      title: 'Renew the passports',
      status: 'open',
      version: 1,
      priority: 'normal',
      due: null,
      dueAt: null,
      isOverdue: false,
      assigneeIds: [],
      createdByMemberId: home.ada.memberId,
    });

    const outbox = await withDatabase((tx) =>
      tx.outboxEvent.findMany({ where: { aggregateId: body.taskId } }),
    );
    expect(outbox.map((row) => row.eventType)).toEqual(['tasks.TaskCreated.v1']);
    expect(outbox[0]?.payload).toMatchObject({
      familyId: home.familyId,
      taskId: body.taskId,
      seriesId: null,
      predecessorId: null,
      dueKind: 'none',
    });
  });

  /**
   * FR-003, research.md §4. A task due "on the 30th" is not late until the 30th
   * is over where it was written down, so the due MOMENT is the start of the
   * next local day — 23:00Z in BST, midnight Z once the clocks have gone back.
   */
  it('resolves a date-only due to the start of the next local day, on both sides of the clock change', async () => {
    const bst = await post(taskRequest({ due: dateDue('2026-09-30') }));
    expect(bst.status).toBe(201);
    expect((bst.body as TaskBody).dueAt).toBe('2026-09-30T23:00:00.000Z');
    expect((bst.body as TaskBody).due).toEqual({
      kind: 'date',
      date: '2026-09-30',
      timeZone: 'Europe/London',
    });

    const gmt = await post(taskRequest({ due: dateDue('2026-12-01') }));
    expect(gmt.status).toBe(201);
    expect((gmt.body as TaskBody).dueAt).toBe('2026-12-02T00:00:00.000Z');
  });

  it('resolves a date-time due through the kernel, including across the spring-forward gap', async () => {
    const plain = await post(taskRequest({ due: dateTimeDue('2026-09-30', '18:30') }));
    expect(plain.status).toBe(201);
    expect((plain.body as TaskBody).dueAt).toBe('2026-09-30T17:30:00.000Z');
    expect((plain.body as TaskBody).due).toMatchObject({ kind: 'date_time', time: '18:30' });

    // 01:30 does not exist on 2026-03-29 in London; the kernel moves it forward.
    const gap = await post(taskRequest({ due: dateTimeDue('2026-03-29', '01:30') }));
    expect(gap.status).toBe(201);
    expect((gap.body as TaskBody).dueAt).toBe('2026-03-29T01:30:00.000Z');
  });

  it('refuses an unknown time zone with 422 task/unknown_time_zone, never defaulting it', async () => {
    const response = await post(taskRequest({ due: dateDue('2026-09-30', 'Mars/Olympus_Mons') }));
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ type: 'task/unknown_time_zone' });
    // The zone the caller sent is not echoed back.
    expect(JSON.stringify(response.body)).not.toContain('Olympus');
  });

  it('refuses a date that is not on the calendar with 422 task/invalid_due naming the field', async () => {
    const response = await post(taskRequest({ due: dateDue('2026-02-30') }));
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ type: 'task/invalid_due', field: 'date' });
  });

  it('refuses an impossible time of day with 422 task/invalid_due naming the time field', async () => {
    const response = await post(taskRequest({ due: dateTimeDue('2026-09-30', '25:00') }));
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ type: 'task/invalid_due', field: 'time' });
  });

  /** Principle I: a due time without a zone is unrepresentable, not merely refused by a handler. */
  it('rejects a date_time due with no timeZone at contract validation, before any handler runs', async () => {
    const response = await post(
      taskRequest({ due: { kind: 'date_time', date: '2026-09-30', time: '18:30' } }),
    );
    expect(response.status).toBe(400);
    expect(response.body).not.toMatchObject({ type: 'task/invalid_due' });
  });

  it('rejects an unknown field on the due union, which is strict on both arms', async () => {
    const response = await post(
      taskRequest({ due: { ...dateDue('2026-09-30'), offset: '+01:00' } }),
    );
    expect(response.status).toBe(400);
  });

  it('replays an Idempotency-Key to one row and a byte-identical body (ADR-006)', async () => {
    const key = 'create-task-once';
    const first = await post(taskRequest({ title: 'Book the MOT' }), key);
    expect(first.status).toBe(201);
    const second = await post(taskRequest({ title: 'Book the MOT' }), key);

    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);

    const taskId = (first.body as TaskBody).taskId;
    const rows = await withDatabase(async (tx) => {
      // `task` is under FORCE row-level security: an unscoped read sees nothing
      // at all, which would make this assertion pass for the wrong reason.
      await scopeTo(tx, home.familyId);
      return tx.task.findMany({ where: { title: 'Book the MOT' } });
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(taskId);

    const outbox = await withDatabase((tx) =>
      tx.outboxEvent.findMany({ where: { aggregateId: taskId } }),
    );
    expect(outbox).toHaveLength(1);
  });

  it('stores notes, priority and category as given, and defaults priority to normal', async () => {
    const response = await post(
      taskRequest({
        title: 'Ring the dentist',
        notes: 'Ask about the referral',
        priority: 'high',
        category: 'health',
      }),
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      notes: 'Ask about the referral',
      priority: 'high',
      category: 'health',
    });

    const plain = await post(taskRequest({ title: 'No frills' }));
    expect(plain.body).toMatchObject({ priority: 'normal', category: null, notes: null });
  });

  it('refuses a blank title and one over 200 characters at the contract', async () => {
    expect((await post(taskRequest({ title: '   ' }))).status).toBe(400);
    expect((await post(taskRequest({ title: 'x'.repeat(201) }))).status).toBe(400);
    expect((await post(taskRequest({ title: 'x'.repeat(200) }))).status).toBe(201);
  });

  it('refuses notes over 4,000 characters at the contract', async () => {
    expect((await post(taskRequest({ notes: 'x'.repeat(4001) }))).status).toBe(400);
    expect((await post(taskRequest({ notes: 'x'.repeat(4000) }))).status).toBe(201);
  });
});
