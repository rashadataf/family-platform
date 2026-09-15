import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAuditLogRows, resolvedTestDatabaseOwnerUrl } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapCalendarApp } from './test-support/bootstrap-calendar-app.js';
import {
  buildHousehold,
  createEvent,
  listOccurrences,
  timedEvent,
  type Household,
} from './test-support/household.js';

/**
 * FR-017, Principle VI: every permitted read of a child's participation is
 * audited, and so is every denial — at event granularity, never per
 * occurrence, with the child as the subject.
 */
describe('auditing reads of a child’s participation (FR-017, SC-007)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let home: Household;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapCalendarApp());
    home = await buildHousehold(server, mailer);
  });

  afterAll(async () => {
    await app.close();
  });

  it('writes exactly one row for a granted read and one for a denied read, naming actor, child and outcome', async () => {
    // A fresh child, so the audit rows under its id are this test's alone.
    const addChild = await request(server)
      .post(`/v1/families/${home.familyId}/members`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send({ kind: 'child', displayName: 'Audited' });
    const childId = (addChild.body as { memberId: string }).memberId;
    const eventId = await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({ participants: [childId] }),
    );

    const granted = await request(server)
      .get(`/v1/families/${home.familyId}/events/${eventId}`)
      .set('Authorization', `Bearer ${home.ada.token}`);
    const denied = await request(server)
      .get(`/v1/families/${home.familyId}/events/${eventId}`)
      .set('Authorization', `Bearer ${home.grace.token}`);
    expect(granted.status).toBe(200);
    expect(denied.status).toBe(404);

    const rows = await readAuditLogRows(resolvedTestDatabaseOwnerUrl(), childId);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.result === 'granted')).toMatchObject({
      actorMemberId: home.ada.memberId,
      familyId: home.familyId,
      subjectType: 'family_member',
      subjectId: childId,
      action: 'calendar_participation.read',
      reason: null,
    });
    const deniedRow = rows.find((row) => row.result === 'denied');
    expect(deniedRow).toMatchObject({ actorMemberId: home.grace.memberId, subjectId: childId });
    expect(deniedRow?.reason).toMatch(/guardianship/);
    // Identifiers only: the purpose names the event by id, never by title.
    expect(deniedRow?.purpose).toContain(eventId);
    expect(deniedRow?.purpose).not.toContain('Dentist');
  });

  it('audits a range read once per event, not once per occurrence', async () => {
    const addChild = await request(server)
      .post(`/v1/families/${home.familyId}/members`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send({ kind: 'child', displayName: 'Weekly' });
    const childId = (addChild.body as { memberId: string }).memberId;
    await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({
        title: 'Swimming',
        startsAt: '2026-09-15T15:00:00Z',
        endsAt: '2026-09-15T16:00:00Z',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU',
        participants: [childId],
      }),
    );

    const range = await listOccurrences(
      server,
      home.familyId,
      home.ada,
      '2026-09-14T00:00:00Z',
      '2026-10-14T00:00:00Z',
    );
    expect(
      range.body.filter((o) => o.participants.includes(childId)).length,
    ).toBeGreaterThanOrEqual(4);

    await listOccurrences(
      server,
      home.familyId,
      home.grace,
      '2026-09-14T00:00:00Z',
      '2026-10-14T00:00:00Z',
    );

    const rows = await readAuditLogRows(resolvedTestDatabaseOwnerUrl(), childId);
    expect(rows.map((row) => row.result).sort()).toEqual(['denied', 'granted']);
  });
});
