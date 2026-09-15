import { randomUUID } from 'node:crypto';
import { asCalendarEventId, asFamilyId } from '@fp/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCalendarUnitOfWork } from './calendar-context.js';
import { PrismaClient } from './generated/prisma/index.js';

/**
 * Spec 009 T010–T011: ADR-017's assertions, repeated for Calendar's three
 * tables. Every other Calendar test goes through `withCalendarFamilyContext`;
 * these go around it, to the database, as the two roles a deployed system
 * actually uses — because the failure they exist for is one where the
 * application behaves perfectly and the isolation underneath is missing.
 */

const CALENDAR_TABLES = ['calendar_event', 'event_occurrence', 'event_participant'] as const;

function appClient(): PrismaClient {
  return new PrismaClient();
}

/**
 * The OWNER role. It owns these tables, so without `FORCE ROW LEVEL SECURITY`
 * every policy would exempt it — which is exactly the path a psql session, a
 * seed script or a migration takes.
 */
function ownerClient(): PrismaClient {
  const url = process.env.TEST_DATABASE_OWNER_URL;
  if (url === undefined || url === '') {
    throw new Error('TEST_DATABASE_OWNER_URL is not set — run via `pnpm test:integration`.');
  }
  return new PrismaClient({ datasources: { db: { url } } });
}

interface SeededCalendar {
  familyId: string;
  eventId: string;
}

async function seedFamilyWithEvent(): Promise<SeededCalendar> {
  const familyId = randomUUID();
  const memberId = randomUUID();
  const eventId = randomUUID();
  const client = appClient();

  try {
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
      await tx.family.create({ data: { id: familyId, name: 'Isolation Probe' } });
      await tx.familyMember.create({
        data: {
          id: memberId,
          familyId,
          kind: 'adult',
          role: 'owner',
          userId: randomUUID(),
          displayName: 'Probe',
        },
      });
      await tx.calendarEvent.create({
        data: {
          id: eventId,
          familyId,
          title: 'Probe event',
          kind: 'timed',
          startsAt: new Date('2026-09-20T09:00:00Z'),
          endsAt: new Date('2026-09-20T10:00:00Z'),
          timeZone: 'Europe/London',
        },
      });
      await tx.eventOccurrence.create({
        data: {
          familyId,
          eventId,
          startsAt: new Date('2026-09-20T09:00:00Z'),
          endsAt: new Date('2026-09-20T10:00:00Z'),
        },
      });
      await tx.eventParticipant.create({ data: { eventId, familyId, memberId } });
    });
  } finally {
    await client.$disconnect();
  }
  return { familyId, eventId };
}

async function eraseFamily(familyId: string): Promise<void> {
  const client = appClient();
  try {
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
      await tx.family.deleteMany({});
    });
  } finally {
    await client.$disconnect();
  }
}

