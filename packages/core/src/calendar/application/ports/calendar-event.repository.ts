import type { CalendarEventId } from '@fp/kernel';
import type { CalendarEvent } from '../../domain/calendar-event.aggregate.js';

/**
 * Scoped by construction (ARCHITECTURE.md §9 layer 4): no method takes a
 * family id. Participants are loaded with the event, since every caller that
 * reads one needs to apply FR-016's visibility filter to it; they are WRITTEN
 * through `EventParticipantRepository`.
 */
export interface CalendarEventRepository {
  /** Insert or update the authored fields. Never touches participants or occurrences. */
  save(event: CalendarEvent): Promise<void>;

  /** One event of the scoped family, or `null` — including for any other family's event. */
  findById(eventId: CalendarEventId): Promise<CalendarEvent | null>;

  /**
   * As `findById`, taking the row lock for the rest of the transaction. Every
   * path that rebuilds occurrences — an edit, a cancellation, the sweep — takes
   * it first, so a rule changing while the sweep materialises the same event
   * serialises rather than interleaving (research.md §8).
   */
  lockById(eventId: CalendarEventId): Promise<CalendarEvent | null>;
}
