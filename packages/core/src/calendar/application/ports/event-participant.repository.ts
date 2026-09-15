import type { CalendarEventId, FamilyMemberId } from '@fp/kernel';
import type { EventParticipant } from '../../domain/event-participant.js';

/**
 * Raised by `replaceForEvent` when a member id is not a member of the scoped
 * family. The database decides it — `event_participant`'s composite foreign
 * key onto `family_member (id, family_id)` — so Calendar never reads a Family
 * table to find out (FR-018, FR-027).
 *
 * Carries nothing about the member: whether they exist in some other family is
 * exactly what FR-018 forbids disclosing.
 */
export class ParticipantNotInFamilyError extends Error {
  constructor() {
    super('A participant is not a member of this family.');
    this.name = 'ParticipantNotInFamilyError';
  }
}

/** Scoped by construction. */
export interface EventParticipantRepository {
  /**
   * Makes the event's participants exactly `memberIds`. Throws
   * `ParticipantNotInFamilyError` if any is not a member of the scoped family;
   * the caller rolls the whole transaction back rather than keeping a partial
   * write.
   */
  replaceForEvent(eventId: CalendarEventId, memberIds: readonly FamilyMemberId[]): Promise<void>;

  listForEvent(eventId: CalendarEventId): Promise<readonly EventParticipant[]>;
}
