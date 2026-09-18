import { describe, expect, it } from 'vitest';
import { nextOccurrenceAfter, type NextOccurrenceInput } from './next-occurrence.js';
import { RecurrenceRule } from './rrule.vo.js';
import { formatLocalDate, instantToLocal, type LocalDateTime } from './zoned-time.js';

const LONDON = 'Europe/London';

function rule(text: string): RecurrenceRule {
  const result = RecurrenceRule.parse(text);
  if (!result.ok) throw new Error(`unparsable rule ${text}`);
  return result.value;
}

function local(y: number, m: number, d: number, hour = 0, minute = 0): LocalDateTime {
  return { year: y, month: m, day: d, hour, minute, second: 0 };
}

function next(input: NextOccurrenceInput) {
  const result = nextOccurrenceAfter(input);
  if (!result.ok) throw new Error(`nextOccurrenceAfter failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/**
 * Spec 010 research.md §2, T057: the one function Tasks adds to the shared
 * kernel. Every assertion is about "after an instant", which is the question a
 * successor asks and the one `expand`'s window does not answer directly.
 */
describe('nextOccurrenceAfter', () => {
  it('finds next Thursday 19:00 across the October fall back, an hour later in UTC', () => {
    const found = next({
      rule: rule('FREQ=WEEKLY;BYDAY=TH'),
      dtstart: local(2026, 10, 22, 19, 0),
      timeZone: LONDON,
      after: new Date('2026-10-22T18:00:00Z'),
    });
    expect(found?.instant.toISOString()).toBe('2026-10-29T19:00:00.000Z');
    expect(found?.local).toMatchObject({ year: 2026, month: 10, day: 29, hour: 19, minute: 0 });
  });

  it('finds next Sunday 09:00 across the March spring forward, an hour earlier in UTC', () => {
    const found = next({
      rule: rule('FREQ=WEEKLY;BYDAY=SU'),
      dtstart: local(2026, 3, 22, 9, 0),
      timeZone: LONDON,
      after: new Date('2026-03-22T09:00:00Z'),
    });
    expect(found?.instant.toISOString()).toBe('2026-03-29T08:00:00.000Z');
    expect(instantToLocal(found?.instant ?? new Date(0), LONDON)).toMatchObject({ hour: 9 });
  });

  it('is exclusive of `after`: an occurrence exactly at it is not returned', () => {
    const found = next({
      rule: rule('FREQ=DAILY'),
      dtstart: local(2026, 9, 15, 8, 0),
      timeZone: LONDON,
      after: new Date('2026-09-16T07:00:00Z'), // 08:00 BST on the 16th
    });
    expect(found?.local).toMatchObject({ day: 17, hour: 8 });
  });

  it('skips straight past missed dates when `after` is weeks late', () => {
    const found = next({
      rule: rule('FREQ=WEEKLY;BYDAY=TH'),
      dtstart: local(2026, 9, 3, 19, 0),
      timeZone: LONDON,
      after: new Date('2026-09-25T12:00:00Z'), // a Friday, three Thursdays on
    });
    expect(formatLocalDate(found?.local ?? local(1970, 1, 1))).toBe('2026-10-01');
  });

  it('counts COUNT from dtstart, so the call after the last occurrence returns null', () => {
    const input = {
      rule: rule('FREQ=WEEKLY;COUNT=3'),
      dtstart: local(2026, 9, 1, 10, 0),
      timeZone: LONDON,
    };
    expect(
      formatLocalDate(
        next({ ...input, after: new Date('2026-09-08T09:00:00Z') })?.local ?? local(1970, 1, 1),
      ),
    ).toBe('2026-09-15');
    expect(next({ ...input, after: new Date('2026-09-15T09:00:00Z') })).toBeNull();
  });

  it('returns null once UNTIL has passed', () => {
    expect(
      next({
        rule: rule('FREQ=DAILY;UNTIL=20260910'),
        dtstart: local(2026, 9, 1, 10, 0),
        timeZone: LONDON,
        after: new Date('2026-09-10T12:00:00Z'),
      }),
    ).toBeNull();
  });

  it('finds a leap-day rule years ahead, well inside the 5 ms budget', () => {
    const startedAt = performance.now();
    const found = next({
      rule: rule('FREQ=YEARLY;INTERVAL=4;BYMONTH=2;BYMONTHDAY=29'),
      dtstart: local(2024, 2, 29, 9, 0),
      timeZone: LONDON,
      after: new Date('2024-03-01T00:00:00Z'),
    });
    const elapsed = performance.now() - startedAt;
    expect(formatLocalDate(found?.local ?? local(1970, 1, 1))).toBe('2028-02-29');
    expect(elapsed).toBeLessThan(50); // generous for CI noise; the budget is 5 ms
  });

  it('returns null, bounded, for a rule that can never match', () => {
    expect(
      next({
        rule: rule('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30'),
        dtstart: local(2026, 1, 1, 9, 0),
        timeZone: LONDON,
        after: new Date('2026-01-01T00:00:00Z'),
      }),
    ).toBeNull();
  });

  it('keeps a date-only series on its local date in a zone whose clocks change at midnight', () => {
    // America/Santiago springs forward at 00:00 on the first Sunday of September 2026.
    const found = next({
      rule: rule('FREQ=WEEKLY;BYDAY=SU'),
      dtstart: local(2026, 8, 30, 0, 0),
      timeZone: 'America/Santiago',
      after: new Date('2026-08-31T12:00:00Z'),
    });
    expect(formatLocalDate(found?.local ?? local(1970, 1, 1))).toBe('2026-09-06');
  });

  it('returns identical results for identical calls', () => {
    const input = {
      rule: rule('FREQ=MONTHLY;BYMONTHDAY=-1'),
      dtstart: local(2026, 1, 31, 7, 30),
      timeZone: LONDON,
      after: new Date('2026-02-01T00:00:00Z'),
    };
    expect(next(input)).toEqual(next(input));
  });
});
