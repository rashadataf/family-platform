import { randomUUID } from 'node:crypto';
import type { TransactionClient } from './transaction.js';

/**
 * Fixtures for the tenant root.
 *
 * Every one of these writes through a transaction the caller has already
 * scoped with `app.family_id` — there is no unscoped write helper here, on
 * purpose. A factory that could create a row outside the scope would be a
 * second door around ADR-017 that exists only in tests, and tests are exactly
 * where the isolation is supposed to be proved.
 */

export interface SeededFamily {
  familyId: string;
  ownerMemberId: string;
  ownerUserId: string;
}

/** Sets the family scope for the rest of this transaction. */
export async function scopeTo(tx: TransactionClient, familyId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
}

/**
 * A family with exactly one owner — the minimum a family can legally be, since
 * the `family_one_owner` partial unique index and the
 * `family_member_owner_is_linked_adult` check both apply from the first row.
 */
export async function seedFamily(
  tx: TransactionClient,
  overrides: { name?: string; familyId?: string; ownerUserId?: string } = {},
): Promise<SeededFamily> {
  const familyId = overrides.familyId ?? randomUUID();
  const ownerUserId = overrides.ownerUserId ?? randomUUID();
  const ownerMemberId = randomUUID();

  await scopeTo(tx, familyId);
  await tx.family.create({ data: { id: familyId, name: overrides.name ?? 'Lovelace' } });
  await tx.familyMember.create({
    data: {
      id: ownerMemberId,
      familyId,
      kind: 'adult',
      role: 'owner',
      userId: ownerUserId,
      displayName: 'Ada',
    },
  });

  return { familyId, ownerMemberId, ownerUserId };
}

/** An additional linked member. `role` may not be `owner`: a family has exactly one. */
export async function seedMember(
  tx: TransactionClient,
  params: {
    familyId: string;
    role: 'adult' | 'extended' | 'viewer';
    userId?: string | null;
    displayName?: string;
  },
): Promise<{ memberId: string; userId: string | null }> {
  const memberId = randomUUID();
  const userId = params.userId === null ? null : (params.userId ?? randomUUID());

  await tx.familyMember.create({
    data: {
      id: memberId,
      familyId: params.familyId,
      kind: 'adult',
      role: params.role,
      userId,
      displayName: params.displayName ?? 'Grace',
    },
  });

  return { memberId, userId };
}

/**
 * A child, and optionally the guardianship that makes them reachable.
 *
 * `guardianMemberId` is not optional by accident: FR-008 says a child must
 * never have zero guardians, so a factory that made a guardianless child the
 * easy default would let tests set up a state the domain forbids and then
 * assert against it.
 */
export async function seedChild(
  tx: TransactionClient,
  params: { familyId: string; guardianMemberId: string; displayName?: string; dateOfBirth?: Date },
): Promise<{ childMemberId: string; guardianshipId: string }> {
  const childMemberId = randomUUID();
  const guardianshipId = randomUUID();

  await tx.familyMember.create({
    data: {
      id: childMemberId,
      familyId: params.familyId,
      // The two constraints that make a child a child: no user, and the least
      // privileged role. Both are also CHECK constraints in the migration.
      kind: 'child',
      role: 'viewer',
      userId: null,
      displayName: params.displayName ?? 'Bo',
      dateOfBirth: params.dateOfBirth ?? new Date('2019-04-02'),
    },
  });
  await tx.guardianship.create({
    data: {
      id: guardianshipId,
      familyId: params.familyId,
      guardianMemberId: params.guardianMemberId,
      childMemberId,
    },
  });

  return { childMemberId, guardianshipId };
}
