import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calendarContract } from '@fp/contracts';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapCalendarApp } from './test-support/bootstrap-calendar-app.js';
import {
  buildHousehold,
  createEvent,
  listOccurrences,
  timedEvent,
  type Household,
} from './test-support/household.js';

interface RouteUnderTest {
  readonly key: string;
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;
}

/**
 * Every Calendar route, hand-copied from contracts/calendar-api.md rather than
 * only derived from the contract — so a route dropped from the contract, or
 * added to it without reaching this table, fails the comparison below instead
 * of vanishing quietly (SC-004; spec 008 T087's single-table property, kept
 * here as a sibling file because Calendar's routes answer in their own
 * problem type).
 */
const expectedCalendarRoutes: readonly RouteUnderTest[] = [
  { key: 'listOccurrences', method: 'GET', path: '/v1/families/:familyId/occurrences' },
  { key: 'createEvent', method: 'POST', path: '/v1/families/:familyId/events' },
  { key: 'getEvent', method: 'GET', path: '/v1/families/:familyId/events/:eventId' },
  { key: 'updateEvent', method: 'PATCH', path: '/v1/families/:familyId/events/:eventId' },
  { key: 'cancelEvent', method: 'POST', path: '/v1/families/:familyId/events/:eventId/cancel' },
  {
    key: 'cancelOccurrence',
    method: 'POST',
    path: '/v1/families/:familyId/events/:eventId/occurrences/:occurrenceId/cancel',
  },
  {
    key: 'rescheduleOccurrence',
    method: 'PATCH',
    path: '/v1/families/:familyId/events/:eventId/occurrences/:occurrenceId',
  },
];

function byKey(a: RouteUnderTest, b: RouteUnderTest): number {
  return a.key.localeCompare(b.key);
}

describe('SC-004, FR-028: every Calendar route 404s identically for a caller with no standing', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let home: Household;
  let eventId: string;
  let occurrenceId: string;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapCalendarApp());
    home = await buildHousehold(server, mailer);
    eventId = await createEvent(server, home.familyId, home.ada, timedEvent());
    const range = await listOccurrences(
      server,
      home.familyId,
      home.ada,
      '2026-09-20T00:00:00Z',
      '2026-09-21T00:00:00Z',
    );
    occurrenceId = range.body.find((o) => o.eventId === eventId)?.occurrenceId ?? '';
  });

  afterAll(async () => {
    await app.close();
  });

  it("the table above matches the contract's own routes", () => {
    const actual = Object.entries(calendarContract)
      .map(([key, route]) => ({ key, method: route.method, path: route.path }))
      .sort(byKey);
    expect(actual).toEqual([...expectedCalendarRoutes].sort(byKey));
  });

  /** Real ids from the target family, so a 404 cannot be explained by the ids being nonsense. */
  function realPath(template: string, familyId: string): string {
    return template
      .replace(':familyId', familyId)
      .replace(':eventId', eventId)
      .replace(':occurrenceId', occurrenceId);
  }

  it.each(expectedCalendarRoutes)(
    '$method $path — 404 calendar/not_found for an outsider, identical to a family that does not exist',
    async ({ method, path }) => {
      const verb = method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete';
      const query = { from: '2026-09-20T00:00:00Z', to: '2026-09-21T00:00:00Z' };

      const outsider = await request(server)
        [verb](realPath(path, home.familyId))
        .query(query)
        .set('Authorization', `Bearer ${home.outsider.token}`)
        .send(timedEvent());
      expect(outsider.status).toBe(404);
      expect(outsider.body).toEqual({ type: 'calendar/not_found' });

      const missing = await request(server)
        [verb](realPath(path, crypto.randomUUID()))
        .query(query)
        .set('Authorization', `Bearer ${home.outsider.token}`)
        .send(timedEvent());
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual(outsider.body);
    },
  );

  it('a member of this family asking for an event id that does not exist gets the same body', async () => {
    const response = await request(server)
      .get(`/v1/families/${home.familyId}/events/${crypto.randomUUID()}`)
      .set('Authorization', `Bearer ${home.ada.token}`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ type: 'calendar/not_found' });
  });

  it("a member of ANOTHER family cannot reach this family's event through their own family's path", async () => {
    const elsewhere = await buildHousehold(server, mailer);
    const response = await request(server)
      .get(`/v1/families/${elsewhere.familyId}/events/${eventId}`)
      .set('Authorization', `Bearer ${elsewhere.ada.token}`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ type: 'calendar/not_found' });

    const range = await listOccurrences(
      server,
      elsewhere.familyId,
      elsewhere.ada,
      '2026-09-20T00:00:00Z',
      '2026-09-21T00:00:00Z',
    );
    expect(range.status).toBe(200);
    expect(range.body).toEqual([]);
  });

  it('the family routes still answer in their own problem type — the namespace did not leak', async () => {
    const response = await request(server)
      .get(`/v1/families/${home.familyId}`)
      .set('Authorization', `Bearer ${home.outsider.token}`);
    expect(response.body).toEqual({ type: 'family/not_found' });
  });
});
