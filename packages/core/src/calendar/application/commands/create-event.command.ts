import {
  ok,
  type CalendarEventId,
  type Clock,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type Result,
} from '@fp/kernel';
import {
  CalendarEvent,
  type EventCategory,
  type EventTiming,
} from '../../domain/calendar-event.aggregate.js';
import { eventCreatedEvent, occurrenceMaterialisedEvent } from '../../domain/events.js';
import type { ReconcileCounts } from '../ports/event-occurrence.repository.js';
import { ParticipantNotInFamilyError } from '../ports/event-participant.repository.js';
import type { CalendarUnitOfWorkPort } from '../ports/calendar-unit-of-work.port.js';
import { rematerialise } from '../rematerialise.js';
import { catchRollback, RollbackWithError } from '../rollback.js';

export interface CreateEventInput {
  familyId: FamilyId;
  eventId: CalendarEventId;
  createdByMemberId: FamilyMemberId;
  title: string;
  description?: string | null;
  location?: string | null;
  category?: EventCategory | null;
  timing: EventTiming;
  timeZone: string;
  recurrenceRule?: string | null;
  participants?: readonly FamilyMemberId[];
  attachmentRefs?: readonly string[];
  correlationId: string;
}

export interface CreateEventOutcome {
  readonly eventId: CalendarEventId;
  readonly counts: ReconcileCounts;
}

/**
 * FR-001, FR-009, FR-010, FR-015. Validates through the aggregate before any
 * I/O, then writes the event, its participants, its occurrences over the
 * initial horizon and its outbox rows in ONE transaction — so a rejected rule
 * or a foreign participant leaves nothing behind.
 *
 * A participant is checked against the family by the database itself (the
 * composite foreign key onto `family_member`), never by Calendar reading a
 * Family table (FR-018, FR-027). When it fails, the whole transaction is
 * rolled back and the caller hears `ParticipantInvalid` and nothing more.
 */
export async function createEvent(
  input: CreateEventInput,
  deps: { unitOfWork: CalendarUnitOfWorkPort; clock: Clock },
): Promise<Result<CreateEventOutcome, DomainError>> {
  const now = deps.clock.now();

  const created = CalendarEvent.create({
    id: input.eventId,
    familyId: input.familyId,
    title: input.title,
    description: input.description,
    location: input.location,
    category: input.category,
    timing: input.timing,
    timeZone: input.timeZone,
    recurrenceRule: input.recurrenceRule,
    attachmentRefs: input.attachmentRefs,
    participants: input.participants,
    createdByMemberId: input.createdByMemberId,
    now,
  });
  if (!created.ok) return created;
  const event = created.value;

  return catchRollback(() =>
    deps.unitOfWork.withCalendarFamilyContext(input.familyId, async (uow) => {
      // The event row first: occurrences and participants reference it. Its
      // marker is corrected below and saved again, inside the same transaction.
      await uow.events.save(event);

      try {
        await uow.participants.replaceForEvent(event.id, event.participants);
      } catch (error) {
        if (error instanceof ParticipantNotInFamilyError) {
          throw new RollbackWithError({ kind: 'ParticipantInvalid' });
        }
        throw error;
      }

      const materialised = await rematerialise(uow, event, now);
      if (!materialised.ok) throw new RollbackWithError(materialised.error);
      await uow.events.save(event);

      await uow.outbox.append(
        eventCreatedEvent({
          familyId: input.familyId,
          eventId: event.id,
          kind: event.kind,
          recurring: event.isRecurring,
          correlationId: input.correlationId,
        }),
      );
      if (event.isRecurring) {
        // One row for the window, never one per occurrence (research.md §6).
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

      return ok({ eventId: event.id, counts: materialised.value.counts });
    }),
  );
}
