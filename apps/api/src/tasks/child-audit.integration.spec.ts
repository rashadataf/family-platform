import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAuditLogRows, resolvedTestDatabaseOwnerUrl } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapTasksApp } from './test-support/bootstrap-tasks-app.js';
import {
  addChild,
  buildHousehold,
  createTask,
  getTask,
  listOpenTasks,
  type Household,
} from './test-support/household.js';

const TITLE = 'Charlie: dentist forms';

/**
 * FR-015. Every read that touches a child's assignment leaves an audit row —
 * granted or denied — with the CHILD as the subject and the task named by
 * identifier only.
 *
 * The `purpose` assertions are the ones that matter for SC-011: an audit trail
 * that recorded "read of task 'Charlie: dentist forms'" would put a child's
 * business into a table read by a different set of people than the task itself.
 */
describe('child assignment audit (US2, FR-015, SC-011)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let home: Household;
  let taskId: string;

  const rowsFor = (subjectId: string) =>
    readAuditLogRows(resolvedTestDatabaseOwnerUrl(), subjectId);

  const taskReads = (rows: Awaited<ReturnType<typeof rowsFor>>) =>
    rows.filter((row) => row.action === 'task_assignment.read');

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTasksApp());
    home = await buildHousehold(server, mailer);
    taskId = (
      await createTask(server, home.familyId, home.ada, {
        title: TITLE,
        assigneeIds: [home.charlieId],
      })
    ).taskId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('writes one granted row per guarded child on a guardian’s direct read', async () => {
    const before = taskReads(await rowsFor(home.charlieId)).length;
    expect((await getTask(server, home.familyId, home.ada, taskId)).status).toBe(200);

    const rows = taskReads(await rowsFor(home.charlieId));
    expect(rows.length).toBe(before + 1);

    const latest = rows.at(-1);
    expect(latest).toMatchObject({
      subjectType: 'family_member',
      subjectId: home.charlieId,
      action: 'task_assignment.read',
      result: 'granted',
      actorMemberId: home.ada.memberId,
      familyId: home.familyId,
      reason: null,
    });
    expect(latest?.purpose).toContain(taskId);
  });

  it('writes one denied row, carrying the real reason the caller never sees', async () => {
    const before = taskReads(await rowsFor(home.charlieId)).length;
    expect((await getTask(server, home.familyId, home.grace, taskId)).status).toBe(404);

    const rows = taskReads(await rowsFor(home.charlieId));
    expect(rows.length).toBe(before + 1);

    const latest = rows.at(-1);
    expect(latest).toMatchObject({
      subjectId: home.charlieId,
      result: 'denied',
      actorMemberId: home.grace.memberId,
    });
    // The wire said only "not found"; the audit log holds the difference.
    expect(latest?.reason).toMatch(/guardianship/i);
  });

  it('audits once per task returned on a list, not once per page', async () => {
    const second = await createTask(server, home.familyId, home.ada, {
      title: 'Charlie: swimming kit',
      assigneeIds: [home.charlieId],
    });
    expect(second.taskId).not.toBe(taskId);

    const before = taskReads(await rowsFor(home.charlieId)).length;
    const { status, body } = await listOpenTasks(server, home.familyId, home.ada, { limit: 200 });
    expect(status).toBe(200);

    const charliesTasks = body.items.filter((t) => t.assigneeIds.includes(home.charlieId));
    expect(charliesTasks.length).toBe(2);

    const rows = taskReads(await rowsFor(home.charlieId));
    // Two of Charlie's tasks came back, so two rows — not one for the page,
    // and not one per item in the whole page.
    expect(rows.length).toBe(before + charliesTasks.length);
  });

  it('names the task by identifier only — never by title — in any purpose', async () => {
    await getTask(server, home.familyId, home.ada, taskId);
    await listOpenTasks(server, home.familyId, home.ada, { limit: 200 });

    const rows = taskReads(await rowsFor(home.charlieId));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.purpose, row.purpose).not.toContain(TITLE);
      expect(row.purpose, row.purpose).not.toContain('dentist');
      expect(row.purpose, row.purpose).not.toContain('swimming');
    }
  });

  it('writes no row at all for a task with no child assignee', async () => {
    const adultOnly = await createTask(server, home.familyId, home.ada, {
      title: 'Adults only',
      assigneeIds: [home.grace.memberId],
    });

    const before = taskReads(await rowsFor(home.grace.memberId)).length;
    expect((await getTask(server, home.familyId, home.ada, adultOnly.taskId)).status).toBe(200);
    expect(taskReads(await rowsFor(home.grace.memberId)).length).toBe(before);
  });

  it('audits each guarded child separately on a task assigned to two', async () => {
    const danaId = await addChild(server, home.familyId, home.ada, 'Dana');
    const joint = await createTask(server, home.familyId, home.ada, {
      title: 'Both children',
      assigneeIds: [home.charlieId, danaId],
    });

    const beforeCharlie = taskReads(await rowsFor(home.charlieId)).length;
    const beforeDana = taskReads(await rowsFor(danaId)).length;

    expect((await getTask(server, home.familyId, home.ada, joint.taskId)).status).toBe(200);

    expect(taskReads(await rowsFor(home.charlieId)).length).toBe(beforeCharlie + 1);
    expect(taskReads(await rowsFor(danaId)).length).toBe(beforeDana + 1);
  });
});
