import {
  asCalendarEventId,
  asEventOccurrenceId,
  asFamilyId,
  asFamilyMemberId,
  type EventOccurrenceId,
} from '@fp/kernel';
import { instantToLocal } from '@fp/kernel/recurrence';
import { describe, expect, it } from 'vitest';
import { CalendarEvent, type EventTiming } from './calendar-event.aggregate.js';
import type { EventOccurrence } from './event-occurrence.js';
import {
  HORIZON_DAYS,
  isEmptyPlan,
  materialisationWindow,
  planOccurrences,
  reconcile,
} from './materialisation.js';

const now = new Date('2026-09-15T10:00:00Z');
const eventId = asCalendarEventId('33333333-3333-7333-8333-333333333333');

function event(timing: EventTiming, recurrenceRule: string | null = null): CalendarEvent {
  const result = CalendarEvent.create({
    id: eventId,
    familyId: asFamilyId('11111111-1111-7111-8111-111111111111'),
    title: 'Swimming',
    timing,
    timeZone: 'Europe/London',
    recurrenceRule,
    createdByMemberId: asFamilyMemberId('22222222-2222-7222-8222-222222222222'),
    now,
  });
  if (!result.ok) throw new Error(result.error.kind);
  return result.value;
}

let nextId = 0;
function rows(plan: readonly { startsAt: Date; endsAt: Date }[]): EventOccurrence[] {
  return plan.map((occurrence) => ({
    id: asEventOccurrenceId(`occ-${String(nextId++)}`),
    eventId,
    startsAt: occurrence.startsAt,
    endsAt: occurrence.endsAt,
    cancelledAt: null,
  }));
}

function planned(e: CalendarEvent) {
  const result = planOccurrences(e, materialisationWindow(now));
  if (!result.ok) throw new Error(result.error.kind);
  return result.value;
}

describe('materialisation — the non-recurring case (US1, FR-025)', () => {
  const oneOff = event({
    kind: 'timed',
    startsAt: new Date('2026-09-20T09:00:00Z'),
    endsAt: new Date('2026-09-20T09:30:00Z'),
  });

  it('produces exactly one occurrence, at the event’s own instants, with no horizon marker', () => {
    const plan = planned(oneOff);
    expect(plan.planned).toEqual([
      { startsAt: new Date('2026-09-20T09:00:00Z'), endsAt: new Date('2026-09-20T09:30:00Z') },
    ]);
    expect(plan.materialisedThrough).toBeNull();
    expect(plan.scopeFrom).toBeNull();
  });

  it('materialises a one-off far beyond the horizon all the same', () => {
    const farOff = event({
      kind: 'timed',
      startsAt: new Date('2029-01-01T09:00:00Z'),
      endsAt: new Date('2029-01-01T10:00:00Z'),
    });
    expect(planned(farOff).planned).toHaveLength(1);
  });

  it('inserts once, and re-running the reconcile against its own result inserts nothing', () => {
    const plan = planned(oneOff);
    const first = reconcile(plan.planned, []);
    expect(first.toInsert).toHaveLength(1);

    const second = reconcile(plan.planned, rows(first.toInsert));
    expect(isEmptyPlan(second)).toBe(true);
  });

  it('resolves an all-day event to its own day’s bounds in its authored zone', () => {
    const birthday = event({
      kind: 'all_day',
      startDate: { year: 2026, month: 10, day: 25 },
      endDate: { year: 2026, month: 10, day: 25 },
    });
    // The fall-back day is 25 hours long in London.
    expect(planned(birthday).planned).toEqual([
      { startsAt: new Date('2026-10-24T23:00:00Z'), endsAt: new Date('2026-10-26T00:00:00Z') },
    ]);
  });
});

