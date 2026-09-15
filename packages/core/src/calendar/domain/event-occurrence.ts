import type { CalendarEventId, EventOccurrenceId } from '@fp/kernel';

/**
 * One materialised instance of an event (ARCHITECTURE.md §5.3).
 *
 * A plain derived value with no behaviour of its own: everything about it is
 * produced by `materialisation.ts`'s reconcile, except `cancelledAt` — the one
 * authored attribute (FR-022), and the reason a rebuild must preserve rows
 * rather than regenerate them.
 *
 * `(eventId, startsAt)` is its identity in practice, and that identity is
 * stable exactly as long as an occurrence cannot move — which is why moving
 * one is refused (research.md §5).
 */
export interface EventOccurrence {
  readonly id: EventOccurrenceId;
  readonly eventId: CalendarEventId;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly cancelledAt: Date | null;
}

/** An occurrence the rule produces, before it has a row. */
export interface PlannedOccurrence {
  readonly startsAt: Date;
  readonly endsAt: Date;
}
