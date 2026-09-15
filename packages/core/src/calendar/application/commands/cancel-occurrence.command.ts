import {
  err,
  ok,
  type CalendarEventId,
  type Clock,
  type DomainError,
  type EventOccurrenceId,
  type Result,
} from '@fp/kernel';
import type { MemberVisibilityPort } from '../../../family/application/ports/member-visibility.port.js';
import type { EventOccurrence } from '../../domain/event-occurrence.js';
import { eventCancelledEvent } from '../../domain/events.js';
import type {
  CalendarUnitOfWork,
  CalendarUnitOfWorkPort,
} from '../ports/calendar-unit-of-work.port.js';
import {
  auditChildParticipation,
  hiddenParticipants,
  resolveVisibility,
  type Reader,
  type ResolvedVisibility,
} from '../visibility.js';

type OccurrenceInput = Reader & { eventId: CalendarEventId; occurrenceId: EventOccurrenceId };

/**
 * The event must exist, be visible to the caller, and own the occurrence —
 * an occurrence id under the wrong event id is `NotFound`, not a way to reach
 * an event through another's path.
 */
async function findReachableOccurrence(
  uow: CalendarUnitOfWork,
  input: OccurrenceInput,
  visibility: ResolvedVisibility,
): Promise<EventOccurrence | null> {
  const event = await uow.events.lockById(input.eventId);
  if (event === null) return null;

  const hidden = hiddenParticipants(event.participants, visibility);
  if (hidden.length > 0) {
    await auditChildParticipation(uow.audit, {
      reader: input,
      eventId: event.id,
      childMemberIds: hidden,
      view: 'event change',
      result: 'denied',
    });
    return null;
  }

  const occurrence = await uow.occurrences.findById(input.occurrenceId);
  return occurrence?.eventId === event.id ? occurrence : null;
}

/**
 * `POST …/events/:eventId/occurrences/:occurrenceId/cancel` — FR-022.
 *
 * Sets that one occurrence's `cancelled_at` and nothing else; every other
 * occurrence in the series is untouched, and the reconcile never writes the
 * column, so the cancellation survives any rebuild that keeps its instant.
 * Idempotent: an already-cancelled occurrence is returned as it is.
 */
export async function cancelOccurrence(
  input: OccurrenceInput,
  deps: { unitOfWork: CalendarUnitOfWorkPort; visibility: MemberVisibilityPort; clock: Clock },
): Promise<Result<EventOccurrence, DomainError>> {
  const now = deps.clock.now();
  const visibility = await resolveVisibility(deps.visibility, input);

  return deps.unitOfWork.withCalendarFamilyContext(input.familyId, async (uow) => {
    const occurrence = await findReachableOccurrence(uow, input, visibility);
    if (occurrence === null) return err({ kind: 'NotFound' });
    if (occurrence.cancelledAt !== null) return ok(occurrence);

    await uow.occurrences.cancel(occurrence.id, now);
    await uow.outbox.append(
      eventCancelledEvent({
        familyId: input.familyId,
        eventId: occurrence.eventId,
        occurrenceId: occurrence.id,
        correlationId: input.correlationId,
      }),
    );
    return ok({ ...occurrence, cancelledAt: now });
  });
}

/**
 * An attempt to retime ONE occurrence — refused (FR-022). Moving an occurrence
 * would need a row the rule does not produce, with an identity that survives
 * the rule changing under it: the RFC 5545 `RECURRENCE-ID` problem, deferred
 * by the spec. Refusing is also what keeps `(event_id, starts_at)` a stable
 * identity (research.md §5).
 *
 * Existence and visibility are checked first, so the refusal itself discloses
 * nothing a `NotFound` would not.
 */
export async function rescheduleOccurrence(
  input: OccurrenceInput,
  deps: { unitOfWork: CalendarUnitOfWorkPort; visibility: MemberVisibilityPort },
): Promise<Result<never, DomainError>> {
  const visibility = await resolveVisibility(deps.visibility, input);

  return deps.unitOfWork.withCalendarFamilyContext(input.familyId, async (uow) => {
    const occurrence = await findReachableOccurrence(uow, input, visibility);
    if (occurrence === null) return err({ kind: 'NotFound' });
    return err({ kind: 'OccurrenceNotMovable' });
  });
}
