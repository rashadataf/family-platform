import {
  err,
  ok,
  type CalendarEventId,
  type DomainError,
  type FamilyMemberId,
  type Result,
} from '@fp/kernel';
import type { MemberVisibilityPort } from '../../../family/application/ports/member-visibility.port.js';
import { MAX_RANGE_DAYS } from '../../domain/materialisation.js';
import type { ListOccurrencesInput, OccurrenceView } from '../ports/calendar-read.port.js';
import type { CalendarUnitOfWorkPort } from '../ports/calendar-unit-of-work.port.js';
import {
  auditChildParticipation,
  guardedChildParticipants,
  resolveVisibility,
} from '../visibility.js';

const MS_PER_DAY = 86_400_000;

function groupByEvent<T extends { eventId: CalendarEventId }>(
  rows: readonly T[],
  members: (row: T) => readonly FamilyMemberId[],
): Map<CalendarEventId, FamilyMemberId[]> {
  const grouped = new Map<CalendarEventId, FamilyMemberId[]>();
  for (const row of rows) {
    const existing = grouped.get(row.eventId) ?? [];
    for (const member of members(row)) {
      if (!existing.includes(member)) existing.push(member);
    }
    grouped.set(row.eventId, existing);
  }
  return grouped;
}

/**
 * `GET /v1/families/:familyId/occurrences?from=&to=` — and the implementation
 * behind `CalendarReadPort`.
 *
 * Reads materialised rows only; no rule is expanded here (FR-007). The window
 * may be no wider than the horizon, because a wider one would silently
 * under-report instead of erroring (contracts/calendar-api.md).
 *
 * The guardian filter is applied IN the query (research.md §7). Filtering a
 * fetched page afterwards would make an excluded event observable through the
 * result count — the inference FR-016 forbids — so the hidden events are never
 * in the result to begin with. They are looked up separately, only to audit
 * the denial, and that lookup never touches the response.
 */
export async function listOccurrences(
  input: ListOccurrencesInput,
  deps: { unitOfWork: CalendarUnitOfWorkPort; visibility: MemberVisibilityPort },
): Promise<Result<readonly OccurrenceView[], DomainError>> {
  if (Number.isNaN(input.from.getTime()) || Number.isNaN(input.to.getTime())) {
    return err({ kind: 'InvalidTimeRange', reason: 'from and to must be real instants.' });
  }
  if (input.to.getTime() <= input.from.getTime()) {
    return err({ kind: 'InvalidTimeRange', reason: 'to must be after from.' });
  }
  if (input.to.getTime() - input.from.getTime() > MAX_RANGE_DAYS * MS_PER_DAY) {
    return err({ kind: 'RangeTooWide', maxDays: MAX_RANGE_DAYS });
  }

  const visibility = await resolveVisibility(deps.visibility, {
    familyId: input.familyId,
    memberId: input.readerMemberId,
    userId: input.readerUserId,
    correlationId: input.correlationId,
  });
  const reader = {
    familyId: input.familyId,
    memberId: input.readerMemberId,
    userId: input.readerUserId,
    correlationId: input.correlationId,
  };

  return deps.unitOfWork.withCalendarFamilyContext(input.familyId, async (uow) => {
    const query = { from: input.from, to: input.to, visibleMemberIds: visibility.visibleMemberIds };
    const [visible, hidden] = await Promise.all([
      uow.occurrences.listVisibleInRange(query),
      uow.occurrences.listHiddenParticipationsInRange(query),
    ]);

    for (const [eventId, children] of groupByEvent(visible, (row) =>
      guardedChildParticipants(row.participants, visibility),
    )) {
      await auditChildParticipation(uow.audit, {
        reader,
        eventId,
        childMemberIds: children,
        view: 'calendar range',
        result: 'granted',
      });
    }
    for (const [eventId, members] of groupByEvent(hidden, (row) => [row.memberId])) {
      await auditChildParticipation(uow.audit, {
        reader,
        eventId,
        childMemberIds: members,
        view: 'calendar range',
        result: 'denied',
      });
    }

    return ok(visible);
  });
}
