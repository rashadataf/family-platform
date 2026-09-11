import type { Clock } from '@fp/kernel';
import { deleteStaleSessionsBefore } from '@fp/persistence';

/** spec.md Personal Data §5: 90 days after a session stops being valid, independent of account status. */
const RETENTION_DAYS = 90;

export interface SweepResult {
  deletedCount: number;
}

/**
 * Idempotent and re-runnable, like the other sweeps. A session that is
 * merely past its absolute expiry but never revoked is also eligible —
 * the rule is "90 days after it stopped being valid," not "90 days after
 * an explicit revocation."
 */
export async function runEraseStaleSessionsSweep(clock: Clock): Promise<SweepResult> {
  const cutoff = new Date(clock.now().getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deletedCount = await deleteStaleSessionsBefore(cutoff);
  return { deletedCount };
}
