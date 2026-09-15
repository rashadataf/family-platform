import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeTo, UK_FALL_BACK_2026, withDatabase } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapCalendarApp } from './test-support/bootstrap-calendar-app.js';
import {
  buildHousehold,
  createEvent,
  listOccurrences,
  timedEvent,
  type Household,
} from './test-support/household.js';

const londonTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

describe('recurring events through the API (US3, FR-009–FR-012, SC-003)', () => {
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

  const post = (body: Record<string, unknown>) =>
    request(server)
      .post(`/v1/families/${home.familyId}/events`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send(body);

  it(`holds 16:00 local on both sides of the ${UK_FALL_BACK_2026} fall back, instants an hour apart (quickstart Scenario 2)`, async () => {
    const eventId = await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({
        title: 'Swimming',
        startsAt: '2026-10-20T15:00:00Z',
        endsAt: '2026-10-20T16:00:00Z',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU',
      }),
    );

    const range = await listOccurrences(
      server,
      home.familyId,
      home.ada,
      '2026-10-19T00:00:00Z',
      '2026-11-03T00:00:00Z',
    );
    const swims = range.body.filter((o) => o.eventId === eventId);

    expect(swims.map((o) => o.startsAt)).toEqual([
      '2026-10-20T15:00:00.000Z',
      '2026-10-27T16:00:00.000Z',
    ]);
    expect(swims.map((o) => londonTime(o.startsAt))).toEqual(['16:00', '16:00']);
  });

  it('materialises within the horizon, stops at it, and publishes OccurrenceMaterialised ONCE for the window (FR-010, FR-030)', async () => {
    const eventId = await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({
        title: 'Bins',
        startsAt: '2026-09-17T06:00:00Z',
        endsAt: '2026-09-17T06:15:00Z',
        recurrenceRule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH',
      }),
    );

    const stored = await withDatabase(async (tx) => {
      await scopeTo(tx, home.familyId);
      return {
        occurrences: await tx.eventOccurrence.findMany({
          where: { eventId },
          orderBy: { startsAt: 'asc' },
        }),
        event: await tx.calendarEvent.findFirstOrThrow({ where: { id: eventId } }),
        outbox: await tx.outboxEvent.findMany({ where: { aggregateId: eventId } }),
      };
    });

    // Fortnightly across a 400-day horizon: ~29, and none past the marker.
    expect(stored.occurrences.length).toBeGreaterThanOrEqual(28);
    expect(stored.occurrences.length).toBeLessThanOrEqual(30);
    const through = stored.event.materialisedThrough;
    expect(through?.toISOString()).toBe('2027-10-20T10:00:00.000Z');
    expect(stored.occurrences.every((o) => through !== null && o.startsAt < through)).toBe(true);

    const materialised = stored.outbox.filter(
      (row) => row.eventType === 'calendar.OccurrenceMaterialised.v1',
    );
    expect(materialised).toHaveLength(1);
    expect(materialised[0]?.payload).toMatchObject({ eventId, count: stored.occurrences.length });
  });

  it('an annual all-day birthday falls on its date every year, read from any zone (FR-004)', async () => {
    const created = await post({
      kind: 'all_day',
      title: 'Birthday',
      startDate: '2027-03-03',
      endDate: '2027-03-03',
      timeZone: 'Europe/London',
      recurrenceRule: 'FREQ=YEARLY',
    });
    expect(created.status).toBe(201);
    const { eventId } = created.body as { eventId: string };

    // From a reader's point of view in Los Angeles, 3 March starts at 08:00Z.
    const range = await listOccurrences(
      server,
      home.familyId,
      home.ada,
      '2027-03-03T00:00:00-08:00',
      '2027-03-04T00:00:00-08:00',
    );
    expect(
      range.body.filter((o) => o.eventId === eventId).map((o) => [o.startDate, o.endDate]),
    ).toEqual([['2027-03-03', '2027-03-03']]);
  });

  it.each([
    ['FREQ=HOURLY', 'calendar/recurrence_unsupported', { part: 'FREQ=HOURLY' }],
    ['FREQ=MINUTELY;INTERVAL=1', 'calendar/recurrence_unsupported', { part: 'FREQ=MINUTELY' }],
    ['FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2', 'calendar/recurrence_unsupported', { part: 'BYSETPOS' }],
    ['every other tuesday', 'calendar/recurrence_invalid', {}],
  ])(
    'rejects %j with %s, and creates nothing (FR-009, research.md §2)',
    async (rule, type, extra) => {
      const title = `Refused rule ${crypto.randomUUID()}`;
      const response = await post(timedEvent({ title, recurrenceRule: rule }));
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ type, ...extra });

      const leftovers = await withDatabase(async (tx) => {
        await scopeTo(tx, home.familyId);
        return tx.calendarEvent.count({ where: { title } });
      });
      expect(leftovers).toBe(0);
    },
  );

  it('materialises a series started years ago only within the retained window, not across its whole history', async () => {
    const eventId = await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({
        title: 'Old club',
        startsAt: '2019-01-07T18:00:00Z',
        endsAt: '2019-01-07T19:00:00Z',
        recurrenceRule: 'FREQ=WEEKLY',
      }),
    );
    const earliest = await withDatabase(async (tx) => {
      await scopeTo(tx, home.familyId);
      return tx.eventOccurrence.findFirst({ where: { eventId }, orderBy: { startsAt: 'asc' } });
    });
    // "now" is 2026-09-15; the trailing window reaches back 400 days.
    expect(earliest?.startsAt.getTime()).toBeGreaterThanOrEqual(
      new Date('2025-08-11T00:00:00Z').getTime(),
    );
  });
});
