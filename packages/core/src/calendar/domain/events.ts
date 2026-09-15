import type { CalendarEventId, EventOccurrenceId, FamilyId, OutboxEventToAppend } from '@fp/kernel';
import type { ChangedFieldGroup, EventKind } from './calendar-event.aggregate.js';

/**
 * The four events ARCHITECTURE.md §5.3 and FR-030 require, published even
 * though nothing subscribes yet — Reminders is the eventual consumer. Written
 * as outbox rows in the state change's own transaction (ADR-005 Layer 2).
 *
 * PAYLOADS CARRY IDENTIFIERS ONLY. No title, no description, no location —
 * this context holds more free text than any before it, and an outbox row is a
 * queue message body in waiting (Principle VI, VIII, research.md §6).
 *
 * `OccurrenceMaterialised` is per (event, window), never per occurrence: a
 * horizon extension writes one row rather than hundreds, so the outbox's
 * oldest-unpublished-row signal is not drowned in derived-data notices
 * (plan.md Complexity Tracking).
 */
export const CALENDAR_EVENT_TYPES = {
  EventCreated: 'calendar.EventCreated.v1',
  EventUpdated: 'calendar.EventUpdated.v1',
  EventCancelled: 'calendar.EventCancelled.v1',
  OccurrenceMaterialised: 'calendar.OccurrenceMaterialised.v1',
} as const;

export function eventCreatedEvent(params: {
  familyId: FamilyId;
  eventId: CalendarEventId;
  kind: EventKind;
  recurring: boolean;
  correlationId: string;
}): OutboxEventToAppend {
  return {
    eventType: CALENDAR_EVENT_TYPES.EventCreated,
    aggregateType: 'CalendarEvent',
    aggregateId: params.eventId,
    payload: {
      familyId: params.familyId,
      eventId: params.eventId,
      kind: params.kind,
      recurring: params.recurring,
    },
    correlationId: params.correlationId,
  };
}

export function eventUpdatedEvent(params: {
  familyId: FamilyId;
  eventId: CalendarEventId;
  changed: readonly ChangedFieldGroup[];
  correlationId: string;
}): OutboxEventToAppend {
  return {
    eventType: CALENDAR_EVENT_TYPES.EventUpdated,
    aggregateType: 'CalendarEvent',
    aggregateId: params.eventId,
    payload: {
      familyId: params.familyId,
      eventId: params.eventId,
      // Field GROUPS, not values: "the time moved", never the time.
      changed: [...params.changed],
    },
    correlationId: params.correlationId,
  };
}

export function eventCancelledEvent(params: {
  familyId: FamilyId;
  eventId: CalendarEventId;
  /** Present when one occurrence was cancelled; absent when the series was. */
  occurrenceId: EventOccurrenceId | null;
  correlationId: string;
}): OutboxEventToAppend {
  return {
    eventType: CALENDAR_EVENT_TYPES.EventCancelled,
    aggregateType: 'CalendarEvent',
    aggregateId: params.eventId,
    payload: {
      familyId: params.familyId,
      eventId: params.eventId,
      occurrenceId: params.occurrenceId,
    },
    correlationId: params.correlationId,
  };
}

export function occurrenceMaterialisedEvent(params: {
  familyId: FamilyId;
  eventId: CalendarEventId;
  windowFrom: Date;
  windowTo: Date;
  /** Occurrences the event now has inside the window. */
  count: number;
  correlationId: string;
}): OutboxEventToAppend {
  return {
    eventType: CALENDAR_EVENT_TYPES.OccurrenceMaterialised,
    aggregateType: 'CalendarEvent',
    aggregateId: params.eventId,
    payload: {
      familyId: params.familyId,
      eventId: params.eventId,
      windowFrom: params.windowFrom.toISOString(),
      windowTo: params.windowTo.toISOString(),
      count: params.count,
    },
    correlationId: params.correlationId,
  };
}
