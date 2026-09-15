import { asCalendarEventId, asFamilyId, type CalendarEventId, type FamilyId } from '@fp/kernel';
import { prisma } from '../../client.js';

export interface DueEvent {
  readonly eventId: CalendarEventId;
  readonly familyId: FamilyId;
}

export interface FamilyHorizon {
  readonly familyId: FamilyId;
  /** `min(materialised_through)` across the family's continuing series. */
  readonly materialisedThrough: Date;
}

/**
 * The sweep's cross-family DISCOVERY reads (research.md §8). Each binds
 * `app.is_sweep` for one read-only transaction — the gate
 * `calendar_event_sweep_select` and `event_occurrence_sweep_select` open on —
 * and returns identifiers only. Every write the sweep then makes goes through
 * `withCalendarFamilyContext`, one family-scoped transaction per event.
 */

/**
 * Continuing, confirmed series whose occurrences reach less far than
 * `horizonEnd`. A one-off, an exhausted series (both `NULL`) and a cancelled
 * one are never returned, so a family whose events have all ended costs the
 * sweep one index lookup and no writes.
 */
export async function findEventsDueForMaterialisation(
  horizonEnd: Date,
): Promise<readonly DueEvent[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_sweep', 'true', true)`;
    const rows = await tx.calendarEvent.findMany({
      where: {
        recurrenceRule: { not: null },
        status: 'confirmed',
        materialisedThrough: { not: null, lt: horizonEnd },
      },
      select: { id: true, familyId: true },
      orderBy: { materialisedThrough: 'asc' },
    });
    return rows.map((row) => ({
      eventId: asCalendarEventId(row.id),
      familyId: asFamilyId(row.familyId),
    }));
  });
}

/** Families holding recurring-event occurrences older than `before` — the trailing window's work. */
export async function findFamiliesWithPrunableOccurrences(
  before: Date,
): Promise<readonly FamilyId[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_sweep', 'true', true)`;
    const rows = await tx.$queryRaw<{ family_id: string }[]>`
      SELECT DISTINCT o."family_id"
      FROM "event_occurrence" o
      JOIN "calendar_event" e ON e."id" = o."event_id"
      WHERE o."starts_at" < ${before} AND e."recurrence_rule" IS NOT NULL
    `;
    return rows.map((row) => asFamilyId(row.family_id));
  });
}

/**
 * FR-026's measure: per family, how far its continuing series are
 * materialised. `materialised_through` per event is what makes this a `min()`
 * rather than a computation.
 */
export async function measureCalendarHorizons(): Promise<readonly FamilyHorizon[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_sweep', 'true', true)`;
    const rows = await tx.$queryRaw<{ family_id: string; materialised_through: Date }[]>`
      SELECT "family_id", min("materialised_through") AS "materialised_through"
      FROM "calendar_event"
      WHERE "recurrence_rule" IS NOT NULL
        AND "status" = 'confirmed'
        AND "materialised_through" IS NOT NULL
      GROUP BY "family_id"
    `;
    return rows.map((row) => ({
      familyId: asFamilyId(row.family_id),
      materialisedThrough: row.materialised_through,
    }));
  });
}
