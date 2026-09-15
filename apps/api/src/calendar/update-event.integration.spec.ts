import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeTo, withDatabase } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapCalendarApp } from './test-support/bootstrap-calendar-app.js';
import {
  buildHousehold,
  createEvent,
  listOccurrences,
  timedEvent,
  type Household,
} from './test-support/household.js';

const RANGE = ['2026-09-14T00:00:00Z', '2026-10-14T00:00:00Z'] as const;

describe('PATCH /v1/families/:familyId/events/:eventId (US4, FR-019, FR-020)', () => {
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

  const patch = (eventId: string, body: Record<string, unknown>, caller = home.ada) =>
    request(server)
      .patch(`/v1/families/${home.familyId}/events/${eventId}`)
      .set('Authorization', `Bearer ${caller.token}`)
      .send(body);

  it('changes title, location, category and participants — by a writer who did not author it — and publishes EventUpdated', async () => {
    const eventId = await createEvent(server, home.familyId, home.ada, timedEvent());

    const response = await patch(
      eventId,
      {
        title: 'Orthodontist',
        location: 'High St',
        category: 'medical',
        participants: [home.grace.memberId],
      },
      home.alan,
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      title: 'Orthodontist',
      location: 'High St',
      category: 'medical',
      participants: [home.grace.memberId],
    });

    const outbox = await withDatabase((tx) =>
      tx.outboxEvent.findMany({
        where: { aggregateId: eventId, eventType: 'calendar.EventUpdated.v1' },
      }),
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.payload).toMatchObject({
      changed: expect.arrayContaining(['details', 'participants']) as unknown,
    });
  });

  it('a rule change rebuilds occurrences: none contradicting the new rule survive, and shared instants keep their ids', async () => {
    const eventId = await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({
        title: 'Swimming',
        startsAt: '2026-09-15T15:00:00Z',
        endsAt: '2026-09-15T16:00:00Z',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU',
      }),
    );
    const before = (await listOccurrences(server, home.familyId, home.ada, ...RANGE)).body.filter(
      (o) => o.eventId === eventId,
    );
    expect(before.length).toBeGreaterThanOrEqual(4);

    // Tuesdays AND Thursdays: every Tuesday is shared, so every Tuesday row survives as itself.
    expect((await patch(eventId, { recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU,TH' })).status).toBe(200);
    const grown = (await listOccurrences(server, home.familyId, home.ada, ...RANGE)).body.filter(
      (o) => o.eventId === eventId,
    );
    const tuesdays = grown.filter((o) => new Date(o.startsAt).getUTCDay() === 2);
    expect(tuesdays.map((o) => o.occurrenceId)).toEqual(before.map((o) => o.occurrenceId));
    expect(grown.some((o) => new Date(o.startsAt).getUTCDay() === 4)).toBe(true);

    // Thursdays only: no Tuesday may remain anywhere in the horizon (SC-005).
    expect((await patch(eventId, { recurrenceRule: 'FREQ=WEEKLY;BYDAY=TH' })).status).toBe(200);
    const remaining = await withDatabase(async (tx) => {
      await scopeTo(tx, home.familyId);
      return tx.eventOccurrence.findMany({ where: { eventId } });
    });
    expect(remaining.length).toBeGreaterThan(50);
    expect(remaining.every((o) => o.startsAt.getUTCDay() === 4)).toBe(true);
  });

  it('removing the rule leaves exactly one occurrence, the event’s own', async () => {
    const eventId = await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({
        startsAt: '2026-09-16T08:00:00Z',
        endsAt: '2026-09-16T08:30:00Z',
        recurrenceRule: 'FREQ=DAILY',
      }),
    );
    expect((await patch(eventId, { recurrenceRule: null })).status).toBe(200);
    const rows = await withDatabase(async (tx) => {
      await scopeTo(tx, home.familyId);
      return tx.eventOccurrence.findMany({ where: { eventId } });
    });
    expect(rows.map((o) => o.startsAt.toISOString())).toEqual(['2026-09-16T08:00:00.000Z']);
  });

  it('refuses a patch that breaks an invariant, with the same types as creation, and changes nothing', async () => {
    const eventId = await createEvent(server, home.familyId, home.ada, timedEvent());

    const inverted = await patch(eventId, { endsAt: '2026-09-20T08:00:00Z' });
    expect(inverted.status).toBe(422);
    expect(inverted.body).toMatchObject({ type: 'calendar/invalid_time_range' });

    const zone = await patch(eventId, { timeZone: 'Mars/Olympus_Mons' });
    expect(zone.body).toEqual({ type: 'calendar/unknown_time_zone' });

    const read = await request(server)
      .get(`/v1/families/${home.familyId}/events/${eventId}`)
      .set('Authorization', `Bearer ${home.ada.token}`);
    expect(read.body).toMatchObject({
      endsAt: '2026-09-20T09:30:00.000Z',
      timeZone: 'Europe/London',
    });
  });

  it('a rule edited to produce nothing is accepted, and differs from a cancellation', async () => {
    const eventId = await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({
        startsAt: '2026-09-15T15:00:00Z',
        endsAt: '2026-09-15T16:00:00Z',
        recurrenceRule: 'FREQ=WEEKLY',
      }),
    );
    const response = await patch(eventId, {
      recurrenceRule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'confirmed' });
    const range = await listOccurrences(server, home.familyId, home.ada, ...RANGE);
    expect(range.body.filter((o) => o.eventId === eventId)).toEqual([]);
  });
});
