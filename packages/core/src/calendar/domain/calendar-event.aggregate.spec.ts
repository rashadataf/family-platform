import { asCalendarEventId, asFamilyId, asFamilyMemberId, type DomainError } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { CalendarEvent, type EventTiming } from './calendar-event.aggregate.js';

const now = new Date('2026-09-15T10:00:00Z');
const familyId = asFamilyId('11111111-1111-7111-8111-111111111111');
const memberId = asFamilyMemberId('22222222-2222-7222-8222-222222222222');

function create(overrides: {
  timing?: EventTiming;
  timeZone?: string;
  recurrenceRule?: string | null;
  title?: string;
}) {
  return CalendarEvent.create({
    id: asCalendarEventId('33333333-3333-7333-8333-333333333333'),
    familyId,
    title: overrides.title ?? 'Dentist',
    timing: overrides.timing ?? {
      kind: 'timed',
      startsAt: new Date('2026-09-20T09:00:00Z'),
      endsAt: new Date('2026-09-20T09:30:00Z'),
    },
    timeZone: overrides.timeZone ?? 'Europe/London',
    recurrenceRule: overrides.recurrenceRule,
    createdByMemberId: memberId,
    now,
  });
}

function errorOf(result: { ok: boolean; error?: DomainError }): DomainError | undefined {
  return result.ok ? undefined : result.error;
}

function created(overrides: Parameters<typeof create>[0] = {}): CalendarEvent {
  const result = create(overrides);
  if (!result.ok) throw new Error(`expected creation to succeed: ${result.error.kind}`);
  return result.value;
}

describe('CalendarEvent.create (FR-001, FR-002, FR-004)', () => {
  it('creates a timed event, confirmed, with no participants and no marker yet', () => {
    const event = created();
    expect(event.kind).toBe('timed');
    expect(event.status).toBe('confirmed');
    expect(event.participants).toEqual([]);
    expect(event.materialisedThrough).toBeNull();
  });

  it('creates an all-day event from dates, carrying no instants', () => {
    const event = created({
      timing: {
        kind: 'all_day',
        startDate: { year: 2027, month: 3, day: 3 },
        endDate: { year: 2027, month: 3, day: 3 },
      },
    });
    expect(event.timing).toEqual({
      kind: 'all_day',
      startDate: { year: 2027, month: 3, day: 3 },
      endDate: { year: 2027, month: 3, day: 3 },
    });
    expect(Object.keys(event.timing)).not.toContain('startsAt');
  });

  it('rejects an end before the start with a specific reason, for both shapes', () => {
    const timed = create({
      timing: {
        kind: 'timed',
        startsAt: new Date('2026-09-20T09:30:00Z'),
        endsAt: new Date('2026-09-20T09:00:00Z'),
      },
    });
    expect(errorOf(timed)).toMatchObject({ kind: 'InvalidTimeRange' });
    expect((errorOf(timed) as { reason: string }).reason).toMatch(/ends before it starts/);

    const allDay = create({
      timing: {
        kind: 'all_day',
        startDate: { year: 2027, month: 3, day: 4 },
        endDate: { year: 2027, month: 3, day: 3 },
      },
    });
    expect(errorOf(allDay)).toMatchObject({ kind: 'InvalidTimeRange' });
  });

  it('accepts a zero-length timed event', () => {
    const at = new Date('2026-09-20T09:00:00Z');
    expect(create({ timing: { kind: 'timed', startsAt: at, endsAt: at } }).ok).toBe(true);
  });

  it('rejects an unrecognised IANA zone rather than defaulting', () => {
    expect(errorOf(create({ timeZone: 'Europe/Londn' }))).toEqual({
      kind: 'UnknownTimeZone',
      timeZone: 'Europe/Londn',
    });
  });

  it('rejects an unsupported or malformed rule with the kernel’s own kinds', () => {
    expect(errorOf(create({ recurrenceRule: 'FREQ=HOURLY' }))).toEqual({
      kind: 'RecurrenceUnsupported',
      part: 'FREQ=HOURLY',
    });
    expect(errorOf(create({ recurrenceRule: 'every tuesday' }))?.kind).toBe('RecurrenceInvalid');
  });

  it('stores the canonical rule, not the text it was given', () => {
    expect(
      created({ recurrenceRule: 'RRULE:byday=tu;freq=weekly' }).recurrenceRule?.toString(),
    ).toBe('FREQ=WEEKLY;BYDAY=TU');
  });

  it('the shape is unrepresentable when mixed: a timed timing has no dates to read', () => {
    const event = created();
    const timing = event.timing;
    if (timing.kind === 'timed') {
      // @ts-expect-error — a timed event has no startDate; the union forbids reading one.
      expect(timing.startDate).toBeUndefined();
    }
  });
});

describe('CalendarEvent.update (FR-019, FR-020)', () => {
  it('reports which field groups changed, and reschedules only on timing or rule', () => {
    const event = created({ recurrenceRule: 'FREQ=WEEKLY' });

    const details = event.update({ title: 'Orthodontist', location: 'High St' }, now);
    expect(details).toEqual({ ok: true, value: { changed: ['details'], reschedule: false } });

    const rule = event.update({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU,TH' }, now);
    expect(rule).toEqual({ ok: true, value: { changed: ['recurrence'], reschedule: true } });

    const time = event.update(
      {
        timing: {
          startsAt: new Date('2026-09-20T10:00:00Z'),
          endsAt: new Date('2026-09-20T10:30:00Z'),
        },
      },
      now,
    );
    expect(time).toEqual({ ok: true, value: { changed: ['timing'], reschedule: true } });
  });

  it('treats a no-op patch as no change', () => {
    const event = created();
    expect(event.update({ title: 'Dentist' }, now)).toEqual({
      ok: true,
      value: { changed: [], reschedule: false },
    });
  });

  it('refuses a patch that would put the end before the start, and leaves the event untouched', () => {
    const event = created();
    const result = event.update({ timing: { endsAt: new Date('2026-09-20T08:00:00Z') } }, now);
    expect(errorOf(result)?.kind).toBe('InvalidTimeRange');
    expect(event.timing).toMatchObject({ endsAt: new Date('2026-09-20T09:30:00Z') });
  });

  it('refuses dates on a timed event, and a kind change without both new fields', () => {
    const event = created();
    expect(
      errorOf(event.update({ timing: { startDate: { year: 2026, month: 9, day: 20 } } }, now))
        ?.kind,
    ).toBe('InvalidTimeRange');
    expect(
      errorOf(
        event.update(
          { timing: { kind: 'all_day', startDate: { year: 2026, month: 9, day: 20 } } },
          now,
        ),
      )?.kind,
    ).toBe('InvalidTimeRange');
    expect(
      event.update(
        {
          timing: {
            kind: 'all_day',
            startDate: { year: 2026, month: 9, day: 20 },
            endDate: { year: 2026, month: 9, day: 20 },
          },
        },
        now,
      ).ok,
    ).toBe(true);
    expect(event.kind).toBe('all_day');
  });

  it('removing the rule turns a series into a one-off', () => {
    const event = created({ recurrenceRule: 'FREQ=DAILY' });
    expect(event.update({ recurrenceRule: null }, now).ok).toBe(true);
    expect(event.isRecurring).toBe(false);
  });
});

describe('CalendarEvent.cancel (FR-021)', () => {
  it('is a state change, and idempotent', () => {
    const event = created();
    expect(event.cancel(now)).toBe(true);
    expect(event.status).toBe('cancelled');
    expect(event.cancel(now)).toBe(false);
    expect(event.status).toBe('cancelled');
  });
});
