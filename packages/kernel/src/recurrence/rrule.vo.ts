import type { DomainError } from '../errors.js';
import { err, ok, type Result } from '../result.js';
import type { LocalDate, LocalDateTime } from './zoned-time.js';
import { daysInMonth } from './zoned-time.js';

/**
 * An RFC 5545 recurrence rule, restricted to a declared subset
 * (spec 009 research.md §2).
 *
 * | Supported | `FREQ` (`DAILY` `WEEKLY` `MONTHLY` `YEARLY`), `INTERVAL`, `COUNT`, `UNTIL`, `BYDAY`, `BYMONTHDAY`, `BYMONTH`, `WKST` |
 * |---|---|
 * | Rejected, naming the part | `BYSETPOS`, `BYWEEKNO`, `BYYEARDAY`, `BYHOUR`, `BYMINUTE`, `BYSECOND`, `FREQ=HOURLY/MINUTELY/SECONDLY`, `RDATE` |
 *
 * Anything else — an unknown keyword, a malformed value, `COUNT` with `UNTIL`
 * — is not RFC 5545 at all and is `RecurrenceInvalid`, a different kind: the
 * first tells a client "valid, but not here", the second "not a rule".
 *
 * A parsed value object rather than a string passed around (Principle I), so
 * no code downstream of `parse` ever re-reads the text and interprets it a
 * second, slightly different way.
 */

export const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** `TU` is `{ weekday: 'TU', ordinal: null }`; `-1FR` (the last Friday) is `{ weekday: 'FR', ordinal: -1 }`. */
export interface ByDay {
  readonly weekday: Weekday;
  readonly ordinal: number | null;
}

/**
 * RFC 5545 allows three forms of `UNTIL`, and they compare differently: a date
 * against an occurrence's local date, a UTC time against its instant, a
 * floating time against its local reading. Collapsing them into one `Date`
 * would silently pick one of those comparisons for all three.
 */
export type Until =
  | { readonly kind: 'date'; readonly date: LocalDate }
  | { readonly kind: 'utc'; readonly instant: Date }
  | { readonly kind: 'local'; readonly local: LocalDateTime };

export interface RecurrenceRuleProps {
  readonly freq: Frequency;
  readonly interval: number;
  readonly count: number | null;
  readonly until: Until | null;
  readonly byDay: readonly ByDay[];
  readonly byMonthDay: readonly number[];
  readonly byMonth: readonly number[];
  readonly wkst: Weekday;
}

/** Keywords that are valid RFC 5545 and deliberately outside the subset. */
const UNSUPPORTED_PARTS = new Set([
  'BYSETPOS',
  'BYWEEKNO',
  'BYYEARDAY',
  'BYHOUR',
  'BYMINUTE',
  'BYSECOND',
  'RDATE',
  'EXDATE',
  'EXRULE',
]);
const UNSUPPORTED_FREQUENCIES = new Set(['HOURLY', 'MINUTELY', 'SECONDLY']);
const SUPPORTED_PARTS = new Set([
  'FREQ',
  'INTERVAL',
  'COUNT',
  'UNTIL',
  'BYDAY',
  'BYMONTHDAY',
  'BYMONTH',
  'WKST',
]);

function invalid(reason: string): Result<never, DomainError> {
  return err({ kind: 'RecurrenceInvalid', reason });
}

function parsePositiveInteger(value: string): number | null {
  return /^\d+$/.test(value) && Number(value) >= 1 ? Number(value) : null;
}

function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}

function parseUntil(value: string): Until | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (match === null) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (date.month < 1 || date.month > 12 || date.day < 1) return null;
  if (date.day > daysInMonth(date.year, date.month)) return null;
  if (match[4] === undefined) return { kind: 'date', date };

  const local = {
    ...date,
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  };
  if (local.hour > 23 || local.minute > 59 || local.second > 59) return null;
  if (match[7] === 'Z') {
    return {
      kind: 'utc',
      instant: new Date(
        Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second),
      ),
    };
  }
  return { kind: 'local', local };
}

export class RecurrenceRule {
  private constructor(private readonly props: RecurrenceRuleProps) {}

