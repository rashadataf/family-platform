import type { Clock } from '@fp/kernel';
import { SystemClock } from '@fp/platform';
import { disconnectDatabase } from '@fp/persistence';
import { runEraseDeletedAccountsSweep } from './sweeps/erase-deleted-accounts.sweep.js';
import { runEraseStaleSessionsSweep } from './sweeps/erase-stale-sessions.sweep.js';
import { runEraseUnverifiedSweep } from './sweeps/erase-unverified.sweep.js';
import { runExpireInvitationsSweep } from './sweeps/expire-invitations.sweep.js';
import { runGuardianCoverageSweep } from './sweeps/guardian-coverage.sweep.js';
import { runMaterialiseOccurrencesSweep } from './sweeps/materialise-occurrences.sweep.js';

/**
 * Runs every retention sweep (FR-019, FR-020, spec.md's stale-session rule,
 * spec 008's FR-012 invitation expiry, and spec 009's calendar horizon) in one
 * invocation. `--as-of
 * <ISO 8601>` overrides the clock so
 * quickstart.md's Scenario 7 can prove 30/90-day retention without waiting
 * out real time — the sweeps themselves take `Clock` as an injected port
 * for exactly this reason.
 *
 * No in-process scheduler is wired up here (T087's "scheduled invocation
 * for real operation" is intentionally scoped down — see tasks.md's note):
 * choosing where a recurring invocation of this script lives (VPS crontab,
 * a Pulumi-managed systemd timer, a future queue-based scheduler) is an
 * infrastructure decision neither this spec's research.md/plan.md nor any
 * ADR has made, and it belongs to spec 003's deployment domain, not this
 * one. This script is what such a scheduler would call.
 */
function parseAsOf(argv: readonly string[]): Date | null {
  const flagIndex = argv.indexOf('--as-of');
  if (flagIndex === -1) {
    return null;
  }
  const value = argv[flagIndex + 1];
  if (!value) {
    throw new Error('--as-of requires an ISO 8601 timestamp argument.');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`--as-of value is not a valid date: ${value}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const asOf = parseAsOf(process.argv.slice(2));
  const clock: Clock = asOf ? { now: () => asOf } : new SystemClock();

  const unverified = await runEraseUnverifiedSweep(clock);
  console.log(`erase-unverified: deleted ${String(unverified.deletedCount)}`);

  const deletedAccounts = await runEraseDeletedAccountsSweep(clock);
  console.log(`erase-deleted-accounts: deleted ${String(deletedAccounts.deletedCount)}`);

  const staleSessions = await runEraseStaleSessionsSweep(clock);
  console.log(`erase-stale-sessions: deleted ${String(staleSessions.deletedCount)}`);

  const expiredInvitations = await runExpireInvitationsSweep(clock);
  console.log(`expire-invitations: expired ${String(expiredInvitations.expiredCount)}`);

  const guardianCoverage = await runGuardianCoverageSweep();
  console.log(`guardian-coverage: uncovered ${String(guardianCoverage.uncoveredChildren.length)}`);

  // Spec 009 FR-024: the calendar horizon advances here, on the same
  // invocation and the same injectable clock, so `--as-of` moves it too.
  const materialised = await runMaterialiseOccurrencesSweep(clock);
  console.log(
    `materialise-occurrences: extended ${String(materialised.extended)}, inserted ${String(materialised.occurrencesInserted)}, pruned ${String(materialised.occurrencesPruned)}, failed ${String(materialised.failed.length)}, lagging families ${String(materialised.lagging.length)}`,
  );

  await disconnectDatabase();
}

await main();
