import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDatabase } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapCalendarApp } from './test-support/bootstrap-calendar-app.js';
import {
  buildHousehold,
  createEvent,
  listOccurrences,
  timedEvent,
  type Household,
} from './test-support/household.js';

describe('POST …/events/:eventId/cancel (US4, FR-021, FR-008, SC-008)', () => {
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

  const cancel = (eventId: string) =>
    request(server)
      .post(`/v1/families/${home.familyId}/events/${eventId}/cancel`)
      .set('Authorization', `Bearer ${home.ada.token}`);

  it('marks the event cancelled, keeps it readable and in its slots, and publishes EventCancelled with no occurrence id', async () => {
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

    const response = await cancel(eventId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ eventId, status: 'cancelled' });

    const read = await request(server)
      .get(`/v1/families/${home.familyId}/events/${eventId}`)
      .set('Authorization', `Bearer ${home.vera.token}`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ status: 'cancelled' });

    const range = await listOccurrences(
      server,
      home.familyId,
      home.vera,
      '2026-09-14T00:00:00Z',
      '2026-09-30T00:00:00Z',
    );
    const slots = range.body.filter((o) => o.eventId === eventId);
    expect(slots.length).toBeGreaterThanOrEqual(3);
    expect(slots.every((o) => o.status === 'cancelled')).toBe(true);

    const outbox = await withDatabase((tx) =>
      tx.outboxEvent.findMany({
        where: { aggregateId: eventId, eventType: 'calendar.EventCancelled.v1' },
      }),
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.payload).toMatchObject({ eventId, occurrenceId: null });
  });

  it('is idempotent: cancelling twice returns the same state and publishes once', async () => {
    const eventId = await createEvent(server, home.familyId, home.ada, timedEvent());

    const first = await cancel(eventId);
    const second = await cancel(eventId);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    const outbox = await withDatabase((tx) =>
      tx.outboxEvent.count({
        where: { aggregateId: eventId, eventType: 'calendar.EventCancelled.v1' },
      }),
    );
    expect(outbox).toBe(1);
  });
});