  /**
   * Parses one RRULE value, with or without its `RRULE:` property name. Pure:
   * the same string always yields the same rule or the same error.
   */
  static parse(text: string): Result<RecurrenceRule, DomainError> {
    let body = text.trim();
    if (body === '') return invalid('A recurrence rule cannot be empty.');

    const propertyMatch = /^([A-Z-]+):/i.exec(body);
    if (propertyMatch !== null) {
      const property = (propertyMatch[1] ?? '').toUpperCase();
      if (property === 'RDATE' || property === 'EXDATE' || property === 'EXRULE') {
        return err({ kind: 'RecurrenceUnsupported', part: property });
      }
      if (property !== 'RRULE') {
        return invalid(`Expected an RRULE, found the ${property} property.`);
      }
      body = body.slice(propertyMatch[0].length);
    }

    const seen = new Map<string, string>();
    for (const segment of body.split(';')) {
      const equals = segment.indexOf('=');
      if (equals <= 0) return invalid(`"${segment}" is not a NAME=VALUE pair.`);
      const name = segment.slice(0, equals).toUpperCase();
      const value = segment.slice(equals + 1).toUpperCase();
      if (value === '') return invalid(`${name} has no value.`);
      if (seen.has(name)) return invalid(`${name} appears more than once.`);
      seen.set(name, value);
    }

    // Unsupported-but-valid parts are reported before unknown ones, so a rule
    // using BYSETPOS is told exactly that rather than a generic "invalid".
    for (const name of seen.keys()) {
      if (UNSUPPORTED_PARTS.has(name)) return err({ kind: 'RecurrenceUnsupported', part: name });
    }
    for (const name of seen.keys()) {
      if (!SUPPORTED_PARTS.has(name)) return invalid(`${name} is not an RFC 5545 rule part.`);
    }

    const freqValue = seen.get('FREQ');
    if (freqValue === undefined) return invalid('FREQ is required.');
    if (UNSUPPORTED_FREQUENCIES.has(freqValue)) {
      return err({ kind: 'RecurrenceUnsupported', part: `FREQ=${freqValue}` });
    }
    if (!(FREQUENCIES as readonly string[]).includes(freqValue)) {
      return invalid(`FREQ=${freqValue} is not a recurrence frequency.`);
    }
    const freq = freqValue as Frequency;

    let interval = 1;
    const intervalValue = seen.get('INTERVAL');
    if (intervalValue !== undefined) {
      const parsed = parsePositiveInteger(intervalValue);
      if (parsed === null) return invalid('INTERVAL must be a positive integer.');
      interval = parsed;
    }

    let count: number | null = null;
    const countValue = seen.get('COUNT');
    if (countValue !== undefined) {
      count = parsePositiveInteger(countValue);
      if (count === null) return invalid('COUNT must be a positive integer.');
    }

    let until: Until | null = null;
    const untilValue = seen.get('UNTIL');
    if (untilValue !== undefined) {
      until = parseUntil(untilValue);
      if (until === null) return invalid('UNTIL must be a DATE or DATE-TIME value.');
    }
    if (count !== null && until !== null) {
      return invalid('COUNT and UNTIL cannot both be present (RFC 5545 §3.3.10).');
    }

    const byDay: ByDay[] = [];
    const byDayValue = seen.get('BYDAY');
    if (byDayValue !== undefined) {
      for (const item of byDayValue.split(',')) {
        const match = /^([+-]?\d{1,2})?([A-Z]{2})$/.exec(item);
        const weekday = match?.[2];
        if (match === null || weekday === undefined || !isWeekday(weekday)) {
          return invalid(`BYDAY value "${item}" is not a weekday.`);
        }
        const ordinal = match[1] === undefined ? null : Number(match[1]);
        if (ordinal !== null && (ordinal === 0 || Math.abs(ordinal) > 53)) {
          return invalid(`BYDAY ordinal in "${item}" must be between -53 and 53, not zero.`);
        }
        if (ordinal !== null && (freq === 'DAILY' || freq === 'WEEKLY')) {
          return invalid(`BYDAY ordinals are only meaningful with FREQ=MONTHLY or YEARLY.`);
        }
        if (ordinal !== null && freq === 'MONTHLY' && Math.abs(ordinal) > 5) {
          return invalid(`A monthly BYDAY ordinal must be between -5 and 5.`);
        }
        byDay.push({ weekday, ordinal });
      }
    }

    const byMonthDay: number[] = [];
    const byMonthDayValue = seen.get('BYMONTHDAY');
    if (byMonthDayValue !== undefined) {
      if (freq === 'WEEKLY') return invalid('BYMONTHDAY cannot be used with FREQ=WEEKLY.');
      for (const item of byMonthDayValue.split(',')) {
        if (!/^[+-]?\d{1,2}$/.test(item))
          return invalid(`BYMONTHDAY value "${item}" is not a day.`);
        const day = Number(item);
        if (day === 0 || Math.abs(day) > 31) {
          return invalid('BYMONTHDAY must be between -31 and 31, not zero.');
        }
        byMonthDay.push(day);
      }
    }

    const byMonth: number[] = [];
    const byMonthValue = seen.get('BYMONTH');
    if (byMonthValue !== undefined) {
      for (const item of byMonthValue.split(',')) {
        if (!/^\d{1,2}$/.test(item) || Number(item) < 1 || Number(item) > 12) {
          return invalid(`BYMONTH value "${item}" is not a month.`);
        }
        byMonth.push(Number(item));
      }
    }

    let wkst: Weekday = 'MO';
    const wkstValue = seen.get('WKST');
    if (wkstValue !== undefined) {
      if (!isWeekday(wkstValue)) return invalid(`WKST=${wkstValue} is not a weekday.`);
      wkst = wkstValue;
    }

    return ok(
      new RecurrenceRule({ freq, interval, count, until, byDay, byMonthDay, byMonth, wkst }),
    );
  }

