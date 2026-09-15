import type { CalendarEventId, EventOccurrenceId, FamilyMemberId } from '@fp/kernel';
import type { EventOccurrence } from '../../domain/event-occurrence.js';
import type { ReconcilePlan } from '../../domain/materialisation.js';
import type { OccurrenceView } from './calendar-read.port.js';

export interface RangeQuery {
  readonly from: Date;
  readonly to: Date;
  /** FR-016: an event with any participant outside this set is excluded IN the query. */
  readonly visibleMemberIds: readonly FamilyMemberId[];
}

/** An event the range excluded, and the participant that excluded it — for the denial audit only. */
export interface HiddenParticipation {
  readonly eventId: CalendarEventId;
  readonly memberId: FamilyMemberId;
}

export interface ReconcileCounts {
  readonly inserted: number;
  readonly updated: number;
  readonly deleted: number;
}

/** Scoped by construction, like every repository in the unit of work. */
export interface EventOccurrenceRepository {
  /** Every occurrence of one event, oldest first, optionally from an instant onward. */
  listForEvent(
    eventId: CalendarEventId,
    options?: { startingFrom?: Date },
  ): Promise<readonly EventOccurrence[]>;

  findById(occurrenceId: EventOccurrenceId): Promise<EventOccurrence | null>;

  /**
   * Applies `materialisation.ts`'s reconcile plan. The insert is
   * `ON CONFLICT (event_id, starts_at) DO NOTHING`, so a plan computed against
   * a stale read still cannot produce a duplicate; the update writes `ends_at`
   * alone and never `cancelled_at` (FR-022).
   */
  applyPlan(eventId: CalendarEventId, plan: ReconcilePlan): Promise<ReconcileCounts>;

  /** FR-022. Sets `cancelled_at` on one row, the one authored field an occurrence has. */
  cancel(occurrenceId: EventOccurrenceId, at: Date): Promise<void>;

  /** Derived-data cleanup behind the trailing window (research.md §4). Never touches the event. */
  pruneForEventBefore(eventId: CalendarEventId, before: Date): Promise<number>;

  /** As above, across every recurring event in the scoped family. */
  pruneRecurringBefore(before: Date): Promise<number>;

  /**
   * THE range query (research.md §7). Overlap, not containment —
   * `starts_at < to AND ends_at > from` — so a long event spanning the window
   * is returned. Chronological. The visibility filter is a `NOT EXISTS` in the
   * same statement, so the result's COUNT carries no trace of a hidden event.
   */
  listVisibleInRange(query: RangeQuery): Promise<readonly OccurrenceView[]>;

  /** The participations that excluded events from the same range. Never shapes a response. */
  listHiddenParticipationsInRange(query: RangeQuery): Promise<readonly HiddenParticipation[]>;
}
