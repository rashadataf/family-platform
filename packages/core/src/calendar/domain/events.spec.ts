import { asCalendarEventId, asEventOccurrenceId, asFamilyId } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_EVENT_TYPES,
  eventCancelledEvent,
  eventCreatedEvent,
  eventUpdatedEvent,
  occurrenceMaterialisedEvent,
} from './events.js';

const familyId = asFamilyId('11111111-1111-7111-8111-111111111111');
const eventId = asCalendarEventId('22222222-2222-7222-8222-222222222222');
const occurrenceId = asEventOccurrenceId('33333333-3333-7333-8333-333333333333');
const correlationId = 'correlation-1';

const ALL_EVENTS = [
  eventCreatedEvent({ familyId, eventId, kind: 'timed', recurring: true, correlationId }),
  eventUpdatedEvent({ familyId, eventId, changed: ['details', 'timing'], correlationId }),
  eventCancelledEvent({ familyId, eventId, occurrenceId: null, correlationId }),
  occurrenceMaterialisedEvent({
    familyId,
    eventId,
    windowFrom: new Date('2025-08-11T00:00:00Z'),
    windowTo: new Date('2027-10-20T00:00:00Z'),
    count: 58,
    correlationId,
  }),
];

describe('calendar events (FR-030, research.md §6)', () => {
  it('defines exactly the four ARCHITECTURE.md §5.3 names, versioned and context-prefixed', () => {
    expect(Object.values(CALENDAR_EVENT_TYPES)).toEqual([
      'calendar.EventCreated.v1',
      'calendar.EventUpdated.v1',
      'calendar.EventCancelled.v1',
      'calendar.OccurrenceMaterialised.v1',
    ]);
    expect(ALL_EVENTS.map((e) => e.eventType).sort()).toEqual(
      Object.values(CALENDAR_EVENT_TYPES).sort(),
    );
  });

  it('carries the family id, the event id and the correlation id on every event', () => {
    for (const event of ALL_EVENTS) {
      expect(event.payload.familyId, event.eventType).toBe(familyId);
      expect(event.payload.eventId, event.eventType).toBe(eventId);
      expect(event.aggregateId, event.eventType).toBe(eventId);
      expect(event.correlationId, event.eventType).toBe(correlationId);
    }
  });

  /**
   * The assertion that matters most here. This context holds more free text
   * than any before it — a title, a description, a location — and an outbox row
   * is a queue message body in waiting (Principle VI, VIII).
   */
  it('puts no title, description, location or participant in any payload', () => {
    const FORBIDDEN_KEYS = ['title', 'description', 'location', 'name', 'participant', 'note'];
    for (const event of ALL_EVENTS) {
      for (const key of Object.keys(event.payload)) {
        expect(
          FORBIDDEN_KEYS.some((forbidden) => key.toLowerCase().includes(forbidden)),
          `${event.eventType} payload carries "${key}"`,
        ).toBe(false);
      }
    }
  });

  it('publishes an occurrence cancellation with its occurrence id, and a series cancellation without', () => {
    expect(
      eventCancelledEvent({ familyId, eventId, occurrenceId, correlationId }).payload.occurrenceId,
    ).toBe(occurrenceId);
    expect(
      eventCancelledEvent({ familyId, eventId, occurrenceId: null, correlationId }).payload
        .occurrenceId,
    ).toBeNull();
  });

  it('describes a materialisation by window and count, never by occurrence', () => {
    const payload = ALL_EVENTS[3]?.payload;
    expect(payload).toEqual({
      familyId,
      eventId,
      windowFrom: '2025-08-11T00:00:00.000Z',
      windowTo: '2027-10-20T00:00:00.000Z',
      count: 58,
    });
  });
});
