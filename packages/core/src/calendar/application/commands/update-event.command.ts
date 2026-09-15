import {
  err,
  ok,
  type CalendarEventId,
  type Clock,
  type DomainError,
  type Result,
} from '@fp/kernel';
import type { MemberVisibilityPort } from '../../../family/application/ports/member-visibility.port.js';
import type {
  CalendarEvent,
  EventPatch,
  EventUpdateOutcome,
} from '../../domain/calendar-event.aggregate.js';
import { eventUpdatedEvent, occurrenceMaterialisedEvent } from '../../domain/events.js';
import type { CalendarUnitOfWorkPort } from '../ports/calendar-unit-of-work.port.js';
import type { ReconcileCounts } from '../ports/event-occurrence.repository.js';
import { ParticipantNotInFamilyError } from '../ports/event-participant.repository.js';
import { rematerialise } from '../rematerialise.js';
import { catchRollback, RollbackWithError } from '../rollback.js';
import {
  auditChildParticipation,
  hiddenParticipants,
  resolveVisibility,
  type Reader,
} from '../visibility.js';

export interface UpdateEventOutcome extends EventUpdateOutcome {
  readonly event: CalendarEvent;
  readonly counts: ReconcileCounts | null;
}

/**
 * `PATCH /v1/families/:familyId/events/:eventId` — FR-019 and FR-020.
 *
 * Any writer may edit any event in the family (spec.md Assumptions), except
 * one they may not see: an event carrying a child they do not guard is
 * `NotFound` here exactly as it is on read, or a PATCH would be a way to probe
 * for it (FR-016).
 *
 * Occurrences are rebuilt only when the edit can change which instants the
 * event produces — its timing, its zone, or its rule — and the rebuild is the
 * reconcile, so an individual cancellation survives a rule change that keeps
 * its instant and is dropped by a time change that moves it (research.md §5).
 * The row lock is taken first, so this serialises with the sweep.
 */
export async function updateEvent(
  input: Reader & { eventId: CalendarEventId; patch: EventPatch },
  deps: { unitOfWork: CalendarUnitOfWorkPort; visibility: MemberVisibilityPort; clock: Clock },
): Promise<Result<UpdateEventOutcome, DomainError>> {
  const now = deps.clock.now();
  const visibility = await resolveVisibility(deps.visibility, input);

  return catchRollback(() =>
    deps.unitOfWork.withCalendarFamilyContext(input.familyId, async (uow) => {
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

      const outcome = event.update(input.patch, now);
      if (!outcome.ok) return outcome;
      if (outcome.value.changed.length === 0) {
        return ok({ ...outcome.value, event, counts: null });
      }

      await uow.events.save(event);

      if (outcome.value.changed.includes('participants')) {
        try {
          await uow.participants.replaceForEvent(event.id, event.participants);
        } catch (error) {
          if (error instanceof ParticipantNotInFamilyError) {
            throw new RollbackWithError({ kind: 'ParticipantInvalid' });
          }
          throw error;
        }
      }

      let counts: ReconcileCounts | null = null;
      if (outcome.value.reschedule) {
        const materialised = await rematerialise(uow, event, now);
        if (!materialised.ok) throw new RollbackWithError(materialised.error);
        await uow.events.save(event);
        counts = materialised.value.counts;

        if (event.isRecurring) {
          await uow.outbox.append(
            occurrenceMaterialisedEvent({
              familyId: input.familyId,
              eventId: event.id,
              windowFrom: materialised.value.window.from,
              windowTo: materialised.value.window.to,
              count: materialised.value.occurrenceCount,
              correlationId: input.correlationId,
            }),
          );
        }
      }

      await uow.outbox.append(
        eventUpdatedEvent({
          familyId: input.familyId,
          eventId: event.id,
          changed: outcome.value.changed,
          correlationId: input.correlationId,
        }),
      );

      return ok({ ...outcome.value, event, counts });
    }),
  );
}
