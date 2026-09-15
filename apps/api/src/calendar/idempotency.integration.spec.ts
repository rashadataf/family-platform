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

/**
 * FR-023, SC-009: a mobile client retries aggressively, and a duplicated
 * appointment is a visible defect a family cleans up by hand.
 */
describe('Idempotency-Key on Calendar’s creating and cancelling routes (FR-023, SC-009)', () => {
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

  it('a replayed create makes no second event, occurrence or participation', async () => {
    const key = crypto.randomUUID();
    const title = `Retried ${crypto.randomUUID()}`;
    const body = timedEvent({
      title,
      startsAt: '2026-09-15T15:00:00Z',
      endsAt: '2026-09-15T16:00:00Z',
      recurrenceRule: 'FREQ=WEEKLY',
      participants: [home.grace.memberId],
    });
    const send = () =>
      request(server)
        .post(`/v1/families/${home.familyId}/events`)
        .set('Authorization', `Bearer ${home.ada.token}`)
        .set('Idempotency-Key', key)
        .send(body);

    const responses = [await send(), await send(), await send()];
    expect(new Set(responses.map((r) => JSON.stringify(r.body))).size).toBe(1);

    const counts = await withDatabase(async (tx) => {
      await scopeTo(tx, home.familyId);
      const events = await tx.calendarEvent.findMany({ where: { title } });
      const ids = events.map((e) => e.id);
      return {
        events: events.length,
        participants: await tx.eventParticipant.count({ where: { eventId: { in: ids } } }),
        occurrencesPerStart: await tx.eventOccurrence.groupBy({
          by: ['startsAt'],
          where: { eventId: { in: ids } },
          _count: true,
        }),
      };
    });
    expect(counts.events).toBe(1);
    expect(counts.participants).toBe(1);
    expect(counts.occurrencesPerStart.every((group) => group._count === 1)).toBe(true);
  });

  it('the same key on a different family is a different request', async () => {
    const elsewhere = await buildHousehold(server, mailer);
    const key = crypto.randomUUID();
    const first = await request(server)
      .post(`/v1/families/${home.familyId}/events`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .set('Idempotency-Key', key)
      .send(timedEvent());
    // Different caller as well as family: the store is per user.
    const second = await request(server)
      .post(`/v1/families/${elsewhere.familyId}/events`)
      .set('Authorization', `Bearer ${elsewhere.ada.token}`)
      .set('Idempotency-Key', key)
      .send(timedEvent());
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).not.toEqual(first.body);
  });

  it('honours the key on both cancel routes', async () => {
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
    const range = await listOccurrences(
      server,
      home.familyId,
      home.ada,
      '2026-09-14T00:00:00Z',
      '2026-09-30T00:00:00Z',
    );
    const occurrenceId = range.body.find((o) => o.eventId === eventId)?.occurrenceId ?? '';

    for (const path of [
      `/v1/families/${home.familyId}/events/${eventId}/occurrences/${occurrenceId}/cancel`,
      `/v1/families/${home.familyId}/events/${eventId}/cancel`,
    ]) {
      const key = crypto.randomUUID();
      const first = await request(server)
        .post(path)
        .set('Authorization', `Bearer ${home.ada.token}`)
        .set('Idempotency-Key', key);
      const replay = await request(server)
        .post(path)
        .set('Authorization', `Bearer ${home.ada.token}`)
        .set('Idempotency-Key', key);
      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(first.body);
    }

    const cancellations = await withDatabase((tx) =>
      tx.outboxEvent.count({
        where: { aggregateId: eventId, eventType: 'calendar.EventCancelled.v1' },
      }),
    );
    expect(cancellations).toBe(2);
  });
});
