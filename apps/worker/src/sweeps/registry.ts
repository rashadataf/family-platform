import type { Clock } from '@fp/kernel';
import { runEraseDeletedAccountsSweep } from './erase-deleted-accounts.sweep.js';
import { runEraseStaleSessionsSweep } from './erase-stale-sessions.sweep.js';
import { runEraseUnverifiedSweep } from './erase-unverified.sweep.js';
import { runExpireInvitationsSweep } from './expire-invitations.sweep.js';
import { runGuardianCoverageSweep } from './guardian-coverage.sweep.js';
import { runMaterialiseOccurrencesSweep } from './materialise-occurrences.sweep.js';
import { runReportOverdueTasksSweep } from './report-overdue-tasks.sweep.js';

/**
 * A sweep, as both the scheduler and the one-shot CLI see it.
 *
 * `run` returns a one-line summary built from the sweep's own result type, so
 * neither caller has to know what any particular sweep counts. The line carries
 * identifiers and numbers only — never a title, a name or an email (Principle
 * VI, SC-011).
 */
export interface RegisteredSweep {
  /** Matches the `SWEEP_<NAME>_INTERVAL_SECONDS` variable, in kebab-case. */
  readonly name: string;
  readonly defaultCadenceSeconds: number;
  run(clock: Clock): Promise<string>;
}

const HOUR = 3_600;
const DAY = 86_400;

/**
 * Every sweep the platform runs, in the order a one-shot invocation runs them
 * (spec 010 T080, research.md §6).
 *
 * One list, so that adding a sweep cannot mean adding it to the scheduler and
 * forgetting the CLI, or giving it a cadence in one place and not the other.
 * The cadences are the defaults research.md §6 fixes; `worker-env.ts` allows
 * each to be overridden, and validates it at boot.
 */
export const SWEEPS: readonly RegisteredSweep[] = [
  {
    name: 'erase-unverified',
    defaultCadenceSeconds: HOUR,
    async run(clock) {
      const result = await runEraseUnverifiedSweep(clock);
      return `deleted ${String(result.deletedCount)}`;
    },
  },
  {
    name: 'erase-deleted-accounts',
    defaultCadenceSeconds: HOUR,
    async run(clock) {
      const result = await runEraseDeletedAccountsSweep(clock);
      return `deleted ${String(result.deletedCount)}`;
    },
  },
  {
    name: 'erase-stale-sessions',
    defaultCadenceSeconds: HOUR,
    async run(clock) {
      const result = await runEraseStaleSessionsSweep(clock);
      return `deleted ${String(result.deletedCount)}`;
    },
  },
  {
    name: 'expire-invitations',
    defaultCadenceSeconds: HOUR,
    async run(clock) {
      const result = await runExpireInvitationsSweep(clock);
      return `expired ${String(result.expiredCount)}`;
    },
  },
  {
    name: 'guardian-coverage',
    defaultCadenceSeconds: DAY,
    async run() {
      const result = await runGuardianCoverageSweep();
      return `uncovered ${String(result.uncoveredChildren.length)}`;
    },
  },
  {
    name: 'materialise-occurrences',
    defaultCadenceSeconds: HOUR,
    async run(clock) {
      const result = await runMaterialiseOccurrencesSweep(clock);
      return [
        `extended ${String(result.extended)}`,
        `inserted ${String(result.occurrencesInserted)}`,
        `pruned ${String(result.occurrencesPruned)}`,
        `failed ${String(result.failed.length)}`,
        `lagging families ${String(result.lagging.length)}`,
      ].join(', ');
    },
  },
  {
    // SC-012 promises detection within five minutes, so this one runs far more
    // often than the rest.
    name: 'report-overdue-tasks',
    defaultCadenceSeconds: 60,
    async run(clock) {
      const result = await runReportOverdueTasksSweep(clock);
      return [
        `reported ${String(result.reported)}`,
        `skipped ${String(result.skipped)}`,
        `failed ${String(result.failed.length)}`,
        `lag ${String(result.lagSeconds)}s`,
      ].join(', ');
    },
  },
];

/** The environment-variable name a sweep's cadence is read from. */
export function cadenceVariableFor(name: string): string {
  return `SWEEP_${name.replaceAll('-', '_').toUpperCase()}_INTERVAL_SECONDS`;
}