  get freq(): Frequency {
    return this.props.freq;
  }
  get interval(): number {
    return this.props.interval;
  }
  get count(): number | null {
    return this.props.count;
  }
  get until(): Until | null {
    return this.props.until;
  }
  get byDay(): readonly ByDay[] {
    return this.props.byDay;
  }
  get byMonthDay(): readonly number[] {
    return this.props.byMonthDay;
  }
  get byMonth(): readonly number[] {
    return this.props.byMonth;
  }
  get wkst(): Weekday {
    return this.props.wkst;
  }

  /**
   * The canonical text: a fixed part order, `INTERVAL` and `WKST` omitted at
   * their defaults. `parse(rule.toString())` always yields an equal rule, so
   * what is stored is exactly what was understood.
   */
  toString(): string {
    const pad = (n: number, width = 2) => String(n).padStart(width, '0');
    const parts = [`FREQ=${this.props.freq}`];
    if (this.props.interval !== 1) parts.push(`INTERVAL=${String(this.props.interval)}`);
    if (this.props.count !== null) parts.push(`COUNT=${String(this.props.count)}`);
    const until = this.props.until;
    if (until !== null) {
      if (until.kind === 'date') {
        parts.push(
          `UNTIL=${pad(until.date.year, 4)}${pad(until.date.month)}${pad(until.date.day)}`,
        );
      } else if (until.kind === 'utc') {
        const i = until.instant;
        parts.push(
          `UNTIL=${pad(i.getUTCFullYear(), 4)}${pad(i.getUTCMonth() + 1)}${pad(i.getUTCDate())}` +
            `T${pad(i.getUTCHours())}${pad(i.getUTCMinutes())}${pad(i.getUTCSeconds())}Z`,
        );
      } else {
        const l = until.local;
        parts.push(
          `UNTIL=${pad(l.year, 4)}${pad(l.month)}${pad(l.day)}T${pad(l.hour)}${pad(l.minute)}${pad(l.second)}`,
        );
      }
    }
    if (this.props.byMonth.length > 0) parts.push(`BYMONTH=${this.props.byMonth.join(',')}`);
    if (this.props.byMonthDay.length > 0) {
      parts.push(`BYMONTHDAY=${this.props.byMonthDay.join(',')}`);
    }
    if (this.props.byDay.length > 0) {
      parts.push(
        `BYDAY=${this.props.byDay
          .map((d) => `${d.ordinal === null ? '' : String(d.ordinal)}${d.weekday}`)
          .join(',')}`,
      );
    }
    if (this.props.wkst !== 'MO') parts.push(`WKST=${this.props.wkst}`);
    return parts.join(';');
  }

  equals(other: RecurrenceRule): boolean {
    return this.toString() === other.toString();
  }
}
