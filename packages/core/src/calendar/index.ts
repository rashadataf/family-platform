// Calendar bounded context (spec 009, ARCHITECTURE.md §5.3).
//
// The first context built on top of the tenant root. It learns a caller's
// standing only through Family's `FamilyContextPort` (applied by the API's
// guards) and who a reader may see only through `MemberVisibilityPort` — never
// by reading a Family table (FR-027). `reads-family-only-through-published-ports.spec.ts`
// holds it to that.

export {
  CalendarEvent,
  EVENT_CATEGORIES,
  EVENT_STATUSES,
  type CalendarEventProps,
  type ChangedFieldGroup,
  type EventCategory,
  type EventKind,
  type EventPatch,
  type EventStatus,
  type EventTiming,
  type EventUpdateOutcome,
  type TimingPatch,
} from './domain/calendar-event.aggregate.js';
export { type EventOccurrence, type PlannedOccurrence } from './domain/event-occurrence.js';
export { type EventParticipant } from './domain/event-participant.js';
export {
  HORIZON_DAYS,
  MAX_RANGE_DAYS,
  TRAILING_DAYS,
  isEmptyPlan,
  materialisationWindow,
  planOccurrences,
  reconcile,
  type MaterialisationWindow,
  type OccurrencePlan,
  type ReconcilePlan,
} from './domain/materialisation.js';
export {
  CALENDAR_EVENT_TYPES,
  eventCancelledEvent,
  eventCreatedEvent,
  eventUpdatedEvent,
  occurrenceMaterialisedEvent,
} from './domain/events.js';

export {
  type CalendarUnitOfWork,
  type CalendarUnitOfWorkPort,
} from './application/ports/calendar-unit-of-work.port.js';
export { type CalendarEventRepository } from './application/ports/calendar-event.repository.js';
export {
  type EventOccurrenceRepository,
  type HiddenParticipation,
  type RangeQuery,
  type ReconcileCounts,
} from './application/ports/event-occurrence.repository.js';
export {
  ParticipantNotInFamilyError,
  type EventParticipantRepository,
} from './application/ports/event-participant.repository.js';
export {
  type CalendarReadPort,
  type ListOccurrencesInput,
  type OccurrenceView,
} from './application/ports/calendar-read.port.js';
export { type ErasurePort } from './application/ports/erasure.port.js';
export { type Reader } from './application/visibility.js';

export {
  createEvent,
  type CreateEventInput,
  type CreateEventOutcome,
} from './application/commands/create-event.command.js';
export {
  updateEvent,
  type UpdateEventOutcome,
} from './application/commands/update-event.command.js';
export { cancelEvent } from './application/commands/cancel-event.command.js';
export {
  cancelOccurrence,
  rescheduleOccurrence,
} from './application/commands/cancel-occurrence.command.js';
export {
  materialiseHorizon,
  pruneTrailingOccurrences,
  type MaterialiseHorizonOutcome,
} from './application/commands/materialise-horizon.command.js';
export { getEvent } from './application/queries/get-event.query.js';
export { listOccurrences } from './application/queries/list-occurrences.query.js';
