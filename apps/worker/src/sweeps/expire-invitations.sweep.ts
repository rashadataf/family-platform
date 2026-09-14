import type { Clock } from '@fp/kernel';
import { expireOverdueInvitations } from '@fp/persistence';

export interface SweepResult {
  expiredCount: number;
}

/**
 * FR-012. Housekeeping only: `Invitation.isExpired` and `acceptInvitation`
 * already check `expires_at` against the clock directly, so a token that
 * expired a minute ago is dead whether or not this sweep has run yet. What
 * this changes is `status`, so `GET .../invitations` and anything else that
 * reads it does not have to re-derive "expired" from `expires_at` itself.
 *
 * Idempotent and re-runnable, the same contract as
 * `repositories/identity/retention.ts`'s sweeps: nothing left to expire
 * returns `{ expiredCount: 0 }` rather than erroring.
 */
export async function runExpireInvitationsSweep(clock: Clock): Promise<SweepResult> {
  const expiredCount = await expireOverdueInvitations(clock.now());
  return { expiredCount };
}
