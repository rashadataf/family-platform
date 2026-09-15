import type {
  CalendarEventId,
  DomainError,
  EventOccurrenceId,
  FamilyId,
  FamilyMemberId,
  Result,
  UserId,
} from '@fp/kernel';
import type { LocalDate } from '@fp/kernel/recurrence';
import type {
  EventCategory,
  EventKind,
  EventStatus,
} from '../../domain/calendar-event.aggregate.js';

/**
 * One row of the range query: an occurrence with the event fields a 14-day
 * view needs denormalised onto it, so the view is one query rather than N+1
 * (contracts/calendar-api.md).
 *
 * `startDate`/`endDate` are present for an all-day event only, read in the
 * event's AUTHORED zone — where the occurrence's instants are that date's own
 * midnight by construction — and never in a reader's (FR-004). A client shows
 * these dates and ignores the instants for an all-day row.
 */
export interface OccurrenceView {
  readonly occurrenceId: EventOccurrenceId;
  readonly eventId: CalendarEventId;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly cancelledAt: Date | null;
  readonly kind: EventKind;
  readonly startDate: LocalDate | null;
  readonly endDate: LocalDate | null;
  readonly title: string;
  readonly timeZone: string;
  readonly location: string | null;
  readonly category: EventCategory | null;
  readonly status: EventStatus;
  readonly participants: readonly FamilyMemberId[];
}

export interface ListOccurrencesInput {
  readonly familyId: FamilyId;
  readonly from: Date;
  readonly to: Date;
  readonly readerMemberId: FamilyMemberId;
  readonly readerUserId: UserId | null;
  readonly correlationId: string;
}

/**
 * The range query, published as a port now (ARCHITECTURE.md §7.1) so the
 * dashboard aggregate and the AI read path can depend on it later without this
 * context changing shape for them. Guardian-filtered and audited exactly as
 * the HTTP route is — a second consumer gets no more permissive a read.
 */
export interface CalendarReadPort {
  listOccurrences(
    input: ListOccurrencesInput,
  ): Promise<Result<readonly OccurrenceView[], DomainError>>;
}
