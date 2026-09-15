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
  type OccurrenceBody,
} from './test-support/household.js';

const RANGE = ['2026-09-14T00:00:00Z', '2026-10-14T00:00:00Z'] as const;

describe('cancelling one occurrence (US4, FR-022, SC-012, research.md §5)', () => {
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

  async function weeklySwimming(): Promise<{ eventId: string; occurrences: OccurrenceBody[] }> {
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
    return { eventId, occurrences: await occurrencesOf(eventId) };
  }

  async function occurrencesOf(eventId: string): Promise<OccurrenceBody[]> {
    return (await listOccurrences(server, home.familyId, home.ada, ...RANGE)).body.filter(
      (o) => o.eventId === eventId,
    );
  }

  const cancelOne = (eventId: string, occurrenceId: string) =>
    request(server)
      .post(`/v1/families/${home.familyId}/events/${eventId}/occurrences/${occurrenceId}/cancel`)
      .set('Authorization', `Bearer ${home.ada.token}`);

  const patch = (eventId: string, body: Record<string, unknown>) =>
    request(server)
      .patch(`/v1/families/${home.familyId}/events/${eventId}`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send(body);

  it('cancels that occurrence alone, publishing EventCancelled with its id', async () => {
    const { eventId, occurrences } = await weeklySwimming();
    const target = occurrences[1];
    if (target === undefined) throw new Error('expected occurrences');

    const response = await cancelOne(eventId, target.occurrenceId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ occurrenceId: target.occurrenceId, eventId });

    const after = await occurrencesOf(eventId);
    expect(after.filter((o) => o.cancelledAt !== null).map((o) => o.occurrenceId)).toEqual([
      target.occurrenceId,
    ]);
    expect(after.every((o) => o.status === 'confirmed')).toBe(true);

    const outbox = await withDatabase((tx) =>
      tx.outboxEvent.findMany({
        where: { aggregateId: eventId, eventType: 'calendar.EventCancelled.v1' },
      }),
    );
    expect(outbox.map((row) => row.payload)).toEqual([
      { familyId: home.familyId, eventId, occurrenceId: target.occurrenceId },
    ]);
  });

  it('the cancellation survives a rebuild triggered by an unrelated edit, AND by a rule change that keeps its instant', async () => {
    const { eventId, occurrences } = await weeklySwimming();
    const target = occurrences[2];
    if (target === undefined) throw new Error('expected occurrences');
    await cancelOne(eventId, target.occurrenceId);

    expect((await patch(eventId, { title: 'Swimming (lane 3)' })).status).toBe(200);
    expect((await patch(eventId, { recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU,TH' })).status).toBe(200);

    const after = await occurrencesOf(eventId);
    const survivor = after.find((o) => o.occurrenceId === target.occurrenceId);
    expect(survivor?.cancelledAt).not.toBeNull();
    expect(after.filter((o) => o.cancelledAt !== null)).toHaveLength(1);
  });

  it('a change to the series’ TIME drops the cancellation rather than carrying it across — a tested decision', async () => {
    const { eventId, occurrences } = await weeklySwimming();
    const target = occurrences[1];
    if (target === undefined) throw new Error('expected occurrences');
    await cancelOne(eventId, target.occurrenceId);

    expect(
      (await patch(eventId, { startsAt: '2026-09-15T16:00:00Z', endsAt: '2026-09-15T17:00:00Z' }))
        .status,
    ).toBe(200);

    const after = await occurrencesOf(eventId);
    expect(after.length).toBe(occurrences.length);
    expect(after.every((o) => o.cancelledAt === null)).toBe(true);
    expect(after.map((o) => o.occurrenceId)).not.toContain(target.occurrenceId);
  });

  it('refuses to retime one occurrence with 422 calendar/occurrence_not_movable (FR-022)', async () => {
    const { eventId, occurrences } = await weeklySwimming();
    const target = occurrences[0];
    if (target === undefined) throw new Error('expected occurrences');

    const response = await request(server)
      .patch(`/v1/families/${home.familyId}/events/${eventId}/occurrences/${target.occurrenceId}`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send({ startsAt: '2026-09-15T17:00:00Z' });
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ type: 'calendar/occurrence_not_movable' });

    const unchanged = await occurrencesOf(eventId);
    expect(unchanged[0]?.startsAt).toBe(target.startsAt);
  });

  it('an occurrence addressed under another event’s id is not found', async () => {
    const first = await weeklySwimming();
    const second = await weeklySwimming();
    const foreign = second.occurrences[0];
    if (foreign === undefined) throw new Error('expected occurrences');

    const response = await cancelOne(first.eventId, foreign.occurrenceId);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ type: 'calendar/not_found' });
  });

  it('is idempotent: cancelling the same occurrence twice returns the same state', async () => {
    const { eventId, occurrences } = await weeklySwimming();
    const target = occurrences[0];
    if (target === undefined) throw new Error('expected occurrences');

    const first = await cancelOne(eventId, target.occurrenceId);
    const second = await cancelOne(eventId, target.occurrenceId);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });
});
