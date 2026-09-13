import type { family } from '@fp/core';
import { prisma } from '../../client.js';
import { toInvitationAggregate } from './invitation.repository.js';

/**
 * The one implementation of `InvitationTokenLookupPort` (data-model.md's
 * `Invitation` section). Binds `app.invitation_token_hash` — never
 * `app.family_id` — as the first statement of its own short transaction, so
 * the `invitation_by_token` row-level security policy is what actually
 * narrows this to the one invitation the caller holds the token for.
 *
 * `findFirst({})` with no `where` on `tokenHash`, the same convention every
 * other RLS-narrowed read in this package follows: the policy does the
 * narrowing, so the query does not repeat it as an application-level filter
 * that could drift from what the database actually enforces.
 */
export class PrismaInvitationTokenLookup implements family.InvitationTokenLookupPort {
  async findByTokenHash(tokenHash: string): Promise<family.Invitation | null> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.invitation_token_hash', ${tokenHash}, true)`;
      const row = await tx.invitation.findFirst({});
      return row === null ? null : toInvitationAggregate(row);
    });
  }
}
