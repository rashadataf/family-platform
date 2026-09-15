import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapCalendarApp } from './test-support/bootstrap-calendar-app.js';
import {
  buildHousehold,
  createEvent,
  listOccurrences,
  timedEvent,
  type Household,
} from './test-support/household.js';

describe('GET /v1/families/:familyId/occurrences (US1, FR-006–FR-008, research.md §7)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let home: Household;
  let inside: string;
  let spanning: string;
  let outside: string;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapCalendarApp());
    home = await buildHousehold(server, mailer);

    inside = await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({
        title: 'Inside',
        startsAt: '2026-09-21T09:00:00Z',
        endsAt: '2026-09-21T10:00:00Z',
      }),
    );
    // Starts before the window and ends after it: overlap, not containment.
    spanning = await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({
        title: 'Spanning',
        startsAt: '2026-09-19T00:00:00Z',
        endsAt: '2026-09-25T00:00:00Z',
      }),
    );
    outside = await createEvent(
      server,
      home.familyId,
      home.ada,
      timedEvent({
        title: 'Outside',
        startsAt: '2026-10-01T09:00:00Z',
        endsAt: '2026-10-01T10:00:00Z',
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns an event inside the range and one spanning it, and excludes one outside, chronologically', async () => {
    const range = await listOccurrences(
      server,
      home.familyId,
      home.vera,
      '2026-09-20T00:00:00Z',
      '2026-09-23T00:00:00Z',
    );
    expect(range.status).toBe(200);
    expect(range.body.map((o) => o.eventId)).toEqual([spanning, inside]);
    expect(range.body.map((o) => o.eventId)).not.toContain(outside);
  });

  it('carries the event’s display fields inline, so a 14-day view is one request', () => {
    return listOccurrences(
      server,
      home.familyId,
      home.ada,
      '2026-09-21T00:00:00Z',
      '2026-09-22T00:00:00Z',
    ).then((range) => {
      expect(range.body.find((o) => o.eventId === inside)).toMatchObject({
        title: 'Inside',
        status: 'confirmed',
        kind: 'timed',
        cancelledAt: null,
        startsAt: '2026-09-21T09:00:00.000Z',
      });
    });
  });

  it('rejects a range wider than the horizon, and an inverted one', async () => {
    const wide = await listOccurrences(
      server,
      home.familyId,
      home.ada,
      '2026-01-01T00:00:00Z',
      '2027-06-01T00:00:00Z',
    );
    expect(wide.status).toBe(422);
    expect(wide.body).toEqual({ type: 'calendar/range_too_wide', maxDays: 400 });

    const inverted = await listOccurrences(
      server,
      home.familyId,
      home.ada,
      '2026-09-23T00:00:00Z',
      '2026-09-20T00:00:00Z',
    );
    expect(inverted.status).toBe(422);
    expect(inverted.body).toMatchObject({ type: 'calendar/invalid_time_range' });
  });
});
