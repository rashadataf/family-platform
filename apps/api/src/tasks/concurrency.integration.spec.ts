import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDatabase } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapTasksApp } from './test-support/bootstrap-tasks-app.js';
import {
  addChild,
  buildHousehold,
  completeTask,
  createTask,
  patchTask,
  type Household,
} from './test-support/household.js';

async function completedEvents(taskId: string) {
  const rows = await withDatabase((tx) =>
    tx.outboxEvent.findMany({ where: { aggregateId: taskId } }),
  );
  return rows.filter((row) => row.eventType === 'tasks.TaskCompleted.v1');
}

/**
 * The race the spec names as this feature's characteristic failure: two people
 * ticking the same chore off at the same moment. The row lock and the `version`
 * check have to make exactly one of them the winner — and publish exactly one
 * `TaskCompleted`, because a duplicate would later become a duplicate reminder.
 */
describe('concurrent transitions (US3, FR-011, SC-005)', () => {
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

  it('gives exactly one 200 and one 409 to two completions at the same version', async () => {
    const task = await createTask(server, home.familyId, home.ada, { title: 'Contested chore' });

    const [a, b] = await Promise.all([
      completeTask(server, home.familyId, home.ada, task.taskId, task.version),
      completeTask(server, home.familyId, home.grace, task.taskId, task.version),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = a.status === 409 ? a : b;
    expect(loser.body).toMatchObject({ type: 'task/version_conflict' });

    // The assertion that matters: one state change, one event.
    expect(await completedEvents(task.taskId)).toHaveLength(1);
  });

  it('survives five simultaneous completions with one winner and one event', async () => {
    const task = await createTask(server, home.familyId, home.ada, { title: 'Five at once' });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        completeTask(server, home.familyId, home.ada, task.taskId, task.version),
      ),
    );

    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await completedEvents(task.taskId)).toHaveLength(1);
  });

  it('serialises two concurrent edits the same way', async () => {
    const task = await createTask(server, home.familyId, home.ada, { title: 'Contested edit' });

    const [a, b] = await Promise.all([
      patchTask(server, home.familyId, home.ada, task.taskId, {
        expectedVersion: task.version,
        title: 'Ada won',
      }),
      patchTask(server, home.familyId, home.grace, task.taskId, {
        expectedVersion: task.version,
        title: 'Grace won',
      }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  /**
   * Visibility is resolved BEFORE the version is compared, so a 409 can never
   * confirm that a task the caller may not see exists (contracts/tasks-api.md).
   */
  it('answers 404, not 409, for a hidden task with a stale expectedVersion', async () => {
    const danaId = await addChild(server, home.familyId, home.grace, 'Dana');
    const hidden = await createTask(server, home.familyId, home.grace, {
      title: 'Dana: hidden chore',
      assigneeIds: [danaId],
    });

    // Grace guards Dana; Ada does not. A deliberately stale version.
    const response = await completeTask(
      server,
      home.familyId,
      home.ada,
      hidden.taskId,
      hidden.version + 99,
    );
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ type: 'task/not_found' });
    expect(JSON.stringify(response.body)).not.toContain('currentVersion');
  });

  it('answers 404 for a hidden task even with the CORRECT version', async () => {
    const danaId = await addChild(server, home.familyId, home.grace, 'Dana Two');
    const hidden = await createTask(server, home.familyId, home.grace, {
      title: 'Dana: another hidden chore',
      assigneeIds: [danaId],
    });

    const response = await patchTask(server, home.familyId, home.ada, hidden.taskId, {
      expectedVersion: hidden.version,
      title: 'probe',
    });
    expect(response.status).toBe(404);
  });
});
