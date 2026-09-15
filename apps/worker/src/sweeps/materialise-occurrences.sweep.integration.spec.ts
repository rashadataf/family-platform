import { randomUUID } from 'node:crypto';
import { calendar, family } from '@fp/core';
import {
  asCalendarEventId,
  asFamilyId,
  asFamilyMemberId,
  asUserId,
  unwrap,
  type CalendarEventId,
  type FamilyId,
  type FamilyMemberId,
} from '@fp/kernel';
import { createCalendarUnitOfWork, createFamilyUnitOfWork } from '@fp/persistence';
import { withCommit } from '@fp/persistence/testing';
import { describe, expect, it } from 'vitest';
import { runMaterialiseOccurrencesSweep } from './materialise-occurrences.sweep.js';

const DAY = 86_400_000;
const CREATED_AT = new Date('2026-09-15T10:00:00Z');

function clockAt(instant: Date) {
  return { now: () => instant };
}

async function seedFamily(): Promise<{ familyId: FamilyId; ownerId: FamilyMemberId }> {
  const familyId = asFamilyId(randomUUID());
  const ownerId = asFamilyMemberId(randomUUID());
  await createFamilyUnitOfWork().withFamilyContext(familyId, async (uow) => {
    await uow.families.save(
      unwrap(family.Family.create({ id: familyId, name: 'Sweep', now: CREATED_AT })),
    );
    await uow.members.save(
      unwrap(
        family.FamilyMember.createOwner({
          id: ownerId,
          familyId,
          userId: asUserId(randomUUID()),
          displayName: 'Ada',
          now: CREATED_AT,
        }),
      ),
    );
  });
  return { familyId, ownerId };
}

async function createSeries(
  familyId: FamilyId,
  ownerId: FamilyMemberId,
  overrides: Partial<calendar.CreateEventInput> = {},
): Promise<CalendarEventId> {
  const eventId = asCalendarEventId(randomUUID());
  unwrap(
    await calendar.createEvent(
      {
        familyId,
        eventId,
        createdByMemberId: ownerId,
        title: 'Swimming',
        timing: {
          kind: 'timed',
          startsAt: new Date('2026-09-15T15:00:00Z'),
          endsAt: new Date('2026-09-15T16:00:00Z'),
        },
        timeZone: 'Europe/London',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU',
        correlationId: randomUUID(),
        ...overrides,
      },
      { unitOfWork: createCalendarUnitOfWork(), clock: clockAt(CREATED_AT) },
    ),
  );
  return eventId;
}

async function stateOf(familyId: FamilyId, eventId: CalendarEventId) {
  return createCalendarUnitOfWork().withCalendarFamilyContext(familyId, async (uow) => ({
    event: await uow.events.findById(eventId),
    occurrences: await uow.occurrences.listForEvent(eventId),
  }));
}

