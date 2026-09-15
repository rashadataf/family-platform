import { randomUUID } from 'node:crypto';
import type { TransactionClient } from './transaction.js';

/**
 * Calendar fixtures (spec 009 T016–T017).
 *
 * Like `family-factories.ts`, every writer here takes a transaction the caller
 * has ALREADY scoped with `scopeTo` — there is no unscoped write helper, so a
 * test cannot seed a row around the isolation it exists to prove.
 *
 * These seed raw rows: an event and the occurrences a test names, nothing
 * derived. A test that wants the real materialisation goes through the API or
 * the command; one that wants a precise starting state for the sweep or the
 * range query builds it here.
 */

/**
 * A clock a test controls. Structural rather than `@fp/kernel`'s `Clock`, so
 * the harness gains no workspace edge — anything with `now(): Date` fits.
 */
export interface FixedClock {
  now(): Date;
  set(instant: Date | string): void;
  advanceDays(days: number): void;
}

export function fixedClock(start: Date | string): FixedClock {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    set: (instant) => {
      current = new Date(instant);
    },
    advanceDays: (days) => {
      current = new Date(current.getTime() + days * 86_400_000);
    },
  };
}

/**
 * The two UK clock changes the recurrence kernel is tested against (SC-003).
 * Dates, not instants: which instant "the change" happens at is the thing
 * under test.
 */
export const UK_SPRING_FORWARD_2026 = '2026-03-29';
export const UK_FALL_BACK_2026 = '2026-10-25';

export interface SeededEvent {
  eventId: string;
}

interface EventBase {
  familyId: string;
  title?: string;
  timeZone?: string;
  createdByMemberId?: string | null;
  participants?: readonly string[];
}

async function addParticipants(
  tx: TransactionClient,
  params: { eventId: string; familyId: string; participants?: readonly string[] },
): Promise<void> {
  if (params.participants === undefined || params.participants.length === 0) return;
  await tx.eventParticipant.createMany({
    data: params.participants.map((memberId) => ({
      eventId: params.eventId,
      familyId: params.familyId,
      memberId,
    })),
  });
}

/** A one-off timed event with its single occurrence. */
export async function seedTimedEvent(
  tx: TransactionClient,
  params: EventBase & { startsAt: Date; endsAt: Date },
): Promise<SeededEvent & { occurrenceId: string }> {
  const eventId = randomUUID();
  const occurrenceId = randomUUID();
  await tx.calendarEvent.create({
    data: {
      id: eventId,
      familyId: params.familyId,
      title: params.title ?? 'Dentist',
      kind: 'timed',
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      timeZone: params.timeZone ?? 'Europe/London',
      createdByMemberId: params.createdByMemberId ?? null,
    },
  });
  await tx.eventOccurrence.create({
    data: {
      id: occurrenceId,
      familyId: params.familyId,
      eventId,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
    },
  });
  await addParticipants(tx, {
    eventId,
    familyId: params.familyId,
    participants: params.participants,
  });
  return { eventId, occurrenceId };
}

/**
 * A one-off all-day event. Its occurrence's instants are passed in rather than
 * computed, because computing a day's bounds in a zone is the kernel's job and
 * a fixture that did it too would be a second implementation to drift.
 */
export async function seedAllDayEvent(
  tx: TransactionClient,
  params: EventBase & {
    startDate: string;
    endDate: string;
    occurrenceStartsAt: Date;
    occurrenceEndsAt: Date;
  },
): Promise<SeededEvent> {
  const eventId = randomUUID();
  await tx.calendarEvent.create({
    data: {
      id: eventId,
      familyId: params.familyId,
      title: params.title ?? 'Birthday',
      kind: 'all_day',
      startDate: new Date(`${params.startDate}T00:00:00Z`),
      endDate: new Date(`${params.endDate}T00:00:00Z`),
      timeZone: params.timeZone ?? 'Europe/London',
      createdByMemberId: params.createdByMemberId ?? null,
    },
  });
  await tx.eventOccurrence.create({
    data: {
      familyId: params.familyId,
      eventId,
      startsAt: params.occurrenceStartsAt,
      endsAt: params.occurrenceEndsAt,
    },
  });
  await addParticipants(tx, {
    eventId,
    familyId: params.familyId,
    participants: params.participants,
  });
  return { eventId };
}

/**
 * A weekly series with the occurrence instants the test supplies and the
 * horizon marker it chooses — the starting state for a sweep test, which is
 * about what happens when `materialisedThrough` has fallen behind.
 */
export async function seedWeeklyEvent(
  tx: TransactionClient,
  params: EventBase & {
    startsAt: Date;
    endsAt: Date;
    byDay?: string;
    materialisedThrough: Date | null;
    occurrences?: readonly { startsAt: Date; endsAt: Date }[];
  },
): Promise<SeededEvent> {
  const eventId = randomUUID();
  await tx.calendarEvent.create({
    data: {
      id: eventId,
      familyId: params.familyId,
      title: params.title ?? 'Swimming',
      kind: 'timed',
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      timeZone: params.timeZone ?? 'Europe/London',
      recurrenceRule:
        params.byDay === undefined ? 'FREQ=WEEKLY' : `FREQ=WEEKLY;BYDAY=${params.byDay}`,
      materialisedThrough: params.materialisedThrough,
      createdByMemberId: params.createdByMemberId ?? null,
    },
  });
  if (params.occurrences !== undefined && params.occurrences.length > 0) {
    await tx.eventOccurrence.createMany({
      data: params.occurrences.map((occurrence) => ({
        familyId: params.familyId,
        eventId,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
      })),
    });
  }
  await addParticipants(tx, {
    eventId,
    familyId: params.familyId,
    participants: params.participants,
  });
  return { eventId };
}
