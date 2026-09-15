import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapCalendarApp } from './test-support/bootstrap-calendar-app.js';
import {
  buildHousehold,
  createEvent,
  timedEvent,
  type Household,
} from './test-support/household.js';

/**
 * US1 Scenario 4, FR-032: the capabilities spec 008 already issues, consumed
 * unchanged. A viewer holds `calendar:read`; owner, adult and extended hold
 * `calendar:write`. The denial names the capability, never the role.
 */
describe('calendar capabilities (FR-027, FR-032)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let home: Household;
  let eventId: string;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapCalendarApp());
    home = await buildHousehold(server, mailer);
    eventId = await createEvent(server, home.familyId, home.ada, timedEvent());
  });

  afterAll(async () => {
    await app.close();
  });

  it('denies a viewer POST …/events with 403 calendar/capability_required', async () => {
    const response = await request(server)
      .post(`/v1/families/${home.familyId}/events`)
      .set('Authorization', `Bearer ${home.vera.token}`)
      .send(timedEvent());
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      type: 'calendar/capability_required',
      capability: 'calendar:write',
    });
  });

  it('lets an extended member create an event', async () => {
    const response = await request(server)
      .post(`/v1/families/${home.familyId}/events`)
      .set('Authorization', `Bearer ${home.alan.token}`)
      .send(timedEvent());
    expect(response.status).toBe(201);
  });

  it('lets a viewer read, and denies the viewer every write route', async () => {
    const read = await request(server)
      .get(`/v1/families/${home.familyId}/events/${eventId}`)
      .set('Authorization', `Bearer ${home.vera.token}`);
    expect(read.status).toBe(200);

    // Built lazily: a supertest request starts listening when it is created.
    const auth = `Bearer ${home.vera.token}`;
    const writes = [
      () =>
        request(server)
          .patch(`/v1/families/${home.familyId}/events/${eventId}`)
          .set('Authorization', auth)
          .send({ title: 'x' }),
      () =>
        request(server)
          .post(`/v1/families/${home.familyId}/events/${eventId}/cancel`)
          .set('Authorization', auth),
      () =>
        request(server)
          .post(
            `/v1/families/${home.familyId}/events/${eventId}/occurrences/${crypto.randomUUID()}/cancel`,
          )
          .set('Authorization', auth),
    ];
    for (const write of writes) {
      const response = await write();
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ type: 'calendar/capability_required' });
    }
  });

  it('lets any writer edit an event someone else authored (spec.md Assumptions)', async () => {
    const response = await request(server)
      .patch(`/v1/families/${home.familyId}/events/${eventId}`)
      .set('Authorization', `Bearer ${home.grace.token}`)
      .send({ title: 'Dentist (moved room)' });
    expect(response.status).toBe(200);
  });
});
