import { err, ok, type CalendarEventId, type DomainError, type Result } from '@fp/kernel';
import type { MemberVisibilityPort } from '../../../family/application/ports/member-visibility.port.js';
import type { CalendarEvent } from '../../domain/calendar-event.aggregate.js';
import type { CalendarUnitOfWorkPort } from '../ports/calendar-unit-of-work.port.js';
import {
  auditChildParticipation,
  guardedChildParticipants,
  hiddenParticipants,
  resolveVisibility,
  type Reader,
} from '../visibility.js';

/**
 * `GET /v1/families/:familyId/events/:eventId`.
 *
 * An event with a participant the reader may not see is `NotFound` — not a
 * distinguishable "forbidden" — because nothing had disclosed its existence,
 * and FR-016 forbids inferring it (contracts/calendar-api.md's deliberate
 * contrast with spec 008's `family/guardianship_required`). Guardianship is
 * read fresh on every call, so a revoked one takes effect on the next request.
 *
 * Every read that touches a child's participation is audited, granted or
 * denied, in the same transaction as the read (FR-017).
 */
export async function getEvent(
  input: Reader & { eventId: CalendarEventId },
  deps: { unitOfWork: CalendarUnitOfWorkPort; visibility: MemberVisibilityPort },
): Promise<Result<CalendarEvent, DomainError>> {
  const visibility = await resolveVisibility(deps.visibility, input);

  return deps.unitOfWork.withCalendarFamilyContext(input.familyId, async (uow) => {
    const event = await uow.events.findById(input.eventId);
    if (event === null) return err({ kind: 'NotFound' });

    const hidden = hiddenParticipants(event.participants, visibility);
    if (hidden.length > 0) {
      await auditChildParticipation(uow.audit, {
        reader: input,
        eventId: event.id,
        childMemberIds: hidden,
        view: 'event detail',
        result: 'denied',
      });
      return err({ kind: 'NotFound' });
    }

    await auditChildParticipation(uow.audit, {
      reader: input,
      eventId: event.id,
      childMemberIds: guardedChildParticipants(event.participants, visibility),
      view: 'event detail',
      result: 'granted',
    });
    return ok(event);
  });
}
