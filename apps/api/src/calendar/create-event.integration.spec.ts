import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDatabase } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapCalendarApp } from './test-support/bootstrap-calendar-app.js';
import {
  buildHousehold,
  listOccurrences,
  timedEvent,
  type Household,
} from './test-support/household.js';

describe('POST /v1/families/:familyId/events (US1, FR-001–FR-005)', () => {
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

  const post = (body: Record<string, unknown>, key?: string) => {
    const call = request(server)
      .post(`/v1/families/${home.familyId}/events`)
      .set('Authorization', `Bearer ${home.ada.token}`);
    return (key === undefined ? call : call.set('Idempotency-Key', key)).send(body);
  };

  it('creates a timed event, scoped to the family, and publishes EventCreated (Scenario 1)', async () => {
    const response = await post(timedEvent());
    expect(response.status).toBe(201);
    const { eventId } = response.body as { eventId: string };

    const outbox = await withDatabase((tx) =>
      tx.outboxEvent.findMany({ where: { aggregateId: eventId } }),
    );
    expect(outbox.map((row) => row.eventType)).toEqual(['calendar.EventCreated.v1']);
    expect(outbox[0]?.payload).toMatchObject({
      familyId: home.familyId,
      eventId,
      kind: 'timed',
      recurring: false,
    });
  });

  it('rejects an end before the start with 422 calendar/invalid_time_range and a reason (Scenario 5)', async () => {
    const response = await post(
      timedEvent({ startsAt: '2026-09-20T10:00:00Z', endsAt: '2026-09-20T09:00:00Z' }),
    );
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ type: 'calendar/invalid_time_range' });
    expect((response.body as { reason: string }).reason).toMatch(/ends before it starts/);
  });

  it('rejects an unrecognised IANA zone with 422 calendar/unknown_time_zone, never defaulting (Scenario 6)', async () => {
    const response = await post(timedEvent({ timeZone: 'Europe/Londn' }));
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ type: 'calendar/unknown_time_zone' });
  });

  it('refuses an all-day body carrying a start time as a malformed request (the union is strict)', async () => {
    const response = await post({
      kind: 'all_day',
      title: 'Birthday',
      startDate: '2027-03-03',
      endDate: '2027-03-03',
      startsAt: '2027-03-03T09:00:00Z',
      timeZone: 'Europe/London',
    });
    expect(response.status).toBe(400);
  });

  it('records a location and a category, requiring neither (FR-005)', async () => {
    const bare = await post(timedEvent());
    expect(bare.status).toBe(201);

    const rich = await post(timedEvent({ location: '12 High Street', category: 'medical' }));
    const read = await request(server)
      .get(`/v1/families/${home.familyId}/events/${(rich.body as { eventId: string }).eventId}`)
      .set('Authorization', `Bearer ${home.ada.token}`);
    expect(read.body).toMatchObject({
      location: '12 High Street',
      category: 'medical',
      kind: 'timed',
    });
  });

  it('replays an Idempotency-Key without creating a second event (FR-023)', async () => {
    const key = crypto.randomUUID();
    const body = timedEvent({
      title: 'Idempotent dentist',
      startsAt: '2026-09-24T09:00:00Z',
      endsAt: '2026-09-24T09:30:00Z',
    });

    const first = await post(body, key);
    const second = await post(body, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);

    const range = await listOccurrences(
      server,
      home.familyId,
      home.ada,
      '2026-09-24T00:00:00Z',
      '2026-09-25T00:00:00Z',
    );
    expect(range.body.filter((o) => o.title === 'Idempotent dentist')).toHaveLength(1);
  });
});

describe('all-day events (US1, FR-004)', () => {
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

  it('falls on its intended date whatever zone a reader is in — the dates, not the instants, are the answer', async () => {
    const created = await request(server)
      .post(`/v1/families/${home.familyId}/events`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send({
        kind: 'all_day',
        title: 'Birthday',
        startDate: '2026-10-03',
        endDate: '2026-10-03',
        timeZone: 'Pacific/Auckland',
      });
    expect(created.status).toBe(201);
    const { eventId } = created.body as { eventId: string };

    // A reader in London asks about "3 October" in their own terms; Auckland's
    // 3 October begins on 2 October in UTC. Overlap semantics still find it,
    // and the row reports the authored date, not a shifted one.
    const range = await listOccurrences(
      server,
      home.familyId,
      home.ada,
      '2026-10-03T00:00:00+01:00',
      '2026-10-04T00:00:00+01:00',
    );
    const row = range.body.find((o) => o.eventId === eventId);
    expect(row).toMatchObject({ kind: 'all_day', startDate: '2026-10-03', endDate: '2026-10-03' });

    const read = await request(server)
      .get(`/v1/families/${home.familyId}/events/${eventId}`)
      .set('Authorization', `Bearer ${home.ada.token}`);
    expect(read.body).toMatchObject({
      kind: 'all_day',
      startDate: '2026-10-03',
      endDate: '2026-10-03',
      timeZone: 'Pacific/Auckland',
    });
    expect(read.body).not.toHaveProperty('startsAt');
  });

  it('refuses a date that is not on the calendar', async () => {
    const response = await request(server)
      .post(`/v1/families/${home.familyId}/events`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send({
        kind: 'all_day',
        title: 'Nope',
        startDate: '2026-02-30',
        endDate: '2026-02-30',
        timeZone: 'Europe/London',
      });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ type: 'calendar/invalid_time_range' });
  });
});
