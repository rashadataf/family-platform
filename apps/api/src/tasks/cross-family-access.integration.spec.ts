import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tasksContract } from '@fp/contracts';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapTasksApp } from './test-support/bootstrap-tasks-app.js';
import { buildHousehold, createTask, type Household } from './test-support/household.js';

/**
 * FR-032, SC-003. The outsider is the owner of a family of their own, so this
 * is not the session guard doing the work — it is a legitimate caller reaching
 * for a family they have no standing in.
 *
 * The bar is not merely "refused" but "refused identically": a real task in
 * someone else's family and a task that never existed must be
 * indistinguishable, or the 404 becomes an existence oracle.
 *
 * Every route is covered, and the list is checked against the contract itself
 * (T095, SC-003) — so a route added later without a row here fails rather than
 * quietly going unchecked.
 */
describe('cross-family access to Tasks (US1, FR-032, SC-003)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let home: Household;
  let realTaskId: string;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTasksApp());
    home = await buildHousehold(server, mailer);
    realTaskId = (await createTask(server, home.familyId, home.ada, { title: 'Ours alone' }))
      .taskId;
  });

  afterAll(async () => {
    await app.close();
  });

  const asOutsider = (path: string) =>
    request(server).get(path).set('Authorization', `Bearer ${home.outsider.token}`);

  it('answers the outsider’s list with 404 task/not_found, not an empty page', async () => {
    const response = await asOutsider(`/v1/families/${home.familyId}/tasks`);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ type: 'task/not_found' });
  });

  it('answers a direct read of a real task with 404', async () => {
    const response = await asOutsider(`/v1/families/${home.familyId}/tasks/${realTaskId}`);
    expect(response.status).toBe(404);
  });

  /** The assertion SC-003 actually rests on: the two answers are the same bytes. */
  it('answers a real task and a task that never existed with byte-identical bodies', async () => {
    const real = await asOutsider(`/v1/families/${home.familyId}/tasks/${realTaskId}`);
    const invented = await asOutsider(`/v1/families/${home.familyId}/tasks/${randomUUID()}`);

    expect(real.status).toBe(invented.status);
    expect(JSON.stringify(real.body)).toBe(JSON.stringify(invented.body));
  });

  it('answers a family that does not exist the same way as one that does', async () => {
    const theirs = await asOutsider(`/v1/families/${home.familyId}/tasks/${realTaskId}`);
    const nowhere = await asOutsider(`/v1/families/${randomUUID()}/tasks/${randomUUID()}`);

    expect(theirs.status).toBe(nowhere.status);
    expect(JSON.stringify(theirs.body)).toBe(JSON.stringify(nowhere.body));
  });

  it('refuses a write into another family without saying whether the task is there', async () => {
    const response = await request(server)
      .post(`/v1/families/${home.familyId}/tasks`)
      .set('Authorization', `Bearer ${home.outsider.token}`)
      .send({ title: 'Not yours to add' });
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ type: 'task/not_found' });
  });

  it('still serves the outsider their own family, so the refusal is about standing', async () => {
    const own = await createTask(server, home.outsiderFamilyId, home.outsider, { title: 'Mine' });
    const response = await asOutsider(`/v1/families/${home.outsiderFamilyId}/tasks/${own.taskId}`);
    expect(response.status).toBe(200);
  });

  /**
   * SC-003. Parameterised over the whole contract: each route is called as the
   * outsider against a REAL task in someone else's family, and again against a
   * task id that never existed. Both must answer identically.
   */
  describe('every route answers a real task and an invented one identically', () => {
    /** One caller per contract route, in the shape the route expects. */
    function call(routeName: keyof typeof tasksContract, taskId: string) {
      const base = `/v1/families/${home.familyId}/tasks`;
      const auth = (r: request.Test) => r.set('Authorization', `Bearer ${home.outsider.token}`);
      const member = home.outsiderMemberId;

      switch (routeName) {
        case 'listOpenTasks':
          return auth(request(server).get(base));
        case 'listTaskHistory':
          return auth(
            request(server)
              .get(`${base}/history`)
              .query({ from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }),
          );
        case 'createTask':
          return auth(request(server).post(base)).send({ title: 'Not yours' });
        case 'getTask':
          return auth(request(server).get(`${base}/${taskId}`));
        case 'updateTask':
          return auth(request(server).patch(`${base}/${taskId}`)).send({
            expectedVersion: 1,
            title: 'Not yours',
          });
        case 'completeTask':
          return auth(request(server).post(`${base}/${taskId}/complete`)).send({
            expectedVersion: 1,
          });
        case 'reopenTask':
          return auth(request(server).post(`${base}/${taskId}/reopen`)).send({
            expectedVersion: 1,
          });
        case 'cancelTask':
          return auth(request(server).post(`${base}/${taskId}/cancel`)).send({
            expectedVersion: 1,
            scope: 'instance',
          });
        case 'assignTask':
          return auth(request(server).put(`${base}/${taskId}/assignees/${member}`));
        case 'unassignTask':
          return auth(request(server).delete(`${base}/${taskId}/assignees/${member}`));
      }
    }

    const routeNames = Object.keys(tasksContract) as (keyof typeof tasksContract)[];

    it('covers exactly the routes the contract registers', () => {
      // The guard against this file going stale: ten routes today, and a
      // eleventh cannot be added without failing here.
      expect(routeNames).toHaveLength(10);
      for (const name of routeNames) {
        expect(() => call(name, realTaskId)).not.toThrow();
      }
    });

    for (const routeName of Object.keys(tasksContract) as (keyof typeof tasksContract)[]) {
      it(`${routeName} answers 404 task/not_found, identically for a real and an invented task`, async () => {
        const real = await call(routeName, realTaskId);
        const invented = await call(routeName, randomUUID());

        expect(real.status, routeName).toBe(404);
        expect(real.body, routeName).toMatchObject({ type: 'task/not_found' });
        expect(invented.status, routeName).toBe(404);
        expect(JSON.stringify(real.body), routeName).toBe(JSON.stringify(invented.body));
      });
    }
  });

  it('does not let a member of one family read the other’s task by id alone', async () => {
    const own = await createTask(server, home.outsiderFamilyId, home.outsider, { title: 'Theirs' });
    const response = await request(server)
      .get(`/v1/families/${home.familyId}/tasks/${own.taskId}`)
      .set('Authorization', `Bearer ${home.ada.token}`);
    // Ada has standing here, but the task belongs to another family: 404 again.
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ type: 'task/not_found' });
  });
});
