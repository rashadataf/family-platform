import type { DomainError } from '../errors.js';
import { err, ok, type Result } from '../result.js';
import type { PublicHolidayProvider } from './public-holiday.port.js';
import { WEEKDAYS, type ByDay, type RecurrenceRule, type Weekday } from './rrule.vo.js';
import {
  addDays,
  compareLocalDateTimes,
  compareLocalDates,
  daysInMonth,
  instantToLocal,
  isoWeekdayIndex,
  localToInstant,
  toEpochDay,
  type LocalDate,
  type LocalDateTime,
} from './zoned-time.js';

/**
 * FR-012: the most occurrences one expansion may produce inside its window.
 * Checked during expansion rather than estimated from the rule, so a rule that
 * is dense only in one stretch is caught on the same path as one dense
 * throughout (research.md §4).
 */
export const MAX_OCCURRENCES = 1000;

/**
 * A guard against a rule that can never match (`FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30`)
 * combined with a window that does not bound it. The window's end bounds the
 * loop in every realistic call; this bounds it in every call.
 */
const MAX_PERIODS = 200_000;

export interface ExpandInput {
  readonly rule: RecurrenceRule;
  /** The series' first instance, as a local reading in `timeZone` (RFC 5545 DTSTART). */
  readonly dtstart: LocalDateTime;
  readonly timeZone: string;
  /** Half-open, `[from, to)`, by occurrence start. Always an argument — "now" never appears in here. */
  readonly window: { readonly from: Date; readonly to: Date };
  /**
   * FR-014: accepted, and consulted by nothing. An occurrence on a public
   * holiday still occurs. The parameter is the seam Reference and Locale fills
   * later, so a working-day rule can be added without changing this signature
   * (research.md §2) — and SC-013's test asserts it changes no result today.
   */
  readonly holidays?: PublicHolidayProvider;
  readonly maxOccurrences?: number;
}

export interface ExpandedOccurrence {
  /** The wall-clock reading the rule produced — what a family expects to see. */
  readonly local: LocalDateTime;
  /** That reading resolved to one instant by FR-011's rule (`zoned-time.ts`). */
  readonly instant: Date;
}

export interface Expansion {
  readonly occurrences: readonly ExpandedOccurrence[];
  /**
   * True when the rule itself ended (its `COUNT` or `UNTIL`) before the window
   * did: there is nothing past this window to materialise, ever. False when the
   * window's edge is what stopped expansion (FR-010).
   */
  readonly exhausted: boolean;
}

function weekdayOf(date: LocalDate): Weekday {
  return WEEKDAYS[isoWeekdayIndex(date)] ?? 'MO';
}

function monthDates(year: number, month: number): LocalDate[] {
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => ({ year, month, day: i + 1 }));
}

function yearDates(year: number): LocalDate[] {
  return Array.from({ length: 12 }, (_, i) => monthDates(year, i + 1)).flat();
}

/** `BYMONTHDAY=-1` is the month's last day; a day the month lacks yields nothing. */
function resolveMonthDay(year: number, month: number, byMonthDay: number): LocalDate | null {
  const length = daysInMonth(year, month);
  const day = byMonthDay > 0 ? byMonthDay : length + byMonthDay + 1;
  return day >= 1 && day <= length ? { year, month, day } : null;
}

/** The `BYDAY` expansion within one scope (a month or a year), honouring ordinals. */
function expandByDay(scope: readonly LocalDate[], byDay: readonly ByDay[]): LocalDate[] {
  return byDay.flatMap((rule) => {
    const matching = scope.filter((date) => weekdayOf(date) === rule.weekday);
    if (rule.ordinal === null) return matching;
    const picked =
      rule.ordinal > 0 ? matching[rule.ordinal - 1] : matching[matching.length + rule.ordinal];
    return picked === undefined ? [] : [picked];
  });
}

/** `BYDAY` used as a limit rather than an expansion (DAILY, or alongside `BYMONTHDAY`). */
function matchesByDay(date: LocalDate, byDay: readonly ByDay[]): boolean {
  if (byDay.length === 0) return true;
  const scope = monthDates(date.year, date.month);
  return byDay.some((rule) =>
    rule.ordinal === null
      ? weekdayOf(date) === rule.weekday
      : expandByDay(scope, [rule]).some((d) => compareLocalDates(d, date) === 0),
  );
}

