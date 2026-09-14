import type { family } from '@fp/core';
import { asFamilyId, type UserId } from '@fp/kernel';
import { prisma } from '../../client.js';

/**
 * The one cross-family read in the system (FR-024).
 *
 * It is NOT unscoped. It runs inside a transaction bound to `app.user_id`, and
 * the `family_member_self` and `family_of_member` policies added in
 * `20260913170000_self_and_token_policies` are what make its rows visible —
 * a caller sees their own member rows in any family, and nothing else. The
 * database enforces the bound; this function merely names it.
 *
 * `app.user_id` comes from the authenticated session and never from a path
 * parameter, a body, or anything else the caller supplies. That is the whole
 * safety argument, so it is worth stating where the value is set rather than
 * only in the migration.
 */
export class PrismaFamilyDirectory implements family.FamilyDirectoryPort {
  async listMembershipsFor(userId: UserId): Promise<readonly family.FamilyMembershipSummary[]> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}::text, true)`;

      const rows = await tx.familyMember.findMany({
        where: { removedAt: null },
        select: {
          role: true,
          family: { select: { id: true, name: true, deletionRequestedAt: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      return (
        rows
          // A family pending deletion revokes standing immediately (FR-023), so
          // it must not appear in the list either — otherwise the list and
          // `FamilyContextPort.resolve` would disagree about whether the caller
          // is still a member.
          .filter((row) => row.family.deletionRequestedAt === null)
          .map((row) => ({
            familyId: asFamilyId(row.family.id),
            name: row.family.name,
            role: row.role,
          }))
      );
    });
  }
}
