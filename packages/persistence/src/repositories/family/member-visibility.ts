import type { family } from '@fp/core';
import { asFamilyMemberId, type FamilyId, type FamilyMemberId } from '@fp/kernel';
import { prisma } from '../../client.js';
import { PrismaGuardianshipRepository } from './guardianship.repository.js';

/**
 * The adapter behind `MemberVisibilityPort` (spec 009 research.md §1).
 *
 * One family-scoped transaction — the same `set_config('app.family_id', …,
 * true)` binding `withFamilyContext` makes — composing the roster with the
 * existing `listActiveChildIdsGuardedBy` query spec 008 built. No new query
 * pattern, no new index. A transaction of its own rather than
 * `withFamilyContext` itself, because the answer needs removed members'
 * tombstones too (an old event may still name one), which the unit of work's
 * `listActive` rightly never returns.
 *
 * Nothing is cached, here or anywhere behind it: FR-016 evaluates guardianship
 * at the time of the read, so a guardianship ended a moment ago must already
 * be absent from the next answer.
 */
export class PrismaMemberVisibility implements family.MemberVisibilityPort {
  async resolveVisibleMemberIds(
    viewerMemberId: FamilyMemberId,
    familyId: FamilyId,
  ): Promise<family.MemberVisibility> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;

      const [members, guardedChildIds] = await Promise.all([
        tx.familyMember.findMany({ select: { id: true, kind: true } }),
        new PrismaGuardianshipRepository(tx).listActiveChildIdsGuardedBy(viewerMemberId),
      ]);
      const guarded = new Set<string>(guardedChildIds);

      // Adults are visible to every member; a child only to their guardians.
      // Returned as the visible set, never as a restricted one, so an empty
      // answer hides everything rather than showing everything.
      const visible = members
        .filter((member) => member.kind === 'adult' || guarded.has(member.id))
        .map((member) => asFamilyMemberId(member.id));

      return {
        visibleMemberIds: visible,
        guardedChildIds: members
          .filter((member) => member.kind === 'child' && guarded.has(member.id))
          .map((member) => asFamilyMemberId(member.id)),
      };
    });
  }
}