describe('runMaterialiseOccurrencesSweep (US5, FR-024–FR-026)', () => {
  it('extends an indefinite series past its original horizon, so it again reaches 400 days ahead (T077)', async () => {
    const { familyId, ownerId } = await seedFamily();
    const eventId = await createSeries(familyId, ownerId);

    const before = await stateOf(familyId, eventId);
    const originalHorizon = before.event?.materialisedThrough;
    if (originalHorizon === null || originalHorizon === undefined)
      throw new Error('expected a horizon');
    const lastBefore = before.occurrences.at(-1)?.startsAt.getTime() ?? 0;

    // Past the point the original horizon would have been exhausted.
    const later = new Date(CREATED_AT.getTime() + 450 * DAY);
    const result = await runMaterialiseOccurrencesSweep(clockAt(later));
    expect(result.failed).toEqual([]);

    const after = await stateOf(familyId, eventId);
    const through = after.event?.materialisedThrough?.getTime() ?? 0;
    expect(through).toBeGreaterThanOrEqual(later.getTime() + 400 * DAY);
    expect(after.occurrences.at(-1)?.startsAt.getTime()).toBeGreaterThan(
      Math.max(lastBefore, originalHorizon.getTime()),
    );
    expect(result.lagging.find((lag) => lag.familyId === familyId)).toBeUndefined();
  });

  it('inserts nothing on a second run at the same instant — idempotence from the identity, not from memory (T078)', async () => {
    const { familyId, ownerId } = await seedFamily();
    const eventId = await createSeries(familyId, ownerId);
    const later = new Date(CREATED_AT.getTime() + 30 * DAY);

    await runMaterialiseOccurrencesSweep(clockAt(later));
    const once = await stateOf(familyId, eventId);

    const second = await runMaterialiseOccurrencesSweep(clockAt(later));
    const twice = await stateOf(familyId, eventId);

    expect(second.occurrencesInserted).toBe(0);
    expect(twice.occurrences.map((o) => o.id)).toEqual(once.occurrences.map((o) => o.id));
  });

  it('skips a family whose events are all one-offs or have ended: no writes, no marker change (T079)', async () => {
    const { familyId, ownerId } = await seedFamily();
    const oneOff = await createSeries(familyId, ownerId, { recurrenceRule: null });
    const ended = await createSeries(familyId, ownerId, { recurrenceRule: 'FREQ=WEEKLY;COUNT=3' });

    const before = {
      oneOff: await stateOf(familyId, oneOff),
      ended: await stateOf(familyId, ended),
    };
    expect(before.ended.event?.materialisedThrough).toBeNull();

    await runMaterialiseOccurrencesSweep(clockAt(new Date(CREATED_AT.getTime() + 30 * DAY)));

    const after = {
      oneOff: await stateOf(familyId, oneOff),
      ended: await stateOf(familyId, ended),
    };
    expect(after.oneOff.occurrences).toEqual(before.oneOff.occurrences);
    expect(after.ended.occurrences).toEqual(before.ended.occurrences);
    expect(after.ended.event?.updatedAt).toEqual(before.ended.event?.updatedAt);
  });

  it('prunes occurrences behind the 400-day trailing window in the same pass, leaving the event and its rule intact (T080)', async () => {
    const { familyId, ownerId } = await seedFamily();
    const eventId = await createSeries(familyId, ownerId);
    const earliest = (await stateOf(familyId, eventId)).occurrences[0]?.startsAt;
    if (earliest === undefined) throw new Error('expected occurrences');

    const later = new Date(CREATED_AT.getTime() + 500 * DAY);
    const result = await runMaterialiseOccurrencesSweep(clockAt(later));
    expect(result.occurrencesPruned).toBeGreaterThan(0);

    const after = await stateOf(familyId, eventId);
    const trailingEdge = later.getTime() - 400 * DAY;
    expect(after.occurrences.every((o) => o.startsAt.getTime() >= trailingEdge)).toBe(true);
    expect(after.occurrences.some((o) => o.startsAt.getTime() === earliest.getTime())).toBe(false);
    expect(after.event?.recurrenceRule?.toString()).toBe('FREQ=WEEKLY;BYDAY=TU');
    expect(after.event?.title).toBe('Swimming');
  });

  it('an event it cannot extend fails alone, and its family is reported as lagging — the alert (FR-026)', async () => {
    const { familyId, ownerId } = await seedFamily();
    const healthy = await createSeries(familyId, ownerId);

    // A row no command would ever write: a stored rule outside the supported
    // subset, with a horizon already behind. Seeded straight into the table,
    // standing in for whatever real fault stalls one series.
    const broken = randomUUID();
    await withCommit(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
      await tx.calendarEvent.create({
        data: {
          id: broken,
          familyId,
          title: 'Stalled',
          kind: 'timed',
          startsAt: new Date('2026-09-15T15:00:00Z'),
          endsAt: new Date('2026-09-15T16:00:00Z'),
          timeZone: 'Europe/London',
          recurrenceRule: 'FREQ=HOURLY',
          materialisedThrough: CREATED_AT,
        },
      });
    });

    const later = new Date(CREATED_AT.getTime() + 30 * DAY);
    const result = await runMaterialiseOccurrencesSweep(clockAt(later));

    expect(result.failed).toContain(broken);
    // The healthy series in the same family was still extended.
    expect(
      (await stateOf(familyId, healthy)).event?.materialisedThrough?.getTime(),
    ).toBeGreaterThanOrEqual(later.getTime() + 400 * DAY);
    const lag = result.lagging.find((l) => l.familyId === familyId);
    expect(lag?.lagSeconds).toBe(Math.floor((CREATED_AT.getTime() - later.getTime()) / 1000));
    expect(result.minLagSeconds).not.toBeNull();

    // Leave nothing that would fail every later sweep in this run.
    await withCommit(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
      await tx.calendarEvent.deleteMany({ where: { id: broken } });
    });
  });
});
