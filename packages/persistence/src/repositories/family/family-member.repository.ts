import { family } from '@fp/core';
import {
  asFamilyId,
  asFamilyMemberId,
  asUserId,
  type FamilyMemberId,
  type UserId,
} from '@fp/kernel';
import type { TransactionClient } from '../../testing.js';
import type { FamilyMember as FamilyMemberRow } from '../../generated/prisma/index.js';

function toAggregate(row: FamilyMemberRow): family.FamilyMember {
  return family.FamilyMember.reconstitute({
    id: asFamilyMemberId(row.id),
    familyId: asFamilyId(row.familyId),
    kind: row.kind,
    role: row.role,
    userId: row.userId === null ? null : asUserId(row.userId),
    displayName: row.displayName,
    dateOfBirth: row.dateOfBirth,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    removedAt: row.removedAt,
  });
}

export class PrismaFamilyMemberRepository implements family.FamilyMemberRepository {
  constructor(private readonly tx: TransactionClient) {}

  async save(member: family.FamilyMember): Promise<void> {
    const data = {
      kind: member.kind,
      role: member.role,
      userId: member.userId,
      displayName: member.displayName,
      dateOfBirth: member.dateOfBirth,
      removedAt: member.removedAt,
    };

    await this.tx.familyMember.upsert({
      where: { id: member.id },
      create: { id: member.id, familyId: member.familyId, ...data },
      update: data,
    });
  }

  async listActive(): Promise<readonly family.FamilyMember[]> {
    // No `familyId` filter: the transaction's `app.family_id` supplies it
    // through the policy (ADR-017).
    const rows = await this.tx.familyMember.findMany({
      where: { removedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toAggregate);
  }

  async findById(memberId: FamilyMemberId): Promise<family.FamilyMember | null> {
    // `findFirst` with an id predicate rather than `findUnique`: a unique
    // lookup by primary key would bypass nothing (the policy still applies),
    // but writing it this way keeps every read in this repository shaped the
    // same, so the scope is never the thing that looks optional.
    const row = await this.tx.familyMember.findFirst({ where: { id: memberId } });
    return row === null ? null : toAggregate(row);
  }

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
