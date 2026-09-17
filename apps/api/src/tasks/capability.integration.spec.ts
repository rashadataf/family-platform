import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapTasksApp } from './test-support/bootstrap-tasks-app.js';
import {
  buildHousehold,
  createTask,
  listOpenTasks,
  taskRequest,
  type Household,
  type HouseholdMember,
} from './test-support/household.js';

/**
 * Principle V and spec 008's capability model, applied to a third context with
 * no new guard. `tasks:read` belongs to every role including viewer;
 * `tasks:write` stops at extended. Tasks adds nothing to that table — it only
 * names the capability each route needs (T018, T034).
 */
describe('Tasks capabilities (US1, FR-007)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let home: Household;
  let taskId: string;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTasksApp());
    home = await buildHousehold(server, mailer);
    taskId = (await createTask(server, home.familyId, home.ada)).taskId;
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (caller: HouseholdMember, body = taskRequest()) =>
    request(server)
      .post(`/v1/families/${home.familyId}/tasks`)
      .set('Authorization', `Bearer ${caller.token}`)
      .send(body);

  const get = (caller: HouseholdMember) =>
    request(server)
      .get(`/v1/families/${home.familyId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${caller.token}`);

  describe('viv, a viewer: tasks:read but not tasks:write', () => {
    it('may list open tasks', async () => {
      const { status } = await listOpenTasks(server, home.familyId, home.viv);
      expect(status).toBe(200);
    });

    it('may read one task', async () => {
      expect((await get(home.viv)).status).toBe(200);
    });

    it('may not create one, and is told which capability is missing', async () => {
      const response = await post(home.viv);
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        type: 'task/capability_required',
        capability: 'tasks:write',
      });
    });

    it('is refused before the body is validated, so a malformed request is still 403', async () => {
      // A blank title would be a 400 for someone who could write at all.
      const response = await post(home.viv, { title: '' });
      expect(response.status).toBe(403);
    });
  });

  describe('alan, an extended member: both capabilities', () => {
    it('may create a task', async () => {
      const response = await post(home.alan);
      expect(response.status).toBe(201);
    });

    it('may read the family’s tasks', async () => {
      expect((await listOpenTasks(server, home.familyId, home.alan)).status).toBe(200);
    });
  });

  describe('ada and grace, owner and adult', () => {
    it('may both create tasks', async () => {
      expect((await post(home.ada)).status).toBe(201);
      expect((await post(home.grace)).status).toBe(201);
    });
  });

  /** Layer 2 before layer 3: no standing is 404, never a 403 that would confirm the family. */
  it('answers a caller with no standing 404, not 403, even for a capability they lack', async () => {
    const response = await post(home.outsider as unknown as HouseholdMember);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ type: 'task/not_found' });
  });
});
