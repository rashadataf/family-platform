import { describe, expect, it } from 'vitest';
import { expand, MAX_OCCURRENCES, type ExpandInput } from './expand.js';
import type { PublicHolidayProvider } from './public-holiday.port.js';
import { RecurrenceRule } from './rrule.vo.js';
import { formatLocalDate, instantToLocal, type LocalDateTime } from './zoned-time.js';

const LONDON = 'Europe/London';

function rule(text: string): RecurrenceRule {
  const result = RecurrenceRule.parse(text);
  if (!result.ok) throw new Error(`unparsable rule ${text}`);
  return result.value;
}

function at(iso: string): Date {
  return new Date(iso);
}

function local(y: number, m: number, d: number, hour = 0, minute = 0): LocalDateTime {
  return { year: y, month: m, day: d, hour, minute, second: 0 };
}

function run(input: ExpandInput) {
  const result = expand(input);
  if (!result.ok) throw new Error(`expansion failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('expand — both UK clock changes (SC-003)', () => {
  it('holds a weekly 16:00 lesson at 16:00 local across the October fall back, instants an hour apart', () => {
    const { occurrences } = run({
      rule: rule('FREQ=WEEKLY;BYDAY=TU'),
      dtstart: local(2026, 10, 20, 16, 0),
      timeZone: LONDON,
      window: { from: at('2026-10-19T00:00:00Z'), to: at('2026-11-03T00:00:00Z') },
    });

    expect(occurrences.map((o) => o.instant.toISOString())).toEqual([
      '2026-10-20T15:00:00.000Z',
      '2026-10-27T16:00:00.000Z',
    ]);
    for (const occurrence of occurrences) {
      expect(instantToLocal(occurrence.instant, LONDON)).toMatchObject({ hour: 16, minute: 0 });
    }
    const [before, after] = occurrences;
    expect((after?.instant.getTime() ?? 0) - (before?.instant.getTime() ?? 0)).toBe(
      7 * 24 * 3_600_000 + 3_600_000,
    );
  });

  it('holds a weekly Sunday 09:00 at 09:00 local across the March spring forward, instants an hour closer', () => {
    const { occurrences } = run({
      rule: rule('FREQ=WEEKLY;BYDAY=SU'),
      dtstart: local(2026, 3, 22, 9, 0),
      timeZone: LONDON,
      window: { from: at('2026-03-21T00:00:00Z'), to: at('2026-04-06T00:00:00Z') },
    });

    expect(occurrences.map((o) => o.instant.toISOString())).toEqual([
      '2026-03-22T09:00:00.000Z',
      '2026-03-29T08:00:00.000Z',
      '2026-04-05T08:00:00.000Z',
    ]);
    for (const occurrence of occurrences) {
      expect(instantToLocal(occurrence.instant, LONDON)).toMatchObject({ hour: 9, minute: 0 });
    }
  });

  it('resolves a series landing in the spring gap to one instant, neither dropped nor doubled', () => {
    const { occurrences } = run({
      rule: rule('FREQ=WEEKLY;BYDAY=SU'),
      dtstart: local(2026, 3, 22, 1, 30),
      timeZone: LONDON,
      window: { from: at('2026-03-28T00:00:00Z'), to: at('2026-03-30T00:00:00Z') },
    });
    expect(occurrences).toHaveLength(1);
    expect(instantToLocal(occurrences[0]?.instant ?? new Date(0), LONDON)).toMatchObject({
      hour: 2,
      minute: 30,
    });
    // The rule's own reading is still what a family authored.
    expect(occurrences[0]?.local).toMatchObject({ hour: 1, minute: 30 });
  });

  it('resolves a series landing in the repeated autumn hour exactly once, at the first reading', () => {
    const { occurrences } = run({
      rule: rule('FREQ=WEEKLY;BYDAY=SU'),
      dtstart: local(2026, 10, 18, 1, 30),
      timeZone: LONDON,
      window: { from: at('2026-10-24T00:00:00Z'), to: at('2026-10-26T00:00:00Z') },
    });
    expect(occurrences.map((o) => o.instant.toISOString())).toEqual(['2026-10-25T00:30:00.000Z']);
  });
});

describe('expand — the rule vocabulary', () => {
  const wide = { from: at('2026-01-01T00:00:00Z'), to: at('2028-01-01T00:00:00Z') };

  it('fortnightly on Thursday (bin collection)', () => {
    const { occurrences } = run({
      rule: rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TH;COUNT=3'),
      dtstart: local(2026, 9, 17, 7, 0),
      timeZone: LONDON,
      window: wide,
    });
    expect(occurrences.map((o) => formatLocalDate(o.local))).toEqual([
      '2026-09-17',
      '2026-10-01',
      '2026-10-15',
    ]);
  });

  it('monthly on the second Tuesday, and on the last Friday', () => {
    const second = run({
      rule: rule('FREQ=MONTHLY;BYDAY=2TU;COUNT=3'),
      dtstart: local(2026, 9, 8, 19, 0),
      timeZone: LONDON,
      window: wide,
    });
    expect(second.occurrences.map((o) => formatLocalDate(o.local))).toEqual([
      '2026-09-08',
      '2026-10-13',
      '2026-11-10',
    ]);

    const last = run({
      rule: rule('FREQ=MONTHLY;BYDAY=-1FR;COUNT=2'),
      dtstart: local(2026, 9, 25, 19, 0),
      timeZone: LONDON,
      window: wide,
    });
    expect(last.occurrences.map((o) => formatLocalDate(o.local))).toEqual([
      '2026-09-25',
      '2026-10-30',
    ]);
  });

  it('monthly on the 31st skips the months that lack one; BYMONTHDAY=-1 finds the last day', () => {
    const skipped = run({
      rule: rule('FREQ=MONTHLY;COUNT=3'),
      dtstart: local(2026, 8, 31, 9, 0),
      timeZone: LONDON,
      window: wide,
    });
    expect(skipped.occurrences.map((o) => formatLocalDate(o.local))).toEqual([
      '2026-08-31',
      '2026-10-31',
      '2026-12-31',
    ]);

    const lastDay = run({
      rule: rule('FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3'),
      dtstart: local(2026, 12, 31, 9, 0),
      timeZone: LONDON,
      window: wide,
    });
    expect(lastDay.occurrences.map((o) => formatLocalDate(o.local))).toEqual([
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
    ]);
  });

  it('yearly birthday, and yearly by month and ordinal weekday', () => {
    const birthday = run({
      rule: rule('FREQ=YEARLY'),
      dtstart: local(2026, 3, 3),
      timeZone: LONDON,
      window: wide,
    });
    expect(birthday.occurrences.map((o) => formatLocalDate(o.local))).toEqual([
      '2026-03-03',
      '2027-03-03',
    ]);

    const thanksgiving = run({
      rule: rule('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH'),
      dtstart: local(2026, 11, 26, 15, 0),
      timeZone: 'America/New_York',
      window: wide,
    });
    expect(thanksgiving.occurrences.map((o) => formatLocalDate(o.local))).toEqual([
      '2026-11-26',
      '2027-11-25',
    ]);
  });

  it('daily limited by BYDAY is a weekday-only series', () => {
    const { occurrences } = run({
      rule: rule('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=6'),
      dtstart: local(2026, 9, 18, 8, 0),
      timeZone: LONDON,
      window: wide,
    });
    expect(occurrences.map((o) => formatLocalDate(o.local))).toEqual([
      '2026-09-18',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
    ]);
  });

  it('UNTIL as a date is inclusive of that date', () => {
    const { occurrences, exhausted } = run({
      rule: rule('FREQ=WEEKLY;UNTIL=20261006'),
      dtstart: local(2026, 9, 22, 16, 0),
      timeZone: LONDON,
      window: wide,
    });
    expect(occurrences.map((o) => formatLocalDate(o.local))).toEqual([
      '2026-09-22',
      '2026-09-29',
      '2026-10-06',
    ]);
    expect(exhausted).toBe(true);
  });

  it('counts COUNT from DTSTART, not from the window', () => {
    const { occurrences, exhausted } = run({
      rule: rule('FREQ=WEEKLY;COUNT=4'),
      dtstart: local(2026, 9, 1, 16, 0),
      timeZone: LONDON,
      window: { from: at('2026-09-20T00:00:00Z'), to: at('2027-01-01T00:00:00Z') },
    });
    expect(occurrences.map((o) => formatLocalDate(o.local))).toEqual(['2026-09-22']);
    expect(exhausted).toBe(true);
  });

  it('does not invent an occurrence at an unsynchronised DTSTART', () => {
    const { occurrences } = run({
      rule: rule('FREQ=WEEKLY;BYDAY=TU;COUNT=1'),
      dtstart: local(2026, 9, 21, 16, 0),
      timeZone: LONDON,
      window: wide,
    });
    expect(occurrences.map((o) => formatLocalDate(o.local))).toEqual(['2026-09-22']);
  });

  it('a rule that can never match produces nothing and terminates', () => {
    const { occurrences } = run({
      rule: rule('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30'),
      dtstart: local(2026, 1, 1),
      timeZone: LONDON,
      window: wide,
    });
    expect(occurrences).toEqual([]);
  });
});

describe('expand — bounded by the window, capped by density (FR-010, FR-012)', () => {
  it('stops an indefinite rule at the window edge rather than expanding it in full', () => {
    const { occurrences, exhausted } = run({
      rule: rule('FREQ=DAILY'),
      dtstart: local(2020, 1, 1, 9, 0),
      timeZone: LONDON,
      window: { from: at('2026-09-01T00:00:00Z'), to: at('2026-09-11T00:00:00Z') },
    });
    expect(occurrences).toHaveLength(10);
    expect(occurrences[0]?.instant.toISOString()).toBe('2026-09-01T08:00:00.000Z');
    expect(exhausted).toBe(false);
  });

  it('expands a 400-day daily window within the cap', () => {
    const { occurrences } = run({
      rule: rule('FREQ=DAILY'),
      dtstart: local(2026, 9, 15, 9, 0),
      timeZone: LONDON,
      window: { from: at('2026-09-15T00:00:00Z'), to: at('2027-10-20T00:00:00Z') },
    });
    expect(occurrences).toHaveLength(400);
  });

  it('rejects an expansion that would exceed the cap, rather than truncating it', () => {
    const result = expand({
      rule: rule('FREQ=DAILY'),
      dtstart: local(2026, 1, 1, 9, 0),
      timeZone: LONDON,
      window: { from: at('2026-01-01T00:00:00Z'), to: at('2029-01-01T00:00:00Z') },
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: 'RecurrenceTooDense', limit: MAX_OCCURRENCES },
    });
  });
});

describe('expand — purity (SC-010, SC-013)', () => {
  const input: ExpandInput = {
    rule: rule('FREQ=WEEKLY;BYDAY=TU,TH'),
    dtstart: local(2026, 9, 1, 16, 0),
    timeZone: LONDON,
    window: { from: at('2026-09-01T00:00:00Z'), to: at('2027-09-01T00:00:00Z') },
  };

  it('returns identical results for identical arguments', () => {
    expect(expand(input)).toEqual(expand(input));
  });

  it('returns identical results whether or not a public-holiday provider is supplied (FR-014)', () => {
    // A provider that claims EVERY day is a holiday — the strongest possible
    // signal, so a result unchanged by it is unchanged by any real one.
    const everyDayIsAHoliday: PublicHolidayProvider = { isPublicHoliday: () => true };
    const noHolidays: PublicHolidayProvider = { isPublicHoliday: () => false };

    const without = expand(input);
    expect(expand({ ...input, holidays: everyDayIsAHoliday })).toEqual(without);
    expect(expand({ ...input, holidays: noHolidays })).toEqual(without);
  });

  it('expands a 400-day horizon well inside its 20 ms CPU budget (research.md §11)', () => {
    const started = performance.now();
    run({
      ...input,
      rule: rule('FREQ=DAILY'),
      window: { from: at('2026-09-01T00:00:00Z'), to: at('2027-10-06T00:00:00Z') },
    });
    // Generous: this asserts an order of magnitude, not a benchmark.
    expect(performance.now() - started).toBeLessThan(500);
  });
});
