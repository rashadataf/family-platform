import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeTo, withDatabaseCommitted } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import type { AuthenticatedCaller } from '../family/test-support/register-and-login.js';
import { bootstrapCalendarApp } from './test-support/bootstrap-calendar-app.js';
import {
  buildHousehold,
  createEvent,
  listOccurrences,
  timedEvent,
  type Household,
} from './test-support/household.js';

/**
 * THE test User Story 2 exists for (FR-016, SC-011). An event with a child
 * participant reaches that child's guardians and nobody else — not an adult
 * member, not the owner — and to everybody else it does not exist: `404`, not
 * `403`, and absent from the range with no trace in the count.
 */
describe('events involving a child are invisible to non-guardians (FR-016, SC-011)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let home: Household;
  let nurseryEventId: string;

  const RANGE = ['2026-09-21T00:00:00Z', '2026-09-23T00:00:00Z'] as const;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapCalendarApp());
    home = await buildHousehold(server, mailer);

    // Background the family can all see, so "the count" is not trivially zero.
    await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({
        title: 'Bins',
        startsAt: '2026-09-22T07:00:00Z',
        endsAt: '2026-09-22T07:15:00Z',
      }),
    );
    await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({
        title: 'Parents evening',
        startsAt: '2026-09-22T18:00:00Z',
        endsAt: '2026-09-22T19:00:00Z',
        participants: [home.grace.memberId],
      }),
    );

    nurseryEventId = await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({
        title: 'Nursery settling-in',
        startsAt: '2026-09-22T09:00:00Z',
        endsAt: '2026-09-22T10:00:00Z',
        participants: [home.charlieId],
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const read = (caller: AuthenticatedCaller, eventId = nurseryEventId) =>
    request(server)
      .get(`/v1/families/${home.familyId}/events/${eventId}`)
      .set('Authorization', `Bearer ${caller.token}`);

  it('a guardian reads the child’s event: 200', async () => {
    const response = await read(home.ada);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      eventId: nurseryEventId,
      participants: [home.charlieId],
    });
  });

  it('a non-guardian adult with calendar:read gets 404 calendar/not_found — NOT 403', async () => {
    const response = await read(home.grace);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ type: 'calendar/not_found' });

    // Byte-for-byte the answer for an event that has never existed.
    const missing = await read(home.grace, crypto.randomUUID());
    expect(response.body).toEqual(missing.body);
  });

  it('an extended member who guards nobody gets 404', async () => {
    expect((await read(home.alan)).status).toBe(404);
  });

  it('role is not the control, in either direction: an owner who is not a guardian is denied, a viewer who is one is allowed', async () => {
    // Grace adds a child, becoming its only guardian. Ada, the OWNER, does not guard it.
    const addChild = await request(server)
      .post(`/v1/families/${home.familyId}/members`)
      .set('Authorization', `Bearer ${home.grace.token}`)
      .send({ kind: 'child', displayName: 'Dana' });
    const danaId = (addChild.body as { memberId: string }).memberId;
    const danaEvent = await createEvent(
      server,
      home.familyId,
      home.grace,
      timedEvent({ title: 'Swim', participants: [danaId] }),
    );

    const ownerRead = await read(home.ada, danaEvent);
    expect(ownerRead.status).toBe(404);

    expect((await read(home.vera, danaEvent)).status).toBe(404);
    expect((await read(home.grace, danaEvent)).status).toBe(200);

    // The other direction. Spec 008 makes a viewer an INELIGIBLE guardian, so
    // no route will create this relationship — the row is seeded directly,
    // because what is under test is that Calendar's filter reads guardianship
    // and never role. With it, the least-privileged role reads the event.
    await withDatabaseCommitted(async (tx) => {
      await scopeTo(tx, home.familyId);
      await tx.guardianship.create({
        data: {
          familyId: home.familyId,
          guardianMemberId: home.vera.memberId,
          childMemberId: danaId,
        },
      });
    });
    expect((await read(home.vera, danaEvent)).status).toBe(200);
  });

  it('the range omits the child’s event for a non-guardian, and its COUNT is what it would be if the event did not exist', async () => {
    const guardianView = await listOccurrences(server, home.familyId, home.ada, ...RANGE);
    const nonGuardianView = await listOccurrences(server, home.familyId, home.grace, ...RANGE);

    expect(guardianView.body.map((o) => o.eventId)).toContain(nurseryEventId);
    expect(nonGuardianView.body.map((o) => o.eventId)).not.toContain(nurseryEventId);
    // The numeric assertion FR-016's "or infer its existence" demands.
    expect(nonGuardianView.body.length).toBe(guardianView.body.length - 1);
    expect(nonGuardianView.body.map((o) => o.title).sort()).toEqual(['Bins', 'Parents evening']);
  });

  it('hides an event with two children entirely from someone who guards only one of them', async () => {
    const addChild = await request(server)
      .post(`/v1/families/${home.familyId}/members`)
      .set('Authorization', `Bearer ${home.grace.token}`)
      .send({ kind: 'child', displayName: 'Eli' });
    const eliId = (addChild.body as { memberId: string }).memberId;

    const both = await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({
        title: 'Joint party',
        startsAt: '2026-09-22T15:00:00Z',
        endsAt: '2026-09-22T17:00:00Z',
        participants: [home.charlieId, eliId],
      }),
    );

    // Ada guards Charlie but not Eli; Grace guards Eli but not Charlie.
    expect((await read(home.ada, both)).status).toBe(404);
    expect((await read(home.grace, both)).status).toBe(404);
    const adaRange = await listOccurrences(server, home.familyId, home.ada, ...RANGE);
    expect(adaRange.body.map((o) => o.eventId)).not.toContain(both);
  });

  it('evaluates guardianship at read time: granted → 200, ended → 404 on the very next request', async () => {
    const grant = await request(server)
      .post(`/v1/families/${home.familyId}/members/${home.charlieId}/guardians`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send({ guardianMemberId: home.grace.memberId });
    expect(grant.status).toBe(201);
    expect((await read(home.grace)).status).toBe(200);

    const end = await request(server)
      .delete(
        `/v1/families/${home.familyId}/members/${home.charlieId}/guardians/${home.grace.memberId}`,
      )
      .set('Authorization', `Bearer ${home.ada.token}`);
    expect(end.status).toBe(200);
    expect((await read(home.grace)).status).toBe(404);
  });

  it('a non-guardian cannot probe the event through its write routes either', async () => {
    const auth = `Bearer ${home.grace.token}`;
    const patch = await request(server)
      .patch(`/v1/families/${home.familyId}/events/${nurseryEventId}`)
      .set('Authorization', auth)
      .send({ title: 'probe' });
    const cancel = await request(server)
      .post(`/v1/families/${home.familyId}/events/${nurseryEventId}/cancel`)
      .set('Authorization', auth);

    expect(patch.status).toBe(404);
    expect(cancel.status).toBe(404);
    expect((await read(home.ada)).body).toMatchObject({
      title: 'Nursery settling-in',
      status: 'confirmed',
    });
  });
});
