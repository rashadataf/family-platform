import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDatabase } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapTasksApp } from './test-support/bootstrap-tasks-app.js';
import {
  assign,
  buildHousehold,
  createTask,
  listOpenTasks,
  unassign,
  type Household,
  type TaskBody,
} from './test-support/household.js';

async function assignedEvents(taskId: string) {
  const rows = await withDatabase((tx) =>
    tx.outboxEvent.findMany({ where: { aggregateId: taskId }, orderBy: { id: 'asc' } }),
  );
  return rows.filter((row) => row.eventType === 'tasks.TaskAssigned.v1');
}

describe('task assignees (US2, FR-013, FR-016)', () => {
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

  it('accepts assigneeIds at creation and emits one TaskAssigned each', async () => {
    const task = await createTask(server, home.familyId, home.ada, {
      title: 'Tidy the kitchen',
      assigneeIds: [home.grace.memberId, home.alan.memberId],
    });
    expect(task.assigneeIds.sort()).toEqual([home.grace.memberId, home.alan.memberId].sort());

    const events = await assignedEvents(task.taskId);
    expect(events).toHaveLength(2);
    expect(events.map((e) => (e.payload as { memberId: string }).memberId).sort()).toEqual(
      [home.grace.memberId, home.alan.memberId].sort(),
    );
  });

  it('refuses more than 20 assignees at the contract, before the handler runs', async () => {
    const over = await request(server)
      .post(`/v1/families/${home.familyId}/tasks`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send({ title: 'Crowded', assigneeIds: Array.from({ length: 21 }, () => randomUUID()) });
    expect(over.status).toBe(400);
  });

  describe('PUT …/assignees/:memberId', () => {
    it('is idempotent: twice gives 200 twice, and exactly one TaskAssigned', async () => {
      const task = await createTask(server, home.familyId, home.ada, { title: 'Water the plants' });

      const first = await assign(server, home.familyId, home.ada, task.taskId, home.grace.memberId);
      expect(first.status).toBe(200);
      const second = await assign(
        server,
        home.familyId,
        home.ada,
        task.taskId,
        home.grace.memberId,
      );
      expect(second.status).toBe(200);

      expect((second.body as TaskBody).assigneeIds).toEqual([home.grace.memberId]);
      expect(await assignedEvents(task.taskId)).toHaveLength(1);
    });

    it('does not bump the version on the second, no-op assignment', async () => {
      const task = await createTask(server, home.familyId, home.ada, { title: 'Sweep the path' });
      const first = await assign(server, home.familyId, home.ada, task.taskId, home.alan.memberId);
      const second = await assign(server, home.familyId, home.ada, task.taskId, home.alan.memberId);
      expect((second.body as TaskBody).version).toBe((first.body as TaskBody).version);
    });

    it('assigns a child as readily as an adult', async () => {
      const task = await createTask(server, home.familyId, home.ada, { title: 'Tidy your room' });
      const response = await assign(server, home.familyId, home.ada, task.taskId, home.charlieId);
      expect(response.status).toBe(200);
      expect((response.body as TaskBody).assigneeIds).toEqual([home.charlieId]);
    });
  });

  describe('DELETE …/assignees/:memberId', () => {
    it('is idempotent: removing someone who was never assigned is still 200', async () => {
      const task = await createTask(server, home.familyId, home.ada, { title: 'Nothing to undo' });
      const response = await unassign(
        server,
        home.familyId,
        home.ada,
        task.taskId,
        home.grace.memberId,
      );
      expect(response.status).toBe(200);
      expect((response.body as TaskBody).assigneeIds).toEqual([]);
    });

    /** FR-013: losing its last assignee does not close or delete the task. */
    it('leaves the task open and present with no assignees', async () => {
      const task = await createTask(server, home.familyId, home.ada, {
        title: 'Briefly assigned',
        assigneeIds: [home.grace.memberId],
      });
      const response = await unassign(
        server,
        home.familyId,
        home.ada,
        task.taskId,
        home.grace.memberId,
      );
      expect(response.status).toBe(200);
      expect((response.body as TaskBody).status).toBe('open');
      expect((response.body as TaskBody).assigneeIds).toEqual([]);

      const { body } = await listOpenTasks(server, home.familyId, home.ada, { limit: 200 });
      expect(body.items.map((t) => t.taskId)).toContain(task.taskId);
    });
  });

  describe('?assignee= filtering', () => {
    it('returns only the tasks that member is on', async () => {
      const hers = await createTask(server, home.familyId, home.ada, {
        title: 'Grace only',
        assigneeIds: [home.grace.memberId],
      });
      const his = await createTask(server, home.familyId, home.ada, {
        title: 'Alan only',
        assigneeIds: [home.alan.memberId],
      });

      const { status, body } = await listOpenTasks(server, home.familyId, home.ada, {
        assignee: home.grace.memberId,
        limit: 200,
      });
      expect(status).toBe(200);
      const ids = body.items.map((t) => t.taskId);
      expect(ids).toContain(hers.taskId);
      expect(ids).not.toContain(his.taskId);
    });
  });

  /**
   * FR-016's disclosure rule. The database's composite foreign key decides this,
   * so Tasks never reads a Family table to find out — and the answer cannot
   * distinguish "a member of another family" from "nobody at all".
   */
  describe('an assignee who is not a member of this family', () => {
    it('refuses a foreign member and a random UUID with byte-identical bodies', async () => {
      const task = await createTask(server, home.familyId, home.ada, { title: 'Probe' });

      // A real member — of the OTHER family.
      const foreign = await assign(
        server,
        home.familyId,
        home.ada,
        task.taskId,
        home.outsiderMemberId,
      );
      const invented = await assign(server, home.familyId, home.ada, task.taskId, randomUUID());

      expect(foreign.status).toBe(422);
      expect(invented.status).toBe(422);
      expect(foreign.body).toMatchObject({ type: 'task/assignee_invalid' });
      expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(invented.body));
    });

    it('leaves nothing behind when a create names one, rolling the whole thing back', async () => {
      const response = await request(server)
        .post(`/v1/families/${home.familyId}/tasks`)
        .set('Authorization', `Bearer ${home.ada.token}`)
        .send({ title: 'Never lands', assigneeIds: [randomUUID()] });
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ type: 'task/assignee_invalid' });

      const { body } = await listOpenTasks(server, home.familyId, home.ada, { limit: 200 });
      expect(body.items.map((t) => t.title)).not.toContain('Never lands');
    });
  });
});
