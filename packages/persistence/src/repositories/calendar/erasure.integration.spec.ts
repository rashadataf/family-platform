import { randomUUID } from 'node:crypto';
import { asFamilyId, asFamilyMemberId } from '@fp/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../generated/prisma/index.js';
import { eraseCalendarForFamily, eraseCalendarForMember } from './erasure.js';

/** Spec 009 T085: Principle XI's two operations, tested directly. */
describe('Calendar erasure (Principle XI, FR-033)', () => {
  const client = new PrismaClient();

  async function scoped<T>(
    familyId: string,
    work: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
  ) {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
      return work(tx);
    });
  }

  async function seed() {
    const familyId = randomUUID();
    const owner = randomUUID();
    const child = randomUUID();
    const eventId = randomUUID();
    await scoped(familyId, async (tx) => {
      await tx.family.create({ data: { id: familyId, name: 'Erasure' } });
      await tx.familyMember.createMany({
        data: [
          {
            id: owner,
            familyId,
            kind: 'adult',
            role: 'owner',
            userId: randomUUID(),
            displayName: 'Ada',
          },
          { id: child, familyId, kind: 'child', role: 'viewer', displayName: 'Charlie' },
        ],
      });
      await tx.calendarEvent.create({
        data: {
          id: eventId,
          familyId,
          title: "Charlie's dentist",
          kind: 'timed',
          startsAt: new Date('2026-09-20T09:00:00Z'),
          endsAt: new Date('2026-09-20T10:00:00Z'),
          timeZone: 'Europe/London',
          createdByMemberId: owner,
          attachmentRefs: ['doc:opaque-1'],
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
      await tx.eventParticipant.createMany({
        data: [
          { eventId, familyId, memberId: owner },
          { eventId, familyId, memberId: child },
        ],
      });
    });
    return { familyId, owner, child, eventId };
  }

  let bystander: Awaited<ReturnType<typeof seed>>;

  beforeAll(async () => {
    bystander = await seed();
  });

  afterAll(async () => {
    await scoped(bystander.familyId, (tx) => tx.family.deleteMany({}));
    await client.$disconnect();
  });

  it('eraseForFamily leaves no row in any Calendar table referencing the family, and touches no other family', async () => {
    const target = await seed();
    await eraseCalendarForFamily(asFamilyId(target.familyId));

    const remaining = await scoped(target.familyId, async (tx) => ({
      events: await tx.calendarEvent.count(),
      occurrences: await tx.eventOccurrence.count(),
      participants: await tx.eventParticipant.count(),
    }));
    expect(remaining).toEqual({ events: 0, occurrences: 0, participants: 0 });

    const untouched = await scoped(bystander.familyId, (tx) => tx.calendarEvent.count());
    expect(untouched).toBe(1);

    await scoped(target.familyId, (tx) => tx.family.deleteMany({}));
  });

  it('eraseForMember removes only that member’s participations — the event and its free-text title survive', async () => {
    const target = await seed();
    await eraseCalendarForMember(asFamilyMemberId(target.child));

    const after = await scoped(target.familyId, async (tx) => ({
      participants: await tx.eventParticipant.findMany({ select: { memberId: true } }),
      event: await tx.calendarEvent.findFirst({ where: { id: target.eventId } }),
      occurrences: await tx.eventOccurrence.count(),
    }));

    expect(after.participants.map((p) => p.memberId)).toEqual([target.owner]);
    // The stated limitation (data-model.md): authored text is not machine-scrubbed.
    expect(after.event?.title).toBe("Charlie's dentist");
    expect(after.event?.createdByMemberId).toBe(target.owner);
    expect(after.occurrences).toBe(1);

    const bystanderParticipants = await scoped(bystander.familyId, (tx) =>
      tx.eventParticipant.count(),
    );
    expect(bystanderParticipants).toBe(2);

    await scoped(target.familyId, (tx) => tx.family.deleteMany({}));
  });
});
