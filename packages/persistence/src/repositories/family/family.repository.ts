import type { family } from '@fp/core';
import { asFamilyId } from '@fp/kernel';
import type { TransactionClient } from '../../testing.js';

/**
 * Private to this package (`family-repositories-are-private` in
 * `.dependency-cruiser.cjs`). Constructed only by `withFamilyContext`, against
 * a transaction that already carries `app.family_id`, which is why nothing
 * here takes a family identifier.
 */
export class PrismaFamilyRepository implements family.FamilyRepository {
  constructor(private readonly tx: TransactionClient) {}

  async findCurrent(): Promise<family.FamilyRecord | null> {
    // `findFirst`, not `findUnique` by id: the row-level security policy is
    // what narrows this to one family, and letting it do that — rather than
    // passing the id again — is the difference between a scope that is
    // enforced and one that is merely repeated.
    const row = await this.tx.family.findFirst({});
    if (row === null) return null;

    return {
      id: asFamilyId(row.id),
      name: row.name,
      deletionRequestedAt: row.deletionRequestedAt,
    };
  }
}
