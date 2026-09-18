import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDatabase } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapTasksApp } from './test-support/bootstrap-tasks-app.js';
import {
  buildHousehold,
  completeTask,
  createTask,
  dateDue,
  getTask,
  unassign,
  type CloseBody,
  type Household,
} from './test-support/household.js';

async function eventTypes(taskId: string) {
  const rows = await withDatabase((tx) =>
    tx.outboxEvent.findMany({ where: { aggregateId: taskId } }),
  );
  return rows.map((row) => row.eventType);
}

describe('assignees carried to the successor (US4, FR-021)', () => {
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

  const recurringAssigned = (title: string, assigneeIds: string[]) =>
    createTask(server, home.familyId, home.ada, {
      title,
      due: dateDue('2026-09-17'),
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=TH',
      assigneeIds,
    });

  it('copies every assignee to the successor', async () => {
    const task = await recurringAssigned('Bins, shared', [home.grace.memberId, home.alan.memberId]);
    const closed = await completeTask(server, home.familyId, home.ada, task.taskId, task.version);

    const successor = (closed.body as CloseBody).successor;
    expect(successor).not.toBeNull();
    expect(successor?.assigneeIds.sort()).toEqual([home.grace.memberId, home.alan.memberId].sort());
  });

  it('copies a child assignee too, keeping the successor guardian-filtered', async () => {
    const task = await recurringAssigned("Charlie's bins", [home.charlieId]);
    const closed = await completeTask(server, home.familyId, home.ada, task.taskId, task.version);
    const successor = (closed.body as CloseBody).successor;
    expect(successor?.assigneeIds).toEqual([home.charlieId]);

    // Ada guards Charlie and sees it; Grace does not guard him and cannot.
    expect((await getTask(server, home.familyId, home.ada, successor?.taskId ?? '')).status).toBe(
      200,
    );
    expect((await getTask(server, home.familyId, home.grace, successor?.taskId ?? '')).status).toBe(
      404,
    );
  });

  /**
   * research.md §7: nobody assigned anything, so there is nothing to announce —
   * and `TaskCreated` already carries `predecessorId`, from which a consumer can
   * infer the carried assignees without a second event per person.
   */
  it('writes no TaskAssigned for copied assignments', async () => {
    const task = await recurringAssigned('Quietly carried', [home.grace.memberId]);
    const closed = await completeTask(server, home.familyId, home.ada, task.taskId, task.version);
    const successor = (closed.body as CloseBody).successor;
    expect(successor).not.toBeNull();
    if (successor === null) return;

    const types = await eventTypes(successor.taskId);
    expect(types).toEqual(['tasks.TaskCreated.v1']);
    expect(types).not.toContain('tasks.TaskAssigned.v1');
  });

  it('leaves the predecessor’s assignees intact when the successor loses one', async () => {
    const task = await recurringAssigned('Independent assignees', [
      home.grace.memberId,
      home.alan.memberId,
    ]);
    const closed = await completeTask(server, home.familyId, home.ada, task.taskId, task.version);
    const successor = (closed.body as CloseBody).successor;
    expect(successor).not.toBeNull();
    if (successor === null) return;

    const removed = await unassign(
      server,
      home.familyId,
      home.ada,
      successor.taskId,
      home.grace.memberId,
    );
    expect(removed.status).toBe(200);
    expect((removed.body as { assigneeIds: string[] }).assigneeIds).toEqual([home.alan.memberId]);

    // The closed predecessor still records who it was for at the time.
    const predecessor = await getTask(server, home.familyId, home.ada, task.taskId);
    expect(predecessor.status).toBe(200);
    expect(predecessor.body.assigneeIds.sort()).toEqual(
      [home.grace.memberId, home.alan.memberId].sort(),
    );
  });

  it('carries an empty assignee list forward as empty', async () => {
    const task = await recurringAssigned('Nobody in particular', []);
    const closed = await completeTask(server, home.familyId, home.ada, task.taskId, task.version);
    expect((closed.body as CloseBody).successor?.assigneeIds).toEqual([]);
  });
});
