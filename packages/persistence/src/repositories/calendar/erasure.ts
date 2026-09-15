import type { FamilyId, FamilyMemberId } from '@fp/kernel';
import { prisma } from '../../client.js';

/**
 * Constitution Principle XI for the Calendar context (spec 009 T085).
 *
 * `eraseCalendarForFamily` is one statement: every `event_occurrence` and
 * `event_participant` row references its event through the composite
 * `(event_id, family_id)` foreign key with `ON DELETE CASCADE`, so deleting the
 * family's events removes the rest. Scoped by `app.family_id`, so it cannot
 * reach another family's rows whatever it is asked. Attachment references are
 * columns on the event and go with it.
 */
export async function eraseCalendarForFamily(familyId: FamilyId): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
    await tx.calendarEvent.deleteMany({});
  });
}

/**
 * `eraseCalendarForMember` removes that member's participations and nothing
 * else. Events they authored stay as the family's own record; their
 * `created_by_member_id` already points at the tombstone Family's own
 * `eraseForMember` leaves, so it never dangles. Titles are free text the
 * household wrote and are NOT scrubbed — the stated limitation in data-model.md.
 *
 * Like Family's own erasure, the caller has a member id and no family, so
 * discovery runs behind `app.is_erasure` (`event_participant_erasure_select`)
 * and each delete runs under the ordinary family scope once the family is
 * known.
 */
export async function eraseCalendarForMember(memberId: FamilyMemberId): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_erasure', 'true', true)`;
    const families = await tx.eventParticipant.findMany({
      where: { memberId },
      select: { familyId: true },
      distinct: ['familyId'],
    });

    for (const { familyId } of families) {
      await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
      await tx.eventParticipant.deleteMany({ where: { memberId, familyId } });
    }
  });
}
