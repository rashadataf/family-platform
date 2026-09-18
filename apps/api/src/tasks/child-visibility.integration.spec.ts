import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeTo, withDatabaseCommitted } from '@fp/testing';
import type { AuthenticatedCaller } from '../family/test-support/register-and-login.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapTasksApp } from './test-support/bootstrap-tasks-app.js';
import {
  addChild,
  assign,
  buildHousehold,
  createTask,
  endGuardianship,
  getTask,
  grantGuardianship,
  listOpenTasks,
  type Household,
} from './test-support/household.js';

/**
 * FR-014 and SC-004, the contract's guardian matrix in full.
 *
 * The rule is guardianship, never role: an OWNER who does not guard a child
 * cannot see that child's task, and a VIEWER who does, can. Both directions are
 * asserted here, because a filter that quietly fell back to role would pass a
 * test that only ever checked the first.
 *
 * A hidden task is 404, never 403 — indistinguishable from one that does not
 * exist, or the refusal itself discloses the child's chore.
 */
describe('child visibility on tasks (US2, FR-014, SC-004)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let home: Household;

  /** Charlie is guarded by Ada (she added him). Dana is guarded by Grace alone. */
  let danaId: string;
  let charlieTaskId: string;
  let danaTaskId: string;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTasksApp());
    home = await buildHousehold(server, mailer);

    danaId = await addChild(server, home.familyId, home.grace, 'Dana');

    charlieTaskId = (
      await createTask(server, home.familyId, home.ada, {
        title: 'Charlie: tidy your room',
        assigneeIds: [home.charlieId],
      })
    ).taskId;
    danaTaskId = (
      await createTask(server, home.familyId, home.grace, {
        title: 'Dana: reading practice',
        assigneeIds: [danaId],
      })
    ).taskId;
  });

  afterAll(async () => {
    await app.close();
  });

  const read = (caller: AuthenticatedCaller, taskId: string) =>
    getTask(server, home.familyId, caller, taskId);

  describe("Charlie's task, guarded by Ada", () => {
    it('is readable by Ada, his guardian', async () => {
      expect((await read(home.ada, charlieTaskId)).status).toBe(200);
    });

    it('is 404 — not 403 — for Grace, an adult who does not guard him', async () => {
      const response = await read(home.grace, charlieTaskId);
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ type: 'task/not_found' });
    });

    it('is 404 for Alan, an extended member who guards nobody', async () => {
      expect((await read(home.alan, charlieTaskId)).status).toBe(404);
    });

    it('is 404 for Viv, a viewer who guards nobody', async () => {
      expect((await read(home.viv, charlieTaskId)).status).toBe(404);
    });
  });

  /** The direction that catches a filter which fell back to role. */
  describe("Dana's task, guarded by Grace alone", () => {
    it('is readable by Grace, who guards her', async () => {
      expect((await read(home.grace, danaTaskId)).status).toBe(200);
    });

    it('is 404 for ADA, the owner, because she does not guard Dana', async () => {
      const response = await read(home.ada, danaTaskId);
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ type: 'task/not_found' });
    });
  });

  it('lets a VIEWER who guards a child read that child’s task', async () => {
    // Spec 008 makes a viewer an ineligible guardian, so no route will create
    // this. The row is seeded directly, because what is under test is that
    // Tasks' filter reads guardianship and never role.
    await withDatabaseCommitted(async (tx) => {
      await scopeTo(tx, home.familyId);
      await tx.guardianship.create({
        data: {
          familyId: home.familyId,
          guardianMemberId: home.viv.memberId,
          childMemberId: home.charlieId,
        },
      });
    });
    expect((await read(home.viv, charlieTaskId)).status).toBe(200);
  });

  describe('the open list', () => {
    it('omits a hidden task, and its length is what it would be if the task did not exist', async () => {
      const guardianView = await listOpenTasks(server, home.familyId, home.grace, { limit: 200 });
      const ownerView = await listOpenTasks(server, home.familyId, home.ada, { limit: 200 });

      expect(guardianView.body.items.map((t) => t.taskId)).toContain(danaTaskId);
      expect(ownerView.body.items.map((t) => t.taskId)).not.toContain(danaTaskId);

      // The numeric assertion FR-014's "or infer its existence" demands: Ada
      // sees Charlie's and not Dana's; Grace the reverse. Same total either way.
      const ownerIds = ownerView.body.items.map((t) => t.taskId);
      const guardianIds = guardianView.body.items.map((t) => t.taskId);
      expect(ownerIds).toContain(charlieTaskId);
      expect(guardianIds).not.toContain(charlieTaskId);
      expect(ownerIds.length).toBe(guardianIds.length);
    });

    it('answers ?assignee=<child> for a non-guardian with 200 and an empty page, not an error', async () => {
      // An error would confirm the id belongs to a child in this family.
      const { status, body } = await listOpenTasks(server, home.familyId, home.ada, {
        assignee: danaId,
        limit: 200,
      });
      expect(status).toBe(200);
      expect(body.items).toEqual([]);
      expect(body.nextCursor).toBeNull();
    });

    it('answers ?assignee=<child> for the guardian with that child’s tasks', async () => {
      const { status, body } = await listOpenTasks(server, home.familyId, home.grace, {
        assignee: danaId,
        limit: 200,
      });
      expect(status).toBe(200);
      expect(body.items.map((t) => t.taskId)).toEqual([danaTaskId]);
    });
  });

  it('hides a task with an adult and an unguarded child from that adult assignee', async () => {
    const joint = await createTask(server, home.familyId, home.grace, {
      title: 'Joint: swimming kit',
      assigneeIds: [home.alan.memberId, danaId],
    });

    // Alan is ON the task, but cannot see Dana — so he cannot see the task.
    expect((await read(home.alan, joint.taskId)).status).toBe(404);
    const alanList = await listOpenTasks(server, home.familyId, home.alan, { limit: 200 });
    expect(alanList.body.items.map((t) => t.taskId)).not.toContain(joint.taskId);

    // Grace guards Dana, so she sees it.
    expect((await read(home.grace, joint.taskId)).status).toBe(200);
  });

  it('evaluates guardianship at read time: 404 → 200 → 404 across a grant and an end', async () => {
    // Ada, not Alan: spec 008 makes only an adult holding owner/adult an
    // eligible guardian, so an extended member cannot be granted one by route.
    // Grace keeps guarding Dana throughout, so ending Ada's never leaves Dana
    // with none (FR-008).
    expect((await read(home.ada, danaTaskId)).status).toBe(404);

    const grant = await grantGuardianship(
      server,
      home.familyId,
      home.ada,
      danaId,
      home.ada.memberId,
    );
    expect(grant.status).toBe(201);
    expect((await read(home.ada, danaTaskId)).status).toBe(200);

    const end = await endGuardianship(server, home.familyId, home.ada, danaId, home.ada.memberId);
    expect(end.status).toBe(200);
    // The very next request, with nothing else changed about the task.
    expect((await read(home.ada, danaTaskId)).status).toBe(404);
  });

  /**
   * Writing is `tasks:write`; seeing is guardianship. A non-guardian may assign a
   * child and then lose sight of what they just did — asserted, not accidental
   * (contracts/tasks-api.md).
   */
  it('lets a non-guardian assign a child, then answers 404 on the very next read', async () => {
    const task = await createTask(server, home.familyId, home.ada, { title: 'Ada assigns Dana' });
    const assigned = await assign(server, home.familyId, home.ada, task.taskId, danaId);
    expect(assigned.status).toBe(200);

    const afterwards = await read(home.ada, task.taskId);
    expect(afterwards.status).toBe(404);
  });

  it('does not let a non-guardian probe a hidden task through its write routes either', async () => {
    const { default: request } = await import('supertest');
    const patch = await request(server)
      .patch(`/v1/families/${home.familyId}/tasks/${danaTaskId}`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send({ expectedVersion: 1, title: 'probe' });
    expect(patch.status).toBe(404);

    const complete = await request(server)
      .post(`/v1/families/${home.familyId}/tasks/${danaTaskId}/complete`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send({ expectedVersion: 1 });
    expect(complete.status).toBe(404);
  });
});
