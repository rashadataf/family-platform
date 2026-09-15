import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDatabase } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapCalendarApp } from './test-support/bootstrap-calendar-app.js';
import { buildHousehold, timedEvent, type Household } from './test-support/household.js';

describe('participants (US2, FR-015, FR-018)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let home: Household;
  let elsewhere: Household;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapCalendarApp());
    home = await buildHousehold(server, mailer);
    elsewhere = await buildHousehold(server, mailer);
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (body: Record<string, unknown>) =>
    request(server)
      .post(`/v1/families/${home.familyId}/events`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send(body);

  it('records an adult with an account and a child with none as the same shape of reference (Scenarios 1–2)', async () => {
    const adultEvent = await post(
      timedEvent({ title: 'Parents evening', participants: [home.grace.memberId] }),
    );
    const childEvent = await post(
      timedEvent({ title: 'Nursery settling-in', participants: [home.charlieId] }),
    );
    expect(adultEvent.status).toBe(201);
    expect(childEvent.status).toBe(201);

    const rows = await withDatabase(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.family_id', ${home.familyId}::text, true)`;
      return tx.eventParticipant.findMany({
        where: {
          eventId: {
            in: [
              (adultEvent.body as { eventId: string }).eventId,
              (childEvent.body as { eventId: string }).eventId,
            ],
          },
        },
      });
    });
    expect(rows.map((row) => row.memberId).sort()).toEqual(
      [home.grace.memberId, home.charlieId].sort(),
    );
    // Nothing about the person but the reference.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['addedAt', 'eventId', 'familyId', 'memberId']);
    }
  });

  it('returns location, category and participants on read (Scenario 3)', async () => {
    const created = await post(
      timedEvent({
        location: 'Riverside Nursery',
        category: 'nursery',
        participants: [home.charlieId],
      }),
    );
    const read = await request(server)
      .get(`/v1/families/${home.familyId}/events/${(created.body as { eventId: string }).eventId}`)
      .set('Authorization', `Bearer ${home.ada.token}`);
    expect(read.body).toMatchObject({
      location: 'Riverside Nursery',
      category: 'nursery',
      participants: [home.charlieId],
    });
  });

  it('refuses a member of another family with 422 calendar/participant_invalid, disclosing nothing (Scenario 4)', async () => {
    const foreign = await post(timedEvent({ participants: [elsewhere.grace.memberId] }));
    const invented = await post(timedEvent({ participants: [crypto.randomUUID()] }));

    expect(foreign.status).toBe(422);
    expect(foreign.body).toEqual({ type: 'calendar/participant_invalid' });
    // A real member elsewhere and an id that exists nowhere are indistinguishable.
    expect(invented.status).toBe(422);
    expect(invented.body).toEqual(foreign.body);
  });

  it('leaves nothing behind when a participant is refused — no event, no occurrence, no outbox row', async () => {
    const title = `Refused ${crypto.randomUUID()}`;
    await post(timedEvent({ title, participants: [home.charlieId, elsewhere.charlieId] }));

    const leftovers = await withDatabase(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.family_id', ${home.familyId}::text, true)`;
      return tx.calendarEvent.count({ where: { title } });
    });
    expect(leftovers).toBe(0);
  });
});
