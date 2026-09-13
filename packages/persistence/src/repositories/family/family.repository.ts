import { family } from '@fp/core';
import { asFamilyId } from '@fp/kernel';
import { Prisma } from '../../generated/prisma/index.js';
import type { TransactionClient } from '../../testing.js';

/**
 * The `composition` column is `Json?`: untrusted the moment it comes back out,
 * whatever this same repository wrote into it. Narrowed by shape rather than
 * cast, per Principle I.
 */
function parseComposition(value: Prisma.JsonValue | null): family.HouseholdComposition | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.adults !== 'number' || typeof record.children !== 'number') return null;
  return { adults: record.adults, children: record.children };
}

/**
 * Private to this package (`family-repositories-are-private` in
 * `.dependency-cruiser.cjs`). Constructed only by `withFamilyContext`, against
 * a transaction that already carries `app.family_id`, which is why nothing
 * here takes a family identifier.
 */
export class PrismaFamilyRepository implements family.FamilyRepository {
  constructor(private readonly tx: TransactionClient) {}

  async save(aggregate: family.Family): Promise<void> {
    const profile = aggregate.profile;
    const data = {
      name: aggregate.name,
      postcode: profile.postcode,
      localAuthorityCode: profile.localAuthorityCode,
      // Spread into a plain object rather than cast: Prisma's `InputJsonValue`
      // and a domain interface do not overlap structurally, and `as` across
      // that gap is exactly the widening assertion Principle I bans. On the
      // way back out this column is untrusted again and is parsed, not cast.
      composition:
        profile.composition === null
          ? Prisma.DbNull
          : { adults: profile.composition.adults, children: profile.composition.children },
      deletionRequestedAt: aggregate.deletionRequestedAt,
    };

    await this.tx.family.upsert({
      where: { id: aggregate.id },
      create: { id: aggregate.id, ...data },
      update: data,
    });
  }

  async findCurrent(): Promise<family.Family | null> {
    // `findFirst`, not `findUnique` by id: the row-level security policy is
    // what narrows this to one family, and letting it do that — rather than
    // passing the id again — is the difference between a scope that is
    // enforced and one that is merely repeated.
    const row = await this.tx.family.findFirst({});
    if (row === null) return null;

    return family.Family.reconstitute({
      id: asFamilyId(row.id),
      name: row.name,
      profile: family.HouseholdProfile.from({
        postcode: row.postcode,
        localAuthorityCode: row.localAuthorityCode,
        composition: parseComposition(row.composition),
      }),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletionRequestedAt: row.deletionRequestedAt,
    });
  }
}
