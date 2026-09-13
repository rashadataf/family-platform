import type { family } from '@fp/core';
import { asFamilyMemberId, type UserId } from '@fp/kernel';
import type { TransactionClient } from '../../testing.js';

export class PrismaFamilyMemberRepository implements family.FamilyMemberRepository {
  constructor(private readonly tx: TransactionClient) {}

  async findStandingByUserId(userId: UserId): Promise<family.MemberStanding | null> {
    const row = await this.tx.familyMember.findFirst({
      // No `familyId` in this where clause, deliberately: the transaction's
      // `app.family_id` supplies it through the policy. Repeating it here
      // would make the scope look like an application concern that a future
      // edit could drop.
      where: { userId, removedAt: null },
      select: { id: true, role: true },
    });
    if (row === null) return null;

    return { memberId: asFamilyMemberId(row.id), role: row.role };
  }
}
