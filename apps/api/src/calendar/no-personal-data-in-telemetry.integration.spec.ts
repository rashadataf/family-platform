import type { INestApplication, LoggerService } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDatabase } from '@fp/testing';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { bootstrapCalendarApp } from './test-support/bootstrap-calendar-app.js';
import { buildHousehold, listOccurrences, type Household } from './test-support/household.js';

/** Captures every message Nest's `Logger` receives, at every level. */
class CapturingLogger implements LoggerService {
  readonly messages: string[] = [];
  private capture(message: unknown, ...rest: unknown[]): void {
    this.messages.push(
      [message, ...rest]
        .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
        .join(' '),
    );
  }
  log(message: unknown, ...rest: unknown[]): void {
    this.capture(message, ...rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.capture(message, ...rest);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.capture(message, ...rest);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.capture(message, ...rest);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.capture(message, ...rest);
  }
}

/**
 * Principle VI and VIII, mirroring spec 008's own test. This context holds more
 * free text than any before it — a title, a description, a location — so the
 * promise that none of it reaches a log line or an outbox payload is asserted
 * through the real routes, not trusted to `events.spec.ts` alone.
 */
describe('Principle VI: no event title, description or location in a log line or an outbox payload', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let logger: CapturingLogger;
  let home: Household;

  beforeAll(async () => {
    logger = new CapturingLogger();
    ({ app, server, mailer } = await bootstrapCalendarApp({ logger }));
    home = await buildHousehold(server, mailer);
  });

  afterAll(async () => {
    await app.close();
  });

  it('exercises create, update, range and child-visibility routes and finds none of the free text anywhere', async () => {
    const title = 'Charlie Distinctive-Surname paediatric appointment';
    const description = 'Bring the red folder about the unusual-allergy-9431';
    const location = '221B Uniquely-Named Street';
    const updatedTitle = 'Charlie Distinctive-Surname follow-up';

    const created = await request(server)
      .post(`/v1/families/${home.familyId}/events`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send({
        kind: 'timed',
        title,
        description,
        location,
        category: 'medical',
        startsAt: '2026-09-15T15:00:00Z',
        endsAt: '2026-09-15T16:00:00Z',
        timeZone: 'Europe/London',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU',
        participants: [home.charlieId],
      });
    expect(created.status).toBe(201);
    const { eventId } = created.body as { eventId: string };

    // A rejected write, so the refusal path's logging is exercised too.
    await request(server)
      .post(`/v1/families/${home.familyId}/events`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send({
        kind: 'timed',
        title,
        location,
        startsAt: '2026-09-15T16:00:00Z',
        endsAt: '2026-09-15T15:00:00Z',
        timeZone: 'Europe/London',
      });

    await request(server)
      .patch(`/v1/families/${home.familyId}/events/${eventId}`)
      .set('Authorization', `Bearer ${home.ada.token}`)
      .send({
        title: updatedTitle,
        startsAt: '2026-09-15T15:30:00Z',
        endsAt: '2026-09-15T16:30:00Z',
      });

    await listOccurrences(
      server,
      home.familyId,
      home.ada,
      '2026-09-14T00:00:00Z',
      '2026-10-14T00:00:00Z',
    );
    // The guardian filter's denial path.
    await request(server)
      .get(`/v1/families/${home.familyId}/events/${eventId}`)
      .set('Authorization', `Bearer ${home.grace.token}`);
    await listOccurrences(
      server,
      home.familyId,
      home.grace,
      '2026-09-14T00:00:00Z',
      '2026-10-14T00:00:00Z',
    );
    await request(server)
      .post(`/v1/families/${home.familyId}/events/${eventId}/cancel`)
      .set('Authorization', `Bearer ${home.ada.token}`);

    const forbidden = [
      title,
      updatedTitle,
      description,
      location,
      'Distinctive-Surname',
      'unusual-allergy-9431',
    ];

    const combinedLog = logger.messages.join('\n');
    expect(logger.messages.some((line) => line.includes('calendar_range_query_duration_ms'))).toBe(
      true,
    );
    for (const value of forbidden) {
      expect(combinedLog, `log carries "${value}"`).not.toContain(value);
    }

    const payloads = await withDatabase((tx) =>
      tx.outboxEvent.findMany({ where: { aggregateId: eventId } }),
    );
    expect(payloads.map((row) => row.eventType)).toEqual(
      expect.arrayContaining([
        'calendar.EventCreated.v1',
        'calendar.OccurrenceMaterialised.v1',
        'calendar.EventUpdated.v1',
        'calendar.EventCancelled.v1',
      ]) as unknown,
    );
    const combinedPayloads = JSON.stringify(payloads.map((row) => row.payload));
    for (const value of forbidden) {
      expect(combinedPayloads, `outbox payload carries "${value}"`).not.toContain(value);
    }
  });
});
