import type { Server } from 'node:http';
import type { INestApplication, LoggerService } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAuditLogRows, resolvedTestDatabaseOwnerUrl, withDatabase } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapTasksApp } from './test-support/bootstrap-tasks-app.js';
import {
  addChild,
  assign,
  buildHousehold,
  cancelTask,
  completeTask,
  createTask,
  dateDue,
  getTask,
  listOpenTasks,
  listTaskHistory,
  patchTask,
  reopenTask,
  required,
  type CloseBody,
  type Household,
  type TaskBody,
} from './test-support/household.js';

/** Captures every message Nest's `Logger` receives, at every level. */
class CapturingLogger implements LoggerService {
  readonly messages: string[] = [];
  private capture(message: unknown, ...rest: unknown[]): void {
    this.messages.push(
      [message, ...rest]
        .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
        .join(' '),
    );
  }
  log(message: unknown, ...rest: unknown[]): void {
    this.capture(message, ...rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.capture(message, ...rest);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.capture(message, ...rest);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.capture(message, ...rest);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.capture(message, ...rest);
  }
}

/**
 * The free text this suite hunts for. Distinctive enough that a substring
 * match cannot succeed by accident.
 */
const TITLE = 'Buy Charlie a trombone for the recital';
const NOTES = 'Ask Grandma Hopper whether she still has the old one in her attic';
const CHILD_TITLE = 'Charlie: practise the trombone before Tuesday';

/**
 * SC-011, exercised through the real routes rather than trusted to
 * `events.spec.ts` alone. Tasks holds a title and 4,000 characters of notes —
 * the most free text of any context so far — and the promise is that none of it
 * reaches a log line, an audit `purpose`, or an outbox payload.
 *
 * Every route that could leak it is exercised, including the observability
 * signals spec 010 added (`tasks_list_duration`,
 * `tasks_successor_spawned_total`, `tasks_transition_conflict_total`,
 * `tasks_child_assignment_read_total`), because a counter assembled from a
 * response body is exactly how a title ends up in a metrics label.
 */
describe('SC-011: no task title or notes in a log line, an audit purpose or an outbox payload', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let logger: CapturingLogger;
  let home: Household;
  let childId: string;

  beforeAll(async () => {
    logger = new CapturingLogger();
    ({ app, server, mailer } = await bootstrapTasksApp({ logger }));
    home = await buildHousehold(server, mailer);
    childId = await addChild(server, home.familyId, home.grace, 'Dana');
  });

  afterAll(async () => {
    await app.close();
  });

  /** Every fragment of free text this suite writes, for one sweep of assertions. */
  const SECRETS = [TITLE, NOTES, CHILD_TITLE, 'trombone', 'Grandma', 'Hopper', 'recital', 'attic'];

  it('exercises every route that touches free text and leaves none of it in telemetry', async () => {
    // Create, with a title and notes.
    const task = await createTask(server, home.familyId, home.ada, {
      title: TITLE,
      notes: NOTES,
      due: dateDue('2026-09-20'),
      priority: 'high',
      category: 'school',
    });

    // Patch both fields.
    const patched = await patchTask(server, home.familyId, home.ada, task.taskId, {
      expectedVersion: task.version,
      title: `${TITLE} (revised)`,
      notes: `${NOTES} — revised`,
    });
    expect(patched.status).toBe(200);

    // A refused write, so the 422 path logs too.
    const refused = await request(server)
      .post(`/v1/families/${home.familyId}/tasks`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send({ title: TITLE, due: { kind: 'date', date: '2026-02-30', timeZone: 'Europe/London' } });
    expect(refused.status).toBe(422);

    // A version conflict, which emits tasks_transition_conflict_total.
    const stale = await patchTask(server, home.familyId, home.ada, task.taskId, {
      expectedVersion: task.version,
      title: TITLE,
    });
    expect(stale.status).toBe(409);

    // A recurring head, completed — so a successor is spawned and counted.
    const recurring = await createTask(server, home.familyId, home.ada, {
      title: TITLE,
      notes: NOTES,
      due: dateDue('2026-09-17'),
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=TH',
    });
    const closed = await completeTask(
      server,
      home.familyId,
      home.ada,
      recurring.taskId,
      recurring.version,
    );
    expect(closed.status).toBe(200);
    const successor = required((closed.body as CloseBody).successor, 'a successor');

    // Reopen and cancel, for the remaining transition log lines.
    const reopened = await reopenTask(
      server,
      home.familyId,
      home.ada,
      recurring.taskId,
      (closed.body as CloseBody).task.version,
    );
    expect(reopened.status).toBe(200);
    await cancelTask(
      server,
      home.familyId,
      home.ada,
      successor.taskId,
      successor.version,
      'series',
    );

    // A child's task, read by a guardian and by a non-guardian — the
    // tasks_child_assignment_read_total paths, granted and denied.
    const childTask = await createTask(server, home.familyId, home.grace, {
      title: CHILD_TITLE,
      notes: NOTES,
      assigneeIds: [childId],
    });
    await assign(server, home.familyId, home.grace, childTask.taskId, childId);
    expect((await getTask(server, home.familyId, home.grace, childTask.taskId)).status).toBe(200);
    expect((await getTask(server, home.familyId, home.ada, childTask.taskId)).status).toBe(404);

    // Both lists, and the history range.
    await listOpenTasks(server, home.familyId, home.ada, { limit: 200 });
    await listOpenTasks(server, home.familyId, home.grace, { limit: 200 });
    await listTaskHistory(server, home.familyId, home.ada, {
      from: '2026-09-01T00:00:00Z',
      to: '2026-10-01T00:00:00Z',
    });

    // ---- The assertions ----

    expect(logger.messages.length).toBeGreaterThan(0);
    const allLogs = logger.messages.join('\n');
    for (const secret of SECRETS) {
      expect(allLogs, `log line carries "${secret}"`).not.toContain(secret);
    }

    // The observability signals the feature added are actually present, so the
    // check above is not passing merely because nothing was logged.
    expect(allLogs).toContain('tasks_list_duration_ms=');
    expect(allLogs).toContain('tasks_successor_spawned_total');
    expect(allLogs).toContain('tasks_transition_conflict_total');
    expect(allLogs).toContain('tasks_child_assignment_read_total');

    // Outbox payloads.
    const outbox = await withDatabase((tx) =>
      tx.outboxEvent.findMany({ where: { aggregateType: 'Task' } }),
    );
    expect(outbox.length).toBeGreaterThan(0);
    const payloads = JSON.stringify(outbox.map((row) => row.payload));
    for (const secret of SECRETS) {
      expect(payloads, `outbox payload carries "${secret}"`).not.toContain(secret);
    }

    // Audit purposes, for the child whose task carries the free text.
    const auditRows = await readAuditLogRows(resolvedTestDatabaseOwnerUrl(), childId);
    expect(auditRows.length).toBeGreaterThan(0);
    const purposes = auditRows.map((row) => `${row.purpose} ${row.reason ?? ''}`).join('\n');
    for (const secret of SECRETS) {
      expect(purposes, `audit purpose carries "${secret}"`).not.toContain(secret);
    }
  });

  it('emits the conflict counter with a type label, not a task title', async () => {
    const task = await createTask(server, home.familyId, home.ada, { title: TITLE });
    await patchTask(server, home.familyId, home.ada, task.taskId, {
      expectedVersion: task.version,
      title: 'First',
    });
    const stale = await patchTask(server, home.familyId, home.ada, task.taskId, {
      expectedVersion: task.version,
      title: 'Second',
    });
    expect(stale.status).toBe(409);

    const conflictLines = logger.messages.filter((line) =>
      line.includes('tasks_transition_conflict_total'),
    );
    expect(conflictLines.length).toBeGreaterThan(0);
    expect(conflictLines.join('\n')).toContain('type=version_conflict');
    for (const line of conflictLines) {
      expect(line).not.toContain(TITLE);
    }
  });

  it('emits an invalid_transition conflict distinctly from a version conflict', async () => {
    const task = await createTask(server, home.familyId, home.ada, { title: TITLE });
    const closed = await cancelTask(server, home.familyId, home.ada, task.taskId, task.version);
    const version = (closed.body as CloseBody).task.version;

    const refused = await reopenTask(server, home.familyId, home.ada, task.taskId, version);
    expect(refused.status).toBe(409);

    expect(
      logger.messages.filter((line) => line.includes('type=invalid_transition')).length,
    ).toBeGreaterThan(0);
  });

  it('never logs a task title even when a write is refused', async () => {
    const response = await request(server)
      .post(`/v1/families/${home.familyId}/tasks`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send({ title: TITLE, recurrenceRule: 'FREQ=WEEKLY' });
    expect(response.status).toBe(422);

    const rejectionLines = logger.messages.filter((line) => line.includes('rejected'));
    expect(rejectionLines.length).toBeGreaterThan(0);
    for (const line of rejectionLines) {
      expect(line).not.toContain(TITLE);
      // It names the reason, by kind, which is the useful part.
      expect(line).toMatch(/Task creation rejected: \w+/);
    }
  });

  it('puts no title in a task response’s own version-conflict body', async () => {
    const task = await createTask(server, home.familyId, home.ada, { title: TITLE });
    await patchTask(server, home.familyId, home.ada, task.taskId, {
      expectedVersion: task.version,
      title: 'Moved on',
    });
    const stale = await patchTask(server, home.familyId, home.ada, task.taskId, {
      expectedVersion: task.version,
      title: 'Nope',
    });

    expect(stale.status).toBe(409);
    expect(JSON.stringify(stale.body)).not.toContain(TITLE);
  });

  it('returns the title to the caller who asked for it — the leak test is not a gag', async () => {
    const task = await createTask(server, home.familyId, home.ada, {
      title: TITLE,
      notes: NOTES,
    });
    const read = await getTask(server, home.familyId, home.ada, task.taskId);
    expect(read.status).toBe(200);
    expect((read.body as TaskBody).title).toBe(TITLE);
    expect((read.body as TaskBody).notes).toBe(NOTES);
  });
});
