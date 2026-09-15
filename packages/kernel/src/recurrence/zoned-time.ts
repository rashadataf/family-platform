/**
 * Local wall-clock time ↔ instant, for an IANA time zone, with no dependency
 * (spec 009 research.md §3).
 *
 * The zone data is the runtime's own: Node ships full ICU, and
 * `Intl.DateTimeFormat` with an explicit `timeZone` reports the wall-clock
 * reading of any instant in any zone. That is enough to invert local → instant
 * by the standard two-candidate method below, and it means the tz database is
 * updated with the runtime rather than vendored here.
 *
 * Calendar arithmetic on local values (add a day, add a month) never touches
 * this file — it is done on plain `{ year, month, day }` numbers through
 * `Date.UTC`, which has no daylight saving to get wrong. Offsets enter exactly
 * once, at the final local → instant step. An all-day date never reaches that
 * step at all, which is the only way a birthday stays on its date for a reader
 * in another zone (FR-004).
 */

/** A calendar date with no zone and no time. Month is 1–12. */
export interface LocalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** A wall-clock reading with no zone. */
export interface LocalDateTime extends LocalDate {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * Memoised formatters. A cache, not state: it changes how fast an answer
 * arrives and never which answer, so expansion stays a pure function of its
 * arguments (SC-010).
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      era: 'short',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * FR-002: validated against the runtime's own zone set, never a regex, so a
 * plausible typo (`Europe/Londn`) is refused rather than defaulted.
 *
 * Offset strings (`+01:00`) are refused too. Newer ECMAScript accepts them as
 * a `timeZone`, but an offset is not a zone — it has no daylight saving rules,
 * so an event authored against one would drift by an hour twice a year, which
 * is the exact failure this component exists to prevent.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim() === '' || /^[+-]/.test(timeZone)) {
    return false;
  }
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading of `instant` in `timeZone`. */
export function instantToLocal(instant: Date, timeZone: string): LocalDateTime {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part === undefined ? 0 : Number(part.value);
  };
  const era = parts.find((p) => p.type === 'era')?.value ?? 'AD';
  const year = read('year');

  return {
    year: era === 'BC' ? 1 - year : year,
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Treats a local reading as if it were UTC — the pivot every offset calculation measures from. */
function localAsUtcMs(local: LocalDateTime): number {
  const ms = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  // `Date.UTC` maps years 0–99 onto 1900–1999; correct that so the kernel has no hidden century.
  if (local.year >= 0 && local.year < 100) {
    const date = new Date(ms);
    date.setUTCFullYear(local.year);
    return date.getTime();
  }
  return ms;
}

/** Minutes east of UTC that `timeZone` observes at `instant`. */
export function offsetMinutesAt(instant: Date, timeZone: string): number {
  const wholeSecond = Math.floor(instant.getTime() / 1000) * 1000;
  return (
    (localAsUtcMs(instantToLocal(new Date(wholeSecond), timeZone)) - wholeSecond) / MS_PER_MINUTE
  );
}

function sameLocal(a: LocalDateTime, b: LocalDateTime): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

/**
 * The one instant a local reading denotes, by FR-011's stated rule
 * (research.md §3 — Temporal's `compatible` disambiguation):
 *
 * | Case | Rule | Europe/London |
 * |---|---|---|
 * | Exists once | That instant | — |
 * | Does not exist (spring forward) | Shift forward by the gap | 01:30 on 29 Mar 2026 → 02:30 BST |
 * | Exists twice (fall back) | The first, pre-transition offset | 01:30 on 25 Oct 2026 → 01:30 BST |
 *
 * The alternatives — dropping a non-existent time, or producing both readings
 * of an ambiguous one — are defensible in the abstract and produce a missing
 * or doubled swimming lesson in practice.
 *
 * Method: the offsets a day either side of the reading bound the only two
 * offsets that could apply (no zone changes offset twice in 48 hours). Each
 * gives a candidate instant; a candidate is real if converting it back yields
 * the same reading.
 */
export function localToInstant(local: LocalDateTime, timeZone: string): Date {
  const pivot = localAsUtcMs(local);
  const offsetBefore = offsetMinutesAt(new Date(pivot - MS_PER_DAY), timeZone);
  const offsetAfter = offsetMinutesAt(new Date(pivot + MS_PER_DAY), timeZone);

  const candidates = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => pivot - offset * MS_PER_MINUTE)
    .filter((ms) => sameLocal(instantToLocal(new Date(ms), timeZone), local))
    .sort((a, b) => a - b);

  const earliest = candidates[0];
  if (earliest !== undefined) {
    // One candidate: the ordinary case. Two: the fall-back hour, where the
    // earlier instant is the one read under the pre-transition offset.
    return new Date(earliest);
  }

  // No candidate: the reading falls in a gap. Interpreting it under the offset
  // in force BEFORE the gap lands it the gap's width later on the wall clock.
  return new Date(pivot - offsetBefore * MS_PER_MINUTE);
}

/** The first instant of `date` in `timeZone` — midnight, or the first existing moment after it. */
export function startOfDay(date: LocalDate, timeZone: string): Date {
  return localToInstant({ ...date, hour: 0, minute: 0, second: 0 }, timeZone);
}

// ---------------------------------------------------------------------------
// Civil-date arithmetic. No zone, no offset, no daylight saving.
// ---------------------------------------------------------------------------

/** Days since 1970-01-01 for a local date — an integer that orders and subtracts like the dates do. */
export function toEpochDay(date: LocalDate): number {
  return Math.round(localAsUtcMs({ ...date, hour: 0, minute: 0, second: 0 }) / MS_PER_DAY);
}

export function fromEpochDay(epochDay: number): LocalDate {
  const d = new Date(epochDay * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromEpochDay(toEpochDay(date) + days);
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return toEpochDay(a) - toEpochDay(b);
}

export function compareLocalDateTimes(a: LocalDateTime, b: LocalDateTime): number {
  return localAsUtcMs(a) - localAsUtcMs(b);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = Monday … 6 = Sunday, the RFC 5545 week order. */
export function isoWeekdayIndex(date: LocalDate): number {
  return (new Date(toEpochDay(date) * MS_PER_DAY).getUTCDay() + 6) % 7;
}

/** `YYYY-MM-DD`, or `null` if the string is not a real calendar date. */
export function parseLocalDate(value: string): LocalDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (date.month < 1 || date.month > 12 || date.day < 1) return null;
  if (date.day > daysInMonth(date.year, date.month)) return null;
  return date;
}

export function formatLocalDate(date: LocalDate): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}
