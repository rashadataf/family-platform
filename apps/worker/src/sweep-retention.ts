import type { Clock } from '@fp/kernel';
import { disconnectDatabase } from '@fp/persistence';
import { SystemClock } from '@fp/platform';
import { SWEEPS } from './sweeps/registry.js';

/**
 * Runs every sweep once, in registry order, in one invocation.
 *
 * `--as-of <ISO 8601>` overrides the clock so quickstart.md's Scenario 7 can
 * prove 30/90-day retention, and Scenario 6 an overdue task, without waiting
 * out real time — the sweeps themselves take `Clock` as an injected port for
 * exactly this reason.
 *
 * The recurring invocation now lives in the worker process itself:
 * `scheduler/scheduler.ts`, started by `main.ts`, runs these same registry
 * entries on their own per-sweep cadences (spec 010 FR-037). This script
 * remains the one-shot, clock-movable entry point for a quickstart scenario or
 * an operator, and reads its list from the same `SWEEPS` registry so the two
 * can never disagree about which sweeps exist.
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

  for (const sweep of SWEEPS) {
    const summary = await sweep.run(clock);
    console.log(`${sweep.name}: ${summary}`);
  }

  await disconnectDatabase();
}

await main();
