import { describe, expect, it } from 'vitest';
import { RecurrenceRule } from './rrule.vo.js';

function parsed(text: string): RecurrenceRule {
  const result = RecurrenceRule.parse(text);
  if (!result.ok) throw new Error(`expected ${text} to parse, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('RecurrenceRule — the declared supported subset round-trips (research.md §2)', () => {
  it.each([
    'FREQ=DAILY',
    'FREQ=WEEKLY',
    'FREQ=MONTHLY',
    'FREQ=YEARLY',
    'FREQ=WEEKLY;INTERVAL=2',
    'FREQ=DAILY;COUNT=10',
    'FREQ=WEEKLY;UNTIL=20261231',
    'FREQ=WEEKLY;UNTIL=20261231T235959Z',
    'FREQ=WEEKLY;UNTIL=20261231T160000',
    'FREQ=WEEKLY;BYDAY=TU,TH',
    'FREQ=MONTHLY;BYDAY=2TU',
    'FREQ=MONTHLY;BYDAY=-1FR',
    'FREQ=MONTHLY;BYMONTHDAY=1,-1',
    'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=3',
    'FREQ=YEARLY;BYMONTH=11;BYDAY=1TH',
    'FREQ=WEEKLY;BYDAY=MO;WKST=SU',
  ])('%s', (text) => {
    const rule = parsed(text);
    expect(rule.toString()).toBe(text);
    expect(parsed(rule.toString()).equals(rule)).toBe(true);
  });

  it('accepts the RRULE: property prefix and lower case, and canonicalises both away', () => {
    expect(parsed('RRULE:freq=weekly;byday=tu').toString()).toBe('FREQ=WEEKLY;BYDAY=TU');
  });

  it('canonicalises part order and drops INTERVAL=1 and WKST=MO at their defaults', () => {
    expect(parsed('BYDAY=TU;WKST=MO;INTERVAL=1;FREQ=WEEKLY').toString()).toBe(
      'FREQ=WEEKLY;BYDAY=TU',
    );
  });
});

describe('RecurrenceRule — the declared rejected set names the offending part', () => {
  it.each([
    ['FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2', 'BYSETPOS'],
    ['FREQ=YEARLY;BYWEEKNO=20', 'BYWEEKNO'],
    ['FREQ=YEARLY;BYYEARDAY=100', 'BYYEARDAY'],
    ['FREQ=DAILY;BYHOUR=9', 'BYHOUR'],
    ['FREQ=DAILY;BYMINUTE=30', 'BYMINUTE'],
    ['FREQ=DAILY;BYSECOND=5', 'BYSECOND'],
    ['FREQ=HOURLY', 'FREQ=HOURLY'],
    ['FREQ=MINUTELY;INTERVAL=1', 'FREQ=MINUTELY'],
    ['FREQ=SECONDLY', 'FREQ=SECONDLY'],
    ['RDATE:20261001', 'RDATE'],
  ])('%s → RecurrenceUnsupported(%s)', (text, part) => {
    const result = RecurrenceRule.parse(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'RecurrenceUnsupported', part });
  });
});

describe('RecurrenceRule — text that is not an RFC 5545 rule at all is RecurrenceInvalid, a different kind', () => {
  it.each([
    '',
    'every tuesday',
    'FREQ',
    'FREQ=',
    'INTERVAL=2',
    'FREQ=FORTNIGHTLY',
    'FREQ=WEEKLY;INTERVAL=0',
    'FREQ=WEEKLY;INTERVAL=-1',
    'FREQ=DAILY;COUNT=abc',
    'FREQ=DAILY;COUNT=3;UNTIL=20261231',
    'FREQ=DAILY;UNTIL=20260230',
    'FREQ=WEEKLY;BYDAY=XX',
    'FREQ=WEEKLY;BYDAY=2TU',
    'FREQ=MONTHLY;BYDAY=0TU',
    'FREQ=WEEKLY;BYMONTHDAY=1',
    'FREQ=MONTHLY;BYMONTHDAY=32',
    'FREQ=YEARLY;BYMONTH=13',
    'FREQ=WEEKLY;WKST=XX',
    'FREQ=WEEKLY;FREQ=DAILY',
    'FREQ=WEEKLY;COLOUR=BLUE',
    'DTSTART:20261001T100000Z',
  ])('%j', (text) => {
    const result = RecurrenceRule.parse(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('RecurrenceInvalid');
  });
});