describe('materialisation — the recurring case (US3, US4)', () => {
  const swimming = event(
    {
      kind: 'timed',
      startsAt: new Date('2026-09-15T15:00:00Z'),
      endsAt: new Date('2026-09-15T16:00:00Z'),
    },
    'FREQ=WEEKLY;BYDAY=TU',
  );

  it('expands over the window and marks the horizon at the window’s end', () => {
    const plan = planned(swimming);
    const window = materialisationWindow(now);
    expect(plan.materialisedThrough).toEqual(window.to);
    expect(plan.planned.length).toBeGreaterThanOrEqual(Math.floor(HORIZON_DAYS / 7));
    for (const occurrence of plan.planned) {
      expect(instantToLocal(occurrence.startsAt, 'Europe/London')).toMatchObject({
        hour: 16,
        minute: 0,
      });
      expect(occurrence.endsAt.getTime() - occurrence.startsAt.getTime()).toBe(3_600_000);
    }
  });

  it('marks nothing further to materialise once COUNT has run out', () => {
    const short = event(
      {
        kind: 'timed',
        startsAt: new Date('2026-09-15T15:00:00Z'),
        endsAt: new Date('2026-09-15T16:00:00Z'),
      },
      'FREQ=WEEKLY;COUNT=3',
    );
    const plan = planned(short);
    expect(plan.planned).toHaveLength(3);
    expect(plan.materialisedThrough).toBeNull();
  });

  it('keeps rows at instants both rules produce — and their cancellation — when the rule grows (FR-020, FR-022)', () => {
    const before = planned(swimming).planned;
    const existing = rows(before);
    const third = existing[2];
    if (third === undefined) throw new Error('expected at least three occurrences');
    const cancelled: EventOccurrence = { ...third, cancelledAt: now };
    existing[2] = cancelled;

    const grown = event(
      {
        kind: 'timed',
        startsAt: new Date('2026-09-15T15:00:00Z'),
        endsAt: new Date('2026-09-15T16:00:00Z'),
      },
      'FREQ=WEEKLY;BYDAY=TU,TH',
    );
    const plan = reconcile(planned(grown).planned, existing);

    expect(plan.toDelete).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
    // Only Thursdays are new; every Tuesday row, the cancelled one included, is kept as it is.
    expect(plan.toInsert.length).toBeGreaterThan(0);
    expect(plan.toInsert.every((o) => o.startsAt.getUTCDay() === 4)).toBe(true);
    expect(plan.toDelete).not.toContain<EventOccurrenceId>(cancelled.id);
  });

  it('drops every old row when the series’ time moves, cancellations included (research.md §5)', () => {
    const existing = rows(planned(swimming).planned);
    const moved = event(
      {
        kind: 'timed',
        startsAt: new Date('2026-09-15T16:00:00Z'),
        endsAt: new Date('2026-09-15T17:00:00Z'),
      },
      'FREQ=WEEKLY;BYDAY=TU',
    );
    const plan = reconcile(planned(moved).planned, existing);
    expect(plan.toDelete).toHaveLength(existing.length);
    expect(plan.toInsert).toHaveLength(existing.length);
  });

  it('updates the end in place when only the duration changes', () => {
    const existing = rows(planned(swimming).planned);
    const longer = event(
      {
        kind: 'timed',
        startsAt: new Date('2026-09-15T15:00:00Z'),
        endsAt: new Date('2026-09-15T16:30:00Z'),
      },
      'FREQ=WEEKLY;BYDAY=TU',
    );
    const plan = reconcile(planned(longer).planned, existing);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.toUpdate).toHaveLength(existing.length);
  });

  it('a rule edited to produce nothing deletes its future rows and is not a cancellation', () => {
    const existing = rows(planned(swimming).planned);
    const never = event(
      {
        kind: 'timed',
        startsAt: new Date('2026-09-15T15:00:00Z'),
        endsAt: new Date('2026-09-15T16:00:00Z'),
      },
      'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30',
    );
    expect(never.status).toBe('confirmed');
    expect(reconcile(planned(never).planned, existing).toDelete).toHaveLength(existing.length);
  });
});