function matchesByMonthDay(date: LocalDate, byMonthDay: readonly number[]): boolean {
  if (byMonthDay.length === 0) return true;
  return byMonthDay.some((value) => {
    const resolved = resolveMonthDay(date.year, date.month, value);
    return resolved !== null && resolved.day === date.day;
  });
}

function matchesByMonth(date: LocalDate, byMonth: readonly number[]): boolean {
  return byMonth.length === 0 || byMonth.includes(date.month);
}

function startOfWeek(date: LocalDate, wkst: Weekday): LocalDate {
  const offset = (isoWeekdayIndex(date) - WEEKDAYS.indexOf(wkst) + 7) % 7;
  return addDays(date, -offset);
}

function addMonths(year: number, month: number, months: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + months;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * The candidate dates of period `k` — the `k`-th day, week, month or year
 * after DTSTART's, stepping by `INTERVAL` — in date order. RFC 5545's
 * expand-or-limit table, for the supported parts only.
 */
function candidatesForPeriod(rule: RecurrenceRule, start: LocalDate, k: number): LocalDate[] {
  const step = k * rule.interval;
  let dates: LocalDate[];

  switch (rule.freq) {
    case 'DAILY': {
      const date = addDays(start, step);
      dates = [date].filter(
        (d) =>
          matchesByMonth(d, rule.byMonth) &&
          matchesByMonthDay(d, rule.byMonthDay) &&
          matchesByDay(d, rule.byDay),
      );
      break;
    }
    case 'WEEKLY': {
      const weekStart = addDays(startOfWeek(start, rule.wkst), step * 7);
      const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
      const weekdays =
        rule.byDay.length > 0 ? rule.byDay.map((d) => d.weekday) : [weekdayOf(start)];
      dates = week.filter(
        (d) => weekdays.includes(weekdayOf(d)) && matchesByMonth(d, rule.byMonth),
      );
      break;
    }
    case 'MONTHLY': {
      const { year, month } = addMonths(start.year, start.month, step);
      if (!matchesByMonth({ year, month, day: 1 }, rule.byMonth)) return [];
      if (rule.byMonthDay.length > 0) {
        dates = rule.byMonthDay
          .map((value) => resolveMonthDay(year, month, value))
          .filter((d): d is LocalDate => d !== null && matchesByDay(d, rule.byDay));
      } else if (rule.byDay.length > 0) {
        dates = expandByDay(monthDates(year, month), rule.byDay);
      } else {
        const same = resolveMonthDay(year, month, start.day);
        dates = same !== null && same.day === start.day ? [same] : [];
      }
      break;
    }
    case 'YEARLY': {
      const year = start.year + step;
      if (rule.byMonthDay.length > 0) {
        const months =
          rule.byMonth.length > 0 ? rule.byMonth : Array.from({ length: 12 }, (_, i) => i + 1);
        dates = months.flatMap((month) =>
          rule.byMonthDay
            .map((value) => resolveMonthDay(year, month, value))
            .filter((d): d is LocalDate => d !== null && matchesByDay(d, rule.byDay)),
        );
      } else if (rule.byDay.length > 0) {
        dates =
          rule.byMonth.length > 0
            ? rule.byMonth.flatMap((month) => expandByDay(monthDates(year, month), rule.byDay))
            : expandByDay(yearDates(year), rule.byDay);
      } else {
        const months = rule.byMonth.length > 0 ? rule.byMonth : [start.month];
        dates = months
          .map((month) => resolveMonthDay(year, month, start.day))
          .filter((d): d is LocalDate => d !== null && d.day === start.day);
      }
      break;
    }
  }

  const unique = new Map(dates.map((d) => [toEpochDay(d), d]));
  return [...unique.entries()].sort(([a], [b]) => a - b).map(([, d]) => d);
}

/** How many whole periods lie between DTSTART and `date`, rounded down. */
function periodsBetween(rule: RecurrenceRule, start: LocalDate, date: LocalDate): number {
  switch (rule.freq) {
    case 'DAILY':
      return Math.floor((toEpochDay(date) - toEpochDay(start)) / rule.interval);
    case 'WEEKLY':
      return Math.floor(
        (toEpochDay(startOfWeek(date, rule.wkst)) - toEpochDay(startOfWeek(start, rule.wkst))) /
          (7 * rule.interval),
      );
    case 'MONTHLY':
      return Math.floor(
        (date.year * 12 + date.month - (start.year * 12 + start.month)) / rule.interval,
      );
    case 'YEARLY':
      return Math.floor((date.year - start.year) / rule.interval);
  }
}

/** The first date period `k` could contain — used only to know when the window has been passed. */
function periodStart(rule: RecurrenceRule, start: LocalDate, k: number): LocalDate {
  const step = k * rule.interval;
  switch (rule.freq) {
    case 'DAILY':
      return addDays(start, step);
    case 'WEEKLY':
      return addDays(startOfWeek(start, rule.wkst), step * 7);
    case 'MONTHLY':
      return { ...addMonths(start.year, start.month, step), day: 1 };
    case 'YEARLY':
      return { year: start.year + step, month: 1, day: 1 };
  }
}

function beyondUntil(rule: RecurrenceRule, local: LocalDateTime, instant: Date): boolean {
  const until = rule.until;
  if (until === null) return false;
  switch (until.kind) {
    case 'date':
      return compareLocalDates(local, until.date) > 0;
    case 'utc':
      return instant.getTime() > until.instant.getTime();
    case 'local':
      return compareLocalDateTimes(local, until.local) > 0;
  }
}

/**
 * Expands `rule` from `dtstart` over `window`, in LOCAL terms, resolving each
 * produced reading to an instant only at the end (research.md §3). Pure: no
 * I/O, no clock, no randomness — two calls with equal arguments return equal
 * results (SC-010).
 *
 * Expansion happens in wall-clock terms and not by adding a fixed number of
 * milliseconds per step, which is the whole of SC-003: "every Tuesday at 16:00"
 * stays 16:00 on the Tuesday after the clocks go back, and its instant moves by
 * exactly the transition offset.
 *
 * `COUNT` is counted from DTSTART, not from the window, so a window starting
 * years into a series still honours it. A rule with no `COUNT` skips straight
 * to the window instead of walking its whole history.
 *
 * DTSTART is included only if the rule produces it — RFC 5545 leaves an
 * unsynchronised DTSTART undefined, and a series that silently gained an extra
 * first occurrence would be the more surprising reading.
 */
export function expand(input: ExpandInput): Result<Expansion, DomainError> {
  const { rule, dtstart, timeZone, window } = input;
  const limit = input.maxOccurrences ?? MAX_OCCURRENCES;
  const startDate: LocalDate = { year: dtstart.year, month: dtstart.month, day: dtstart.day };
  const windowEndDate = instantToLocal(window.to, timeZone);

  let firstPeriod = 0;
  if (rule.count === null) {
    // Two days of margin either side of the window's local date covers any
    // offset a zone can have; skipping less is harmless, skipping more is not.
    const windowStartDate = addDays(instantToLocal(window.from, timeZone), -2);
    firstPeriod = Math.max(0, periodsBetween(rule, startDate, windowStartDate) - 1);
  }

  const occurrences: ExpandedOccurrence[] = [];
  let produced = 0;

  for (let k = firstPeriod; k < firstPeriod + MAX_PERIODS; k++) {
    if (compareLocalDates(periodStart(rule, startDate, k), addDays(windowEndDate, 1)) > 0) {
      return ok({ occurrences, exhausted: false });
    }

    for (const date of candidatesForPeriod(rule, startDate, k)) {
      const local: LocalDateTime = {
        ...date,
        hour: dtstart.hour,
        minute: dtstart.minute,
        second: dtstart.second,
      };
      if (compareLocalDateTimes(local, dtstart) < 0) continue;

      const instant = localToInstant(local, timeZone);
      if (beyondUntil(rule, local, instant)) return ok({ occurrences, exhausted: true });

      produced += 1;
      if (rule.count !== null && produced > rule.count) return ok({ occurrences, exhausted: true });

      if (instant.getTime() >= window.to.getTime()) {
        return ok({ occurrences, exhausted: false });
      }
      if (instant.getTime() >= window.from.getTime()) {
        occurrences.push({ local, instant });
        if (occurrences.length > limit) return err({ kind: 'RecurrenceTooDense', limit });
      }
    }
  }

  return ok({ occurrences, exhausted: false });
}
