import type { Clock } from '@fp/kernel';
import { deleteUnverifiedRegistrationsBefore } from '@fp/persistence';

/** FR-020: 30 days, unconditional — no deletion request required for an unverified registration. */
const RETENTION_DAYS = 30;

export interface SweepResult {
  deletedCount: number;
}

/**
 * Idempotent and re-runnable: a second run against the same clock finds
 * nothing left to delete and returns `{ deletedCount: 0 }` rather than
 * erroring (quickstart.md Scenario 7).
 */
export async function runEraseUnverifiedSweep(clock: Clock): Promise<SweepResult> {
  const cutoff = new Date(clock.now().getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deletedCount = await deleteUnverifiedRegistrationsBefore(cutoff);
  return { deletedCount };
}
