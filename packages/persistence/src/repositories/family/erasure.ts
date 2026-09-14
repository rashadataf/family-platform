import type { FamilyId, FamilyMemberId } from '@fp/kernel';
import { prisma } from '../../client.js';

/**
 * Constitution Principle XI, ARCHITECTURE.md §5.12. The saga that calls
 * these lives in Audit and Compliance and does not exist yet — what this
 * context owes is the two operations themselves, tested directly.
 *
 * `eraseForFamily` removes the family; every family-scoped row cascades with
 * it (`onDelete: Cascade` on `family_member`, `invitation` and
 * `guardianship`'s own `family` relation, data-model.md), so deleting the
 * one row this transaction is scoped to is the whole operation.
 */
export async function eraseForFamily(familyId: FamilyId): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
    await tx.family.deleteMany({});
  });
}

/**
 * `eraseForMember` takes only a member id — the caller does not necessarily
 * know which family it belongs to, and unlike every other family-scoped
 * write in this package, there is no `:familyId` from a request path to
 * scope a transaction to before the lookup. The same shape of problem the
 * invitation-expiry sweep already has, solved the same way: a narrow,
 * `app.is_erasure`-gated policy (`family_member_erasure_select`) grants
 * enough visibility to find the row and read its `family_id` — nothing
 * else — and every write that follows goes through the ordinary
 * `app.family_id` scope once that value is known.
 *
 * A tombstone, the same shape `FamilyMember.remove()` leaves: personal
 * fields nulled, the row and its id survive. Every guardianship referencing
 * this member — as guardian or as child — ends; FR-008's "never leave a
 * child with zero guardians" is the erasure saga's OWN problem to solve
 * before calling this (assigning a replacement first), not something this
 * operation can refuse to do on the child's behalf once erasure is what was
 * asked for.
 */
export async function eraseForMember(memberId: FamilyMemberId): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_erasure', 'true', true)`;
    const member = await tx.familyMember.findFirst({ where: { id: memberId } });
    if (member === null) return;

    await tx.$executeRaw`SELECT set_config('app.family_id', ${member.familyId}::text, true)`;

    await tx.familyMember.update({
      where: { id: memberId },
      data: {
        displayName: null,
        dateOfBirth: null,
        userId: null,
        removedAt: member.removedAt ?? new Date(),
      },
    });

    await tx.guardianship.updateMany({
      where: {
        OR: [{ guardianMemberId: memberId }, { childMemberId: memberId }],
        endedAt: null,
      },
      data: { endedAt: new Date() },
    });
  });
}