async function countAll(
  client: PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
  table: string,
) {
  const rows = await client.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*) AS count FROM "${table}"`,
  );
  return rows[0]?.count;
}

describe('row-level security on Calendar tables (ADR-017, spec 009)', () => {
  let first: SeededCalendar;
  let second: SeededCalendar;

  beforeAll(async () => {
    first = await seedFamilyWithEvent();
    second = await seedFamilyWithEvent();
  });

  afterAll(async () => {
    await eraseFamily(first.familyId);
    await eraseFamily(second.familyId);
  });

  it('returns zero rows from all three tables to the application role with no context — while rows plainly exist', async () => {
    const client = appClient();
    try {
      for (const table of CALENDAR_TABLES) {
        expect(await countAll(client, table), `${table} with no app.family_id`).toBe(0n);
      }
      // "Plainly exist": the same tables, scoped, are not empty.
      await client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.family_id', ${first.familyId}::text, true)`;
        for (const table of CALENDAR_TABLES) {
          expect(await countAll(tx, table), `${table} scoped`).toBe(1n);
        }
      });
    } finally {
      await client.$disconnect();
    }
  });

  it('returns zero rows to the OWNER role with no context — FORCE is doing something', async () => {
    const client = ownerClient();
    try {
      const [who] = await client.$queryRaw<{ user: string }[]>`SELECT current_user AS user`;
      expect(who?.user).toBe('family_platform_owner');

      for (const table of CALENDAR_TABLES) {
        expect(await countAll(client, table), `${table} as owner, no context`).toBe(0n);
      }
    } finally {
      await client.$disconnect();
    }
  });

  it('shows only the scoped family inside withCalendarFamilyContext', async () => {
    const events = await createCalendarUnitOfWork().withCalendarFamilyContext(
      asFamilyId(first.familyId),
      async (uow) => ({
        own: await uow.events.findById(asCalendarEventId(first.eventId)),
        other: await uow.events.findById(asCalendarEventId(second.eventId)),
      }),
    );
    expect(events.own?.id).toBe(first.eventId);
    expect(events.other).toBeNull();
  });

  it('refuses to write an occurrence into a family other than the context', async () => {
    const client = appClient();
    try {
      await expect(
        client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.family_id', ${first.familyId}::text, true)`;
          await tx.eventOccurrence.create({
            data: {
              familyId: second.familyId,
              eventId: second.eventId,
              startsAt: new Date('2026-09-21T09:00:00Z'),
              endsAt: new Date('2026-09-21T10:00:00Z'),
            },
          });
        }),
      ).rejects.toThrow();
    } finally {
      await client.$disconnect();
    }
  });

  it('refuses an occurrence whose family_id disagrees with its event’s (the composite FK)', async () => {
    const client = appClient();
    try {
      await expect(
        client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.family_id', ${first.familyId}::text, true)`;
          await tx.eventOccurrence.create({
            data: {
              familyId: first.familyId,
              eventId: second.eventId,
              startsAt: new Date('2026-09-21T09:00:00Z'),
              endsAt: new Date('2026-09-21T10:00:00Z'),
            },
          });
        }),
      ).rejects.toThrow();
    } finally {
      await client.$disconnect();
    }
  });

  it('does not let app.family_id survive its transaction on the same pooled connection (T011)', async () => {
    const client = appClient();
    try {
      await client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.family_id', ${first.familyId}::text, true)`;
        expect(await countAll(tx, 'calendar_event')).toBe(1n);
      });

      // Same client, same pool, a new statement with no context set.
      for (const table of CALENDAR_TABLES) {
        expect(await countAll(client, table), `${table} leaked past its transaction`).toBe(0n);
      }
    } finally {
      await client.$disconnect();
    }
  });

  it('refuses an all-day event with a start time at the database, not only in the domain (event_shape)', async () => {
    const client = appClient();
    try {
      await expect(
        client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.family_id', ${first.familyId}::text, true)`;
          await tx.calendarEvent.create({
            data: {
              familyId: first.familyId,
              title: 'Mixed shape',
              kind: 'all_day',
              startDate: new Date('2026-09-20T00:00:00Z'),
              endDate: new Date('2026-09-20T00:00:00Z'),
              startsAt: new Date('2026-09-20T09:00:00Z'),
              timeZone: 'Europe/London',
            },
          });
        }),
      ).rejects.toThrow(/event_shape/);
    } finally {
      await client.$disconnect();
    }
  });

  it('refuses the same occurrence instant twice for one event — the identity the sweep rests on', async () => {
    const client = appClient();
    try {
      await expect(
        client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.family_id', ${first.familyId}::text, true)`;
          await tx.eventOccurrence.create({
            data: {
              familyId: first.familyId,
              eventId: first.eventId,
              startsAt: new Date('2026-09-20T09:00:00Z'),
              endsAt: new Date('2026-09-20T11:00:00Z'),
            },
          });
        }),
      ).rejects.toThrow();
    } finally {
      await client.$disconnect();
    }
  });
});
