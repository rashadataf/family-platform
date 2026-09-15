import type { calendar } from '@fp/core';
import {
  asCalendarEventId,
  asEventOccurrenceId,
  asFamilyMemberId,
  type CalendarEventId,
  type EventOccurrenceId,
  type FamilyId,
} from '@fp/kernel';
import { addDays, instantToLocal, toEpochDay } from '@fp/kernel/recurrence';
import type { EventOccurrence as OccurrenceRow } from '../../generated/prisma/index.js';
import type { TransactionClient } from '../../testing.js';
import { dbDateToLocalDate } from './calendar-event.repository.js';

function toOccurrence(row: OccurrenceRow): calendar.EventOccurrence {
  return {
    id: asEventOccurrenceId(row.id),
    eventId: asCalendarEventId(row.eventId),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    cancelledAt: row.cancelledAt,
  };
}

interface RangeRow {
  id: string;
  event_id: string;
  starts_at: Date;
  ends_at: Date;
  cancelled_at: Date | null;
  kind: calendar.EventKind;
  start_date: Date | null;
  end_date: Date | null;
  title: string;
  time_zone: string;
  location: string | null;
  category: calendar.EventCategory | null;
  status: calendar.EventStatus;
  participants: string[];
}

export class PrismaEventOccurrenceRepository implements calendar.EventOccurrenceRepository {
  constructor(
    private readonly tx: TransactionClient,
    private readonly familyId: FamilyId,
  ) {}

