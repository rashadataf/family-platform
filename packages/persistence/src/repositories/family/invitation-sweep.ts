import { prisma } from '../../client.js';

/**
 * FR-012. Binds `app.is_sweep` for one transaction, the same way
 * `withFamilyContext` binds `app.family_id` — this is what makes the
 * `invitation_sweep_expiry` row-level security policy apply, and unsetting
 * it (the transaction ending) is what keeps every other connection this
 * platform ever opens from being able to see across families this way.
 *
 * Idempotent and re-runnable: nothing left to expire returns `0`, not an
 * error (the same contract `deleteUnverifiedRegistrationsBefore` and its
 * siblings in `repositories/identity/retention.ts` keep).
 */
export async function expireOverdueInvitations(now: Date): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_sweep', 'true', true)`;
    const { count } = await tx.invitation.updateMany({
      where: { status: 'pending', expiresAt: { lte: now } },
      data: { status: 'expired' },
    });
    return count;
  });
}
