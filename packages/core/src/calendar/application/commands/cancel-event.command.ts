import {
  err,
  ok,
  type CalendarEventId,
  type Clock,
  type DomainError,
  type Result,
} from '@fp/kernel';
import type { MemberVisibilityPort } from '../../../family/application/ports/member-visibility.port.js';
import type { CalendarEvent } from '../../domain/calendar-event.aggregate.js';
import { eventCancelledEvent } from '../../domain/events.js';
import type { CalendarUnitOfWorkPort } from '../ports/calendar-unit-of-work.port.js';
import {
  auditChildParticipation,
  hiddenParticipants,
  resolveVisibility,
  type Reader,
} from '../visibility.js';

/**
 * `POST …/events/:eventId/cancel` — FR-021.
 *
 * A state change, never a deletion: the event stays readable and its
 * occurrences stay in their slots, so a family can see that something it
 * expected is off (FR-008). That is what distinguishes an event from a task.
 *
 * Idempotent by construction: cancelling a cancelled event returns the same
 * event and publishes nothing further, because the caller's intent is
 * already satisfied.
 */
export async function cancelEvent(
  input: Reader & { eventId: CalendarEventId },
  deps: { unitOfWork: CalendarUnitOfWorkPort; visibility: MemberVisibilityPort; clock: Clock },
): Promise<Result<CalendarEvent, DomainError>> {
  const now = deps.clock.now();
  const visibility = await resolveVisibility(deps.visibility, input);

  return deps.unitOfWork.withCalendarFamilyContext(input.familyId, async (uow) => {
    const event = await uow.events.lockById(input.eventId);
    if (event === null) return err({ kind: 'NotFound' });

    const hidden = hiddenParticipants(event.participants, visibility);
    if (hidden.length > 0) {
      await auditChildParticipation(uow.audit, {
        reader: input,
        eventId: event.id,
        childMemberIds: hidden,
        view: 'event change',
        result: 'denied',
      });
      return err({ kind: 'NotFound' });
    }

    if (event.cancel(now)) {
      await uow.events.save(event);
      await uow.outbox.append(
        eventCancelledEvent({
          familyId: input.familyId,
          eventId: event.id,
          occurrenceId: null,
          correlationId: input.correlationId,
        }),
      );
    }

    return ok(event);
  });
}
