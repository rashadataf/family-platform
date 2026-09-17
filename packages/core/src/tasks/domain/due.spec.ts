import { describe, expect, it } from 'vitest';
import { dueLocalDateTime, dueMomentOf, parseDue, parseLocalTime, sameDue } from './due.js';

const LONDON = 'Europe/London';

function due(input: Parameters<typeof parseDue>[0]) {
  const parsed = parseDue(input);
  if (!parsed.ok) throw new Error(`fixture did not parse: ${parsed.error.kind}`);
  return parsed.value;
}

function moment(input: Parameters<typeof parseDue>[0]): string {
  return dueMomentOf(due(input)).toISOString();
}

describe('due dates (FR-002, FR-003, research.md §4)', () => {
  describe('a date-only due is due by the END of that date, where it was written', () => {
    /**
     * The rule the whole overdue story rests on: "on the 30th" is not late at
     * 00:00 on the 30th, it is late once the 30th is over in the authoring zone.
     */
    it('resolves to the start of the next local day in BST', () => {
      expect(moment({ kind: 'date', date: '2026-09-30', timeZone: LONDON })).toBe(
        '2026-09-30T23:00:00.000Z',
      );
    });

    it('resolves to the start of the next local day in GMT', () => {
      expect(moment({ kind: 'date', date: '2026-12-01', timeZone: LONDON })).toBe(
        '2026-12-02T00:00:00.000Z',
      );
    });

    /** The offset is the NEXT day's, not the due day's — the clocks change in between. */
    it('uses the following day’s offset across the autumn change', () => {
      expect(moment({ kind: 'date', date: '2026-10-24', timeZone: LONDON })).toBe(
        '2026-10-24T23:00:00.000Z',
      );
      expect(moment({ kind: 'date', date: '2026-10-25', timeZone: LONDON })).toBe(
        '2026-10-26T00:00:00.000Z',
      );
    });

    it('is the zone’s day, not UTC’s', () => {
      expect(moment({ kind: 'date', date: '2026-09-30', timeZone: 'Pacific/Auckland' })).toBe(
        '2026-09-30T11:00:00.000Z',
      );
    });
  });

  describe('a date-time due resolves through the kernel, which owns the clock-change rule', () => {
    it('resolves an ordinary BST evening', () => {
      expect(
        moment({ kind: 'date_time', date: '2026-09-30', time: '18:30', timeZone: LONDON }),
      ).toBe('2026-09-30T17:30:00.000Z');
    });

    /** 01:30 does not exist on 2026-03-29: the clocks jump 01:00 GMT → 02:00 BST. */
    it('moves a time in the spring-forward gap to 02:30 BST', () => {
      expect(
        moment({ kind: 'date_time', date: '2026-03-29', time: '01:30', timeZone: LONDON }),
      ).toBe('2026-03-29T01:30:00.000Z');
    });

    /** 01:30 happens twice on 2026-10-25; the first (BST) is the one taken. */
    it('takes the FIRST of an ambiguous autumn time', () => {
      expect(
        moment({ kind: 'date_time', date: '2026-10-25', time: '01:30', timeZone: LONDON }),
      ).toBe('2026-10-25T00:30:00.000Z');
    });

    it('resolves midnight and the last minute of a day', () => {
      expect(
        moment({ kind: 'date_time', date: '2026-09-30', time: '00:00', timeZone: LONDON }),
      ).toBe('2026-09-29T23:00:00.000Z');
      expect(
        moment({ kind: 'date_time', date: '2026-09-30', time: '23:59', timeZone: LONDON }),
      ).toBe('2026-09-30T22:59:00.000Z');
    });
  });

  describe('refusals name what is wrong, and nothing is ever defaulted', () => {
    it('refuses a date that is not on the calendar as InvalidDue on the date field', () => {
      const result = parseDue({ kind: 'date', date: '2026-02-30', timeZone: LONDON });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({ kind: 'InvalidDue', field: 'date' });
    });

    it('refuses a malformed date as InvalidDue, not as an unknown zone', () => {
      const result = parseDue({ kind: 'date', date: '30-09-2026', timeZone: LONDON });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({ kind: 'InvalidDue', field: 'date' });
    });

    it('refuses an impossible time as InvalidDue on the time field', () => {
      for (const time of ['25:00', '12:60', '1:30', 'noon']) {
        const result = parseDue({ kind: 'date_time', date: '2026-09-30', time, timeZone: LONDON });
        expect(result.ok, time).toBe(false);
        if (result.ok) continue;
        expect(result.error, time).toMatchObject({ kind: 'InvalidDue', field: 'time' });
      }
    });

    it('refuses an unrecognised zone as UnknownTimeZone, before it looks at the date', () => {
      const result = parseDue({ kind: 'date', date: '2026-02-30', timeZone: 'Mars/Olympus_Mons' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // The zone is checked first, so an invalid date does not mask it.
      expect(result.error.kind).toBe('UnknownTimeZone');
    });

    it('accepts UTC and a fixed-offset-free IANA name alike', () => {
      expect(parseDue({ kind: 'date', date: '2026-09-30', timeZone: 'UTC' }).ok).toBe(true);
      expect(parseDue({ kind: 'date', date: '2026-09-30', timeZone: 'America/Santiago' }).ok).toBe(
        true,
      );
    });
  });

  describe('parseLocalTime', () => {
    it('accepts a zero-padded 24-hour reading and rejects anything else', () => {
      expect(parseLocalTime('00:00')).toEqual({ hour: 0, minute: 0 });
      expect(parseLocalTime('23:59')).toEqual({ hour: 23, minute: 59 });
      expect(parseLocalTime('24:00')).toBeNull();
      expect(parseLocalTime('9:30')).toBeNull();
      expect(parseLocalTime('09:30:00')).toBeNull();
    });
  });

  describe('the local reading a recurrence is anchored at', () => {
    it('is midnight for a date-only due, and the stated time otherwise', () => {
      expect(dueLocalDateTime(due({ kind: 'date', date: '2026-09-30', timeZone: LONDON }))).toEqual(
        {
          year: 2026,
          month: 9,
          day: 30,
          hour: 0,
          minute: 0,
          second: 0,
        },
      );
      expect(
        dueLocalDateTime(
          due({ kind: 'date_time', date: '2026-09-30', time: '18:30', timeZone: LONDON }),
        ),
      ).toEqual({ year: 2026, month: 9, day: 30, hour: 18, minute: 30, second: 0 });
    });
  });

  describe('sameDue', () => {
    it('treats two dues as the same only when moment, kind and zone all agree', () => {
      const a = due({ kind: 'date', date: '2026-09-30', timeZone: LONDON });
      const b = due({ kind: 'date', date: '2026-09-30', timeZone: LONDON });
      expect(sameDue(a, b)).toBe(true);
      expect(sameDue(null, null)).toBe(true);
      expect(sameDue(a, null)).toBe(false);
      expect(sameDue(a, due({ kind: 'date', date: '2026-10-01', timeZone: LONDON }))).toBe(false);
    });

    /** Same instant, different kind: a date-only due and a timed one are not interchangeable. */
    it('distinguishes a date-only due from a timed one that lands on the same instant', () => {
      const dateOnly = due({ kind: 'date', date: '2026-09-30', timeZone: LONDON });
      const timed = due({ kind: 'date_time', date: '2026-10-01', time: '00:00', timeZone: LONDON });
      expect(dueMomentOf(dateOnly).getTime()).toBe(dueMomentOf(timed).getTime());
      expect(sameDue(dateOnly, timed)).toBe(false);
    });
  });
});
