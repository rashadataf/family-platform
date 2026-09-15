import {
  asCalendarEventId,
  asEventOccurrenceId,
  asFamilyId,
  asFamilyMemberId,
  asUserId,
  type FamilyMemberId,
} from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { fakeMemberVisibility } from '../../../family/application/member-visibility.fake.js';
import type { MemberVisibility } from '../../../family/application/ports/member-visibility.port.js';
import { CalendarEvent } from '../../domain/calendar-event.aggregate.js';
import { emptyCalendarState, fakeCalendarUnitOfWork } from '../calendar-unit-of-work.fake.js';
import { listOccurrences } from './list-occurrences.query.js';
import { getEvent } from './get-event.query.js';

const familyId = asFamilyId('11111111-1111-7111-8111-111111111111');
const guardian = asFamilyMemberId('22222222-2222-7222-8222-222222222222');
const nonGuardian = asFamilyMemberId('55555555-5555-7555-8555-555555555555');
const child = asFamilyMemberId('44444444-4444-7444-8444-444444444444');
const eventId = asCalendarEventId('33333333-3333-7333-8333-333333333333');
const now = new Date('2026-09-15T10:00:00Z');

const visibility = new Map<FamilyMemberId, MemberVisibility>([
  [guardian, { visibleMemberIds: [guardian, nonGuardian, child], guardedChildIds: [child] }],
  [nonGuardian, { visibleMemberIds: [guardian, nonGuardian], guardedChildIds: [] }],
]);

function stateWithChildEvent() {
  const created = CalendarEvent.create({
    id: eventId,
    familyId,
    title: 'Nursery settling-in',
    timing: {
      kind: 'timed',
      startsAt: new Date('2026-09-22T09:00:00Z'),
      endsAt: new Date('2026-09-22T10:00:00Z'),
    },
    timeZone: 'Europe/London',
    participants: [child],
    createdByMemberId: guardian,
    now,
  });
  if (!created.ok) throw new Error(created.error.kind);
  return emptyCalendarState({
    events: new Map([[eventId, created.value]]),
    occurrences: [
      {
        id: asEventOccurrenceId('88888888-8888-7888-8888-888888888888'),
        eventId,
        startsAt: new Date('2026-09-22T09:00:00Z'),
        endsAt: new Date('2026-09-22T10:00:00Z'),
        cancelledAt: null,
      },
    ],
  });
}

function reader(memberId: FamilyMemberId) {
  return {
    familyId,
    memberId,
    userId: asUserId('66666666-6666-7666-8666-666666666666'),
    correlationId: 'c-1',
  };
}

describe('getEvent — FR-016, FR-017', () => {
  it('returns the child’s event to a guardian and audits the granted read', async () => {
    const state = stateWithChildEvent();
    const result = await getEvent(
      { ...reader(guardian), eventId },
      { unitOfWork: fakeCalendarUnitOfWork(state), visibility: fakeMemberVisibility(visibility) },
    );

    expect(result.ok).toBe(true);
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({
      subjectId: child,
      result: 'granted',
      actorMemberId: guardian,
    });
  });

  it('answers a non-guardian NotFound — not a distinguishable denial — and audits the denial', async () => {
    const state = stateWithChildEvent();
    const result = await getEvent(
      { ...reader(nonGuardian), eventId },
      { unitOfWork: fakeCalendarUnitOfWork(state), visibility: fakeMemberVisibility(visibility) },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({ subjectId: child, result: 'denied' });
  });

  it('fails closed for a reader the visibility port knows nothing about', async () => {
    const state = stateWithChildEvent();
    const stranger = asFamilyMemberId('77777777-7777-7777-8777-777777777777');
    const result = await getEvent(
      { ...reader(stranger), eventId },
      { unitOfWork: fakeCalendarUnitOfWork(state), visibility: fakeMemberVisibility(visibility) },
    );
    expect(result.ok).toBe(false);
  });
});

describe('listOccurrences — range validation and the in-query filter', () => {
  const deps = (state: ReturnType<typeof emptyCalendarState>) => ({
    unitOfWork: fakeCalendarUnitOfWork(state),
    visibility: fakeMemberVisibility(visibility),
  });

  it('rejects an inverted range and one wider than the horizon', async () => {
    const state = emptyCalendarState();
    const base = { familyId, readerMemberId: guardian, readerUserId: null, correlationId: 'c-1' };

    expect(
      await listOccurrences(
        { ...base, from: new Date('2026-09-20T00:00:00Z'), to: new Date('2026-09-10T00:00:00Z') },
        deps(state),
      ),
    ).toMatchObject({ ok: false, error: { kind: 'InvalidTimeRange' } });

    expect(
      await listOccurrences(
        { ...base, from: new Date('2026-01-01T00:00:00Z'), to: new Date('2027-06-01T00:00:00Z') },
        deps(state),
      ),
    ).toEqual({ ok: false, error: { kind: 'RangeTooWide', maxDays: 400 } });
  });

  it('omits the child’s event for a non-guardian and includes it for the guardian', async () => {
    const range = { from: new Date('2026-09-21T00:00:00Z'), to: new Date('2026-09-23T00:00:00Z') };

    const hiddenState = stateWithChildEvent();
    const hidden = await listOccurrences(
      { familyId, readerMemberId: nonGuardian, readerUserId: null, correlationId: 'c', ...range },
      deps(hiddenState),
    );
    expect(hidden).toEqual({ ok: true, value: [] });
    expect(hiddenState.audit.map((a) => a.result)).toEqual(['denied']);

    const shownState = stateWithChildEvent();
    const shown = await listOccurrences(
      { familyId, readerMemberId: guardian, readerUserId: null, correlationId: 'c', ...range },
      deps(shownState),
    );
    expect(shown.ok && shown.value.length).toBe(1);
    expect(shownState.audit.map((a) => a.result)).toEqual(['granted']);
  });
});