  async listForEvent(
    eventId: CalendarEventId,
    options?: { startingFrom?: Date },
  ): Promise<readonly calendar.EventOccurrence[]> {
    const rows = await this.tx.eventOccurrence.findMany({
      where: {
        eventId,
        ...(options?.startingFrom === undefined ? {} : { startsAt: { gte: options.startingFrom } }),
      },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map(toOccurrence);
  }

  async findById(occurrenceId: EventOccurrenceId): Promise<calendar.EventOccurrence | null> {
    const row = await this.tx.eventOccurrence.findFirst({ where: { id: occurrenceId } });
    return row === null ? null : toOccurrence(row);
  }

  async applyPlan(
    eventId: CalendarEventId,
    plan: calendar.ReconcilePlan,
  ): Promise<calendar.ReconcileCounts> {
    let deleted = 0;
    if (plan.toDelete.length > 0) {
      ({ count: deleted } = await this.tx.eventOccurrence.deleteMany({
        where: { eventId, id: { in: [...plan.toDelete] } },
      }));
    }

    // `ends_at` alone. `cancelled_at` is the one authored field an occurrence
    // has, and nothing on the reconcile path may write it (FR-022).
    for (const update of plan.toUpdate) {
      await this.tx.eventOccurrence.updateMany({
        where: { id: update.id, eventId },
        data: { endsAt: update.endsAt },
      });
    }

    let inserted = 0;
    if (plan.toInsert.length > 0) {
      // `skipDuplicates` is `ON CONFLICT DO NOTHING` against the
      // `(event_id, starts_at)` identity, so even a plan computed from a stale
      // read cannot create a second row for one instant (FR-025).
      ({ count: inserted } = await this.tx.eventOccurrence.createMany({
        data: plan.toInsert.map((occurrence) => ({
          familyId: this.familyId,
          eventId,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
        })),
        skipDuplicates: true,
      }));
    }

    return { inserted, updated: plan.toUpdate.length, deleted };
  }

  async cancel(occurrenceId: EventOccurrenceId, at: Date): Promise<void> {
    await this.tx.eventOccurrence.updateMany({
      where: { id: occurrenceId, cancelledAt: null },
      data: { cancelledAt: at },
    });
  }

  async pruneForEventBefore(eventId: CalendarEventId, before: Date): Promise<number> {
    const { count } = await this.tx.eventOccurrence.deleteMany({
      where: { eventId, startsAt: { lt: before } },
    });
    return count;
  }

  async pruneRecurringBefore(before: Date): Promise<number> {
    const { count } = await this.tx.eventOccurrence.deleteMany({
      where: { startsAt: { lt: before }, event: { recurrenceRule: { not: null } } },
    });
    return count;
  }

  /**
   * research.md §7. One statement: the indexed overlap scan, the event fields
   * joined on for a view that must not be N+1, and FR-016's visibility filter
   * as a `NOT EXISTS` — so a hidden event is never a row this query returns,
   * and never a difference in how many it returns.
   *
   * `<> ALL(visible)` over an EMPTY visible set is TRUE for every participant,
   * which excludes every event that has one. That is the fail-closed reading of
   * "this reader may see nobody", with no special case.
   */
  async listVisibleInRange(
    query: calendar.RangeQuery,
  ): Promise<readonly calendar.OccurrenceView[]> {
    const visible = [...query.visibleMemberIds];
    const rows = await this.tx.$queryRaw<RangeRow[]>`
      SELECT o."id", o."event_id", o."starts_at", o."ends_at", o."cancelled_at",
             e."kind"::text AS "kind", e."start_date", e."end_date", e."title",
             e."time_zone", e."location", e."category"::text AS "category",
             e."status"::text AS "status",
             COALESCE(
               array_agg(p."member_id" ORDER BY p."added_at", p."member_id")
                 FILTER (WHERE p."member_id" IS NOT NULL),
               ARRAY[]::text[]
             ) AS "participants"
      FROM "event_occurrence" o
      JOIN "calendar_event" e ON e."id" = o."event_id" AND e."family_id" = o."family_id"
      LEFT JOIN "event_participant" p ON p."event_id" = o."event_id"
      WHERE o."starts_at" < ${query.to}
        AND (o."ends_at" > ${query.from} OR o."starts_at" >= ${query.from})
        AND NOT EXISTS (
          SELECT 1 FROM "event_participant" hp
          WHERE hp."event_id" = o."event_id"
            AND hp."member_id" <> ALL(${visible}::text[])
        )
      GROUP BY o."id", e."id"
      ORDER BY o."starts_at" ASC, o."id" ASC
    `;

    return rows.map((row) => {
      let startDate = null;
      let endDate = null;
      if (row.kind === 'all_day' && row.start_date !== null && row.end_date !== null) {
        // Read in the event's AUTHORED zone, where this instant is that date's
        // own midnight by construction — never in a reader's (FR-004).
        const local = instantToLocal(row.starts_at, row.time_zone);
        startDate = { year: local.year, month: local.month, day: local.day };
        endDate = addDays(
          startDate,
          toEpochDay(dbDateToLocalDate(row.end_date)) -
            toEpochDay(dbDateToLocalDate(row.start_date)),
        );
      }

      return {
        occurrenceId: asEventOccurrenceId(row.id),
        eventId: asCalendarEventId(row.event_id),
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        cancelledAt: row.cancelled_at,
        kind: row.kind,
        startDate,
        endDate,
        title: row.title,
        timeZone: row.time_zone,
        location: row.location,
        category: row.category,
        status: row.status,
        participants: row.participants.map(asFamilyMemberId),
      };
    });
  }

  async listHiddenParticipationsInRange(
    query: calendar.RangeQuery,
  ): Promise<readonly calendar.HiddenParticipation[]> {
    const visible = [...query.visibleMemberIds];
    const rows = await this.tx.$queryRaw<{ event_id: string; member_id: string }[]>`
      SELECT DISTINCT p."event_id", p."member_id"
      FROM "event_participant" p
      WHERE p."member_id" <> ALL(${visible}::text[])
        AND EXISTS (
          SELECT 1 FROM "event_occurrence" o
          WHERE o."event_id" = p."event_id"
            AND o."starts_at" < ${query.to}
            AND (o."ends_at" > ${query.from} OR o."starts_at" >= ${query.from})
        )
      ORDER BY p."event_id", p."member_id"
    `;
    return rows.map((row) => ({
      eventId: asCalendarEventId(row.event_id),
      memberId: asFamilyMemberId(row.member_id),
    }));
  }
}
