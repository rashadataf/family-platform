import { calendar } from '@fp/core';
import {
  asCalendarEventId,
  asFamilyId,
  asFamilyMemberId,
  type CalendarEventId,
  type FamilyId,
} from '@fp/kernel';
import { RecurrenceRule, type LocalDate } from '@fp/kernel/recurrence';
import type { Prisma } from '../../generated/prisma/index.js';
import type { TransactionClient } from '../../testing.js';

/** `@db.Date` columns round-trip as a `Date` at UTC midnight; only the date part is meaningful. */
export function localDateToDbDate(date: LocalDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

export function dbDateToLocalDate(value: Date): LocalDate {
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

const withParticipants = {
  participants: { select: { memberId: true }, orderBy: [{ addedAt: 'asc' }, { memberId: 'asc' }] },
} satisfies Prisma.CalendarEventInclude;

type EventRow = Prisma.CalendarEventGetPayload<{ include: typeof withParticipants }>;

function toTiming(row: EventRow): calendar.EventTiming {
  if (row.kind === 'timed') {
    if (row.startsAt === null || row.endsAt === null) {
      // Unreachable under the `event_shape` CHECK; handled rather than asserted (Principle I).
      throw new Error(`calendar_event ${row.id} is timed but has no instants.`);
    }
    return { kind: 'timed', startsAt: row.startsAt, endsAt: row.endsAt };
  }
  if (row.startDate === null || row.endDate === null) {
    throw new Error(`calendar_event ${row.id} is all-day but has no dates.`);
  }
  return {
    kind: 'all_day',
    startDate: dbDateToLocalDate(row.startDate),
    endDate: dbDateToLocalDate(row.endDate),
  };
}

function toAggregate(row: EventRow): calendar.CalendarEvent {
  let rule: RecurrenceRule | null = null;
  if (row.recurrenceRule !== null) {
    const parsed = RecurrenceRule.parse(row.recurrenceRule);
    // Only canonical rules are ever written, so a stored rule that no longer
    // parses means the kernel's subset narrowed under existing data — loud.
    if (!parsed.ok) throw new Error(`calendar_event ${row.id} holds an unparsable rule.`);
    rule = parsed.value;
  }

  return calendar.CalendarEvent.reconstitute({
    id: asCalendarEventId(row.id),
    familyId: asFamilyId(row.familyId),
    title: row.title,
    description: row.description,
    location: row.location,
    category: row.category,
    timing: toTiming(row),
    timeZone: row.timeZone,
    recurrenceRule: rule,
    attachmentRefs: row.attachmentRefs,
    status: row.status,
    participants: row.participants.map((p) => asFamilyMemberId(p.memberId)),
    materialisedThrough: row.materialisedThrough,
    createdByMemberId:
      row.createdByMemberId === null ? null : asFamilyMemberId(row.createdByMemberId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * Scoped by construction: built from a transaction that already carries
 * `app.family_id`, so no read here names a family and none could see another's
 * rows (ADR-017). `familyId` is held only to fill the column on insert.
 */
export class PrismaCalendarEventRepository implements calendar.CalendarEventRepository {
  constructor(
    private readonly tx: TransactionClient,
    private readonly familyId: FamilyId,
  ) {}

  async save(event: calendar.CalendarEvent): Promise<void> {
    const timing = event.timing;
    const data = {
      title: event.title,
      description: event.description,
      location: event.location,
      category: event.category,
      kind: timing.kind,
      startsAt: timing.kind === 'timed' ? timing.startsAt : null,
      endsAt: timing.kind === 'timed' ? timing.endsAt : null,
      startDate: timing.kind === 'all_day' ? localDateToDbDate(timing.startDate) : null,
      endDate: timing.kind === 'all_day' ? localDateToDbDate(timing.endDate) : null,
      timeZone: event.timeZone,
      recurrenceRule: event.recurrenceRule?.toString() ?? null,
      attachmentRefs: [...event.attachmentRefs],
      status: event.status,
      materialisedThrough: event.materialisedThrough,
      // Explicit, or `@updatedAt` stamps the database's wall clock over the
      // injected one, and what a command returns disagrees with what a read
      // later finds.
      updatedAt: event.updatedAt,
    };

    await this.tx.calendarEvent.upsert({
      where: { id: event.id },
      create: {
        id: event.id,
        familyId: this.familyId,
        createdByMemberId: event.createdByMemberId,
        createdAt: event.createdAt,
        ...data,
      },
      update: data,
    });
  }

  async findById(eventId: CalendarEventId): Promise<calendar.CalendarEvent | null> {
    const row = await this.tx.calendarEvent.findFirst({
      where: { id: eventId },
      include: withParticipants,
    });
    return row === null ? null : toAggregate(row);
  }

  async lockById(eventId: CalendarEventId): Promise<calendar.CalendarEvent | null> {
    // The policy applies to FOR UPDATE as to any read, so this cannot lock a
    // row belonging to another family either.
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "calendar_event" WHERE "id" = ${eventId} FOR UPDATE
    `;
    if (locked.length === 0) return null;
    return this.findById(eventId);
  }
}
