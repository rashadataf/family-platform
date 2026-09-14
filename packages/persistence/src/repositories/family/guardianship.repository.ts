import { family } from '@fp/core';
import { asFamilyId, asFamilyMemberId, asGuardianshipId, type FamilyMemberId } from '@fp/kernel';
import type { TransactionClient } from '../../testing.js';
import type { Guardianship as GuardianshipRow } from '../../generated/prisma/index.js';

function toAggregate(row: GuardianshipRow): family.Guardianship {
  return family.Guardianship.reconstitute({
    id: asGuardianshipId(row.id),
    familyId: asFamilyId(row.familyId),
    guardianMemberId: asFamilyMemberId(row.guardianMemberId),
    childMemberId: asFamilyMemberId(row.childMemberId),
    establishedAt: row.establishedAt,
    endedAt: row.endedAt,
  });
}

export class PrismaGuardianshipRepository implements family.GuardianshipRepository {
  constructor(private readonly tx: TransactionClient) {}

  async save(guardianship: family.Guardianship): Promise<void> {
    const data = { endedAt: guardianship.endedAt };

    await this.tx.guardianship.upsert({
      where: { id: guardianship.id },
      create: {
        id: guardianship.id,
        familyId: guardianship.familyId,
        guardianMemberId: guardianship.guardianMemberId,
        childMemberId: guardianship.childMemberId,
        ...data,
      },
      update: data,
    });
  }

  async countActiveForChild(childMemberId: FamilyMemberId): Promise<number> {
    return this.tx.guardianship.count({
      where: { childMemberId, endedAt: null },
    });
  }

  async findActive(
    guardianMemberId: FamilyMemberId,
    childMemberId: FamilyMemberId,
  ): Promise<family.Guardianship | null> {
    const row = await this.tx.guardianship.findFirst({
      where: { guardianMemberId, childMemberId, endedAt: null },
    });
    return row === null ? null : toAggregate(row);
  }

  async listActiveChildIdsGuardedBy(
    guardianMemberId: FamilyMemberId,
  ): Promise<readonly FamilyMemberId[]> {
    const rows = await this.tx.guardianship.findMany({
      where: { guardianMemberId, endedAt: null },
      select: { childMemberId: true },
    });
    return rows.map((row) => asFamilyMemberId(row.childMemberId));
  }
}
