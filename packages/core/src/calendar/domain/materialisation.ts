import { ok, type DomainError, type EventOccurrenceId, type Result } from '@fp/kernel';
import {
  addDays,
  expand,
  instantToLocal,
  startOfDay,
  toEpochDay,
  type LocalDateTime,
} from '@fp/kernel/recurrence';
import type { CalendarEvent } from './calendar-event.aggregate.js';
import type { EventOccurrence, PlannedOccurrence } from './event-occurrence.js';

/**
 * The materialisation rule FR-020 and FR-022 produce together, stated once
 * because three code paths depend on it — create, edit, and the sweep
 * (data-model.md, research.md §4–§5). Pure: every input is an argument.
 */

const MS_PER_DAY = 86_400_000;

/**
 * 400 days forward, not twelve months, so an annual event always has its next
 * occurrence materialised with more than a month of margin whenever the sweep
 * last ran (research.md §4).
 */
export const HORIZON_DAYS = 400;

/** Occurrences older than this are derived data nobody needs materialised (research.md §4). */
export const TRAILING_DAYS = 400;

/** The widest range query the contract accepts — the horizon, so a range can never outrun what is materialised. */
export const MAX_RANGE_DAYS = HORIZON_DAYS;

export interface MaterialisationWindow {
  readonly from: Date;
  readonly to: Date;
}

/** `[now − trailing, now + horizon)`. `now` is an argument; this module never reads a clock. */
export function materialisationWindow(now: Date): MaterialisationWindow {
  return {
    from: new Date(now.getTime() - TRAILING_DAYS * MS_PER_DAY),
    to: new Date(now.getTime() + HORIZON_DAYS * MS_PER_DAY),
  };
}

export interface OccurrencePlan {
  readonly planned: readonly PlannedOccurrence[];
  /**
   * The value `materialised_through` should hold afterwards: the window's end
   * for a series that continues past it, `null` for a one-off or a series whose
   * COUNT/UNTIL has already run out — there is nothing further to materialise,
   * so the sweep has nothing to do and the horizon-lag gauge ignores it.
   */
  readonly materialisedThrough: Date | null;
  /**
   * Existing occurrences from this instant onward are the reconcile's scope;
   * `null` means every existing occurrence of the event. Rows older than the
   * window are left for pruning rather than deleted as "not produced".
   */
  readonly scopeFrom: Date | null;
}

/**
 * Which occurrences the event should have. A one-off has exactly one, at its
 * own instants, whatever the window — an appointment two years out still
 * appears. A series is expanded over the window in local terms.
 *
 * An all-day event still produces an instant-bounded occurrence, resolved to
 * the day's bounds in its own zone, so the range query stays one scan. The
 * DATE is never derived back from those instants by offset arithmetic — the
 * expansion produced it as a date, and the event carries it as one (FR-004).
 */
export function planOccurrences(
  event: CalendarEvent,
  window: MaterialisationWindow,
): Result<OccurrencePlan, DomainError> {
  const timing = event.timing;
  const rule = event.recurrenceRule;

  if (rule === null) {
    const planned =
      timing.kind === 'timed'
        ? { startsAt: timing.startsAt, endsAt: timing.endsAt }
        : {
            startsAt: startOfDay(timing.startDate, event.timeZone),
            endsAt: startOfDay(addDays(timing.endDate, 1), event.timeZone),
          };
    return ok({ planned: [planned], materialisedThrough: null, scopeFrom: null });
  }

  const dtstart: LocalDateTime =
    timing.kind === 'timed'
      ? instantToLocal(timing.startsAt, event.timeZone)
      : { ...timing.startDate, hour: 0, minute: 0, second: 0 };

  const expansion = expand({ rule, dtstart, timeZone: event.timeZone, window });
  if (!expansion.ok) return expansion;

  const planned: PlannedOccurrence[] = expansion.value.occurrences.map((occurrence) => {
    if (timing.kind === 'timed') {
      // Absolute duration: a one-hour lesson is an hour long on the night the
      // clocks change, too.
      const duration = timing.endsAt.getTime() - timing.startsAt.getTime();
      return {
        startsAt: occurrence.instant,
        endsAt: new Date(occurrence.instant.getTime() + duration),
      };
    }
    const spanDays = toEpochDay(timing.endDate) - toEpochDay(timing.startDate);
    return {
      startsAt: occurrence.instant,
      endsAt: startOfDay(addDays(occurrence.local, spanDays + 1), event.timeZone),
    };
  });

  return ok({
    planned,
    materialisedThrough: expansion.value.exhausted ? null : window.to,
    scopeFrom: window.from,
  });
}

export interface ReconcilePlan {
  readonly toInsert: readonly PlannedOccurrence[];
  readonly toUpdate: readonly { readonly id: EventOccurrenceId; readonly endsAt: Date }[];
  readonly toDelete: readonly EventOccurrenceId[];
}

/**
 * The reconcile, not a regenerate (research.md §5). Matched on
 * `(eventId, startsAt)`:
 *
 * 1. A planned instant with an existing row keeps that row — its id, and above
 *    all its `cancelledAt`. Only a changed end instant is written.
 * 2. A planned instant with no row is inserted.
 * 3. An existing row at an instant the rule no longer produces is deleted.
 *
 * Step 1 never touching `cancelledAt` is the whole of FR-022's persistence: an
 * individual cancellation survives every rebuild that keeps its instant, and
 * is dropped by one that moves it — which is what changing a series' time
 * does, and is correct (research.md §5).
 *
 * Re-running with the same inputs yields an empty plan. That is FR-025.
 */
export function reconcile(
  planned: readonly PlannedOccurrence[],
  existing: readonly EventOccurrence[],
): ReconcilePlan {
  const existingByStart = new Map(existing.map((row) => [row.startsAt.getTime(), row]));
  const plannedStarts = new Set<number>();

  const toInsert: PlannedOccurrence[] = [];
  const toUpdate: { id: EventOccurrenceId; endsAt: Date }[] = [];

  for (const occurrence of planned) {
    const key = occurrence.startsAt.getTime();
    if (plannedStarts.has(key)) continue;
    plannedStarts.add(key);

    const row = existingByStart.get(key);
    if (row === undefined) {
      toInsert.push(occurrence);
    } else if (row.endsAt.getTime() !== occurrence.endsAt.getTime()) {
      toUpdate.push({ id: row.id, endsAt: occurrence.endsAt });
    }
  }

  const toDelete = existing
    .filter((row) => !plannedStarts.has(row.startsAt.getTime()))
    .map((row) => row.id);

  return { toInsert, toUpdate, toDelete };
}

export function isEmptyPlan(plan: ReconcilePlan): boolean {
  return plan.toInsert.length === 0 && plan.toUpdate.length === 0 && plan.toDelete.length === 0;
}
