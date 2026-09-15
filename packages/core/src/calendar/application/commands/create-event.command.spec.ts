import { asCalendarEventId, asFamilyId, asFamilyMemberId } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { emptyCalendarState, fakeCalendarUnitOfWork } from '../calendar-unit-of-work.fake.js';
import { createEvent, type CreateEventInput } from './create-event.command.js';

const familyId = asFamilyId('11111111-1111-7111-8111-111111111111');
const adultId = asFamilyMemberId('22222222-2222-7222-8222-222222222222');
const childId = asFamilyMemberId('44444444-4444-7444-8444-444444444444');
const foreignMemberId = asFamilyMemberId('99999999-9999-7999-8999-999999999999');
const clock = { now: () => new Date('2026-09-15T10:00:00Z') };

function input(overrides: Partial<CreateEventInput> = {}): CreateEventInput {
  return {
    familyId,
    eventId: asCalendarEventId('33333333-3333-7333-8333-333333333333'),
    createdByMemberId: adultId,
    title: 'Nursery settling-in',
    timing: {
      kind: 'timed',
      startsAt: new Date('2026-09-22T09:00:00Z'),
      endsAt: new Date('2026-09-22T10:00:00Z'),
    },
    timeZone: 'Europe/London',
    correlationId: 'correlation-1',
    ...overrides,
  };
}

describe('createEvent (FR-001, FR-015, FR-018)', () => {
  it('writes the event, its one occurrence and an EventCreated row, scoped to the family', async () => {
    const state = emptyCalendarState();
    const result = await createEvent(input(), { unitOfWork: fakeCalendarUnitOfWork(state), clock });

    expect(result.ok).toBe(true);
    expect(state.scopedTo).toEqual([familyId]);
    expect(state.events.size).toBe(1);
    expect(state.occurrences).toHaveLength(1);
    expect(state.outbox.map((e) => e.eventType)).toEqual(['calendar.EventCreated.v1']);
  });

  it('records an adult and a child participant as the same shape of reference', async () => {
    const state = emptyCalendarState({ familyMembers: new Set([adultId, childId]) });
    const result = await createEvent(input({ participants: [adultId, childId] }), {
      unitOfWork: fakeCalendarUnitOfWork(state),
      clock,
    });

    expect(result.ok).toBe(true);
    expect([...state.events.values()][0]?.participants).toEqual([adultId, childId]);
  });

  it('rejects a participant from outside the family and leaves nothing behind', async () => {
    const state = emptyCalendarState({ familyMembers: new Set([adultId]) });
    const result = await createEvent(input({ participants: [adultId, foreignMemberId] }), {
      unitOfWork: fakeCalendarUnitOfWork(state),
      clock,
    });

    expect(result).toEqual({ ok: false, error: { kind: 'ParticipantInvalid' } });
    expect(state.events.size).toBe(0);
    expect(state.occurrences).toHaveLength(0);
    expect(state.outbox).toHaveLength(0);
  });

  it('refuses an invalid rule before opening a transaction', async () => {
    const state = emptyCalendarState();
    const result = await createEvent(input({ recurrenceRule: 'FREQ=MINUTELY' }), {
      unitOfWork: fakeCalendarUnitOfWork(state),
      clock,
    });

    expect(result.ok).toBe(false);
    expect(state.scopedTo).toEqual([]);
  });

  it('materialises a series over the horizon and publishes OccurrenceMaterialised once', async () => {
    const state = emptyCalendarState();
    const result = await createEvent(
      input({
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU',
        timing: {
          kind: 'timed',
          startsAt: new Date('2026-09-15T15:00:00Z'),
          endsAt: new Date('2026-09-15T16:00:00Z'),
        },
      }),
      { unitOfWork: fakeCalendarUnitOfWork(state), clock },
    );

    expect(result.ok).toBe(true);
    expect(state.occurrences.length).toBeGreaterThan(50);
    expect(
      state.outbox.filter((e) => e.eventType === 'calendar.OccurrenceMaterialised.v1'),
    ).toHaveLength(1);
    expect([...state.events.values()][0]?.materialisedThrough).not.toBeNull();
  });
});
