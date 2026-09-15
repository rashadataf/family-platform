import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatLocalDate,
  instantToLocal,
  isValidTimeZone,
  localToInstant,
  offsetMinutesAt,
  parseLocalDate,
  startOfDay,
} from './zoned-time.js';

const LONDON = 'Europe/London';

describe('isValidTimeZone — the runtime zone set, not a regex (FR-002)', () => {
  it.each(['Europe/London', 'America/New_York', 'Asia/Kolkata', 'Pacific/Chatham', 'UTC'])(
    'accepts %s',
    (zone) => {
      expect(isValidTimeZone(zone)).toBe(true);
    },
  );

  it.each(['Europe/Londn', 'London', 'GMT+1', '+01:00', '-05:00', '', '  '])(
    'refuses %j',
    (zone) => {
      expect(isValidTimeZone(zone)).toBe(false);
    },
  );
});

describe('localToInstant — UK spring forward, 29 March 2026 (research.md §3)', () => {
  it('resolves a local time that does not exist forward across the gap: 01:30 → 02:30 BST', () => {
    const instant = localToInstant(
      { year: 2026, month: 3, day: 29, hour: 1, minute: 30, second: 0 },
      LONDON,
    );
    expect(instant.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(instantToLocal(instant, LONDON)).toMatchObject({ hour: 2, minute: 30 });
  });

  it('leaves times either side of the gap alone', () => {
    expect(
      localToInstant(
        { year: 2026, month: 3, day: 29, hour: 0, minute: 30, second: 0 },
        LONDON,
      ).toISOString(),
    ).toBe('2026-03-29T00:30:00.000Z');
    expect(
      localToInstant(
        { year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0 },
        LONDON,
      ).toISOString(),
    ).toBe('2026-03-29T01:30:00.000Z');
  });
});

describe('localToInstant — UK fall back, 25 October 2026 (research.md §3)', () => {
  it('resolves a local time that occurs twice to the FIRST, pre-transition offset: 01:30 → 01:30 BST', () => {
    const instant = localToInstant(
      { year: 2026, month: 10, day: 25, hour: 1, minute: 30, second: 0 },
      LONDON,
    );
    // 01:30 BST is 00:30Z; the second reading, 01:30 GMT, would be 01:30Z.
    expect(instant.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(offsetMinutesAt(instant, LONDON)).toBe(60);
  });

  it('reads the offsets on either side correctly', () => {
    expect(offsetMinutesAt(new Date('2026-10-24T12:00:00Z'), LONDON)).toBe(60);
    expect(offsetMinutesAt(new Date('2026-10-26T12:00:00Z'), LONDON)).toBe(0);
  });
});

describe('localToInstant — beyond the UK', () => {
  it('handles a half-hour zone and a 45-minute zone', () => {
    expect(
      localToInstant(
        { year: 2026, month: 6, day: 1, hour: 9, minute: 0, second: 0 },
        'Asia/Kolkata',
      ).toISOString(),
    ).toBe('2026-06-01T03:30:00.000Z');
    expect(
      localToInstant(
        { year: 2026, month: 6, day: 1, hour: 9, minute: 0, second: 0 },
        'Pacific/Chatham',
      ).toISOString(),
    ).toBe('2026-05-31T20:15:00.000Z');
  });

  it('handles a US transition on a different weekend from the UK', () => {
    // 8 March 2026: America/New_York skips 02:00–03:00.
    expect(
      localToInstant(
        { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-03-08T07:30:00.000Z');
  });
});

describe('all-day dates never pass through offset arithmetic (FR-004)', () => {
  it('keeps a date the same date whichever zone later reads the day bounds', () => {
    const birthday = parseLocalDate('2027-03-03');
    expect(birthday).not.toBeNull();
    if (birthday === null) return;

    // A zone with a large positive offset and one with a large negative one:
    // the date arithmetic is identical in both, because it involves no zone.
    expect(formatLocalDate(addDays(birthday, 0))).toBe('2027-03-03');
    const kiritimati = startOfDay(birthday, 'Pacific/Kiritimati');
    const honolulu = startOfDay(birthday, 'Pacific/Honolulu');
    expect(instantToLocal(kiritimati, 'Pacific/Kiritimati')).toMatchObject({
      year: 2027,
      month: 3,
      day: 3,
      hour: 0,
    });
    expect(instantToLocal(honolulu, 'Pacific/Honolulu')).toMatchObject({
      year: 2027,
      month: 3,
      day: 3,
      hour: 0,
    });
    // Read from its own zone, a day-bound instant maps back to the authored date.
    expect(formatLocalDate(instantToLocal(kiritimati, 'Pacific/Kiritimati'))).toBe('2027-03-03');
  });

  it('crosses month and year boundaries as dates', () => {
    const newYearsEve = parseLocalDate('2026-12-31');
    if (newYearsEve === null) throw new Error('unparsable');
    expect(formatLocalDate(addDays(newYearsEve, 1))).toBe('2027-01-01');
    expect(formatLocalDate(addDays(newYearsEve, -365))).toBe('2025-12-31');
  });

  it('refuses a date that is not on the calendar', () => {
    expect(parseLocalDate('2026-02-29')).toBeNull();
    expect(parseLocalDate('2028-02-29')).not.toBeNull();
    expect(parseLocalDate('2026-13-01')).toBeNull();
    expect(parseLocalDate('03/03/2027')).toBeNull();
  });
});
