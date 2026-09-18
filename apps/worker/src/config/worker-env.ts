import { z } from 'zod';
import { cadenceVariableFor, SWEEPS } from '../sweeps/registry.js';

/**
 * Where the scheduler records that it is alive. The container's `HEALTHCHECK`
 * compares this file's mtime with its own clock, so a worker whose ticks have
 * stopped goes unhealthy in `docker ps` rather than sitting there looking fine
 * (T085).
 */
export const DEFAULT_HEARTBEAT_PATH = '/tmp/fp-worker-heartbeat';

/**
 * A cadence, in whole positive seconds. Principle II: parsed once at boot, and
 * a bad value fails the process rather than silently becoming a default — a
 * sweep that quietly ran every 0 seconds, or never, is the failure this
 * prevents.
 */
const cadenceSchema = z.coerce
  .number({ invalid_type_error: 'must be a whole number of seconds' })
  .int('must be a whole number of seconds')
  .positive('must be greater than zero');

const heartbeatPathSchema = z.string().min(1, 'must not be empty');

export interface WorkerEnv {
  /** Cadence in seconds, keyed by sweep name. */
  readonly cadences: Readonly<Record<string, number>>;
  readonly heartbeatPath: string;
}

/** Every variable this process reads, for documentation and for `pnpm verify:env`. */
export const WORKER_ENV_VARIABLES: readonly string[] = [
  ...SWEEPS.map((sweep) => cadenceVariableFor(sweep.name)),
  'WORKER_HEARTBEAT_PATH',
];

/**
 * Parses the worker's environment, naming the variable that is wrong.
 *
 * Throws rather than returning a `Result`: this runs once, at boot, before
 * anything is scheduled, and there is no caller who could sensibly continue
 * without it. Every bad variable is reported, not just the first, so a
 * misconfigured deploy is fixed in one pass.
 */
export function parseWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const issues: string[] = [];
  const cadences: Record<string, number> = {};

  for (const sweep of SWEEPS) {
    const variable = cadenceVariableFor(sweep.name);
    const raw = source[variable];

    // Absent or blank means "use the default"; a PRESENT value must be valid.
    if (raw === undefined || raw.trim() === '') {
      cadences[sweep.name] = sweep.defaultCadenceSeconds;
      continue;
    }

    const parsed = cadenceSchema.safeParse(raw);
    if (!parsed.success) {
      issues.push(`${variable} ${parsed.error.issues[0]?.message ?? 'is invalid'}`);
      continue;
    }
    cadences[sweep.name] = parsed.data;
  }

  const rawHeartbeat = source.WORKER_HEARTBEAT_PATH;
  const heartbeat =
    rawHeartbeat === undefined || rawHeartbeat.trim() === ''
      ? { success: true as const, data: DEFAULT_HEARTBEAT_PATH }
      : heartbeatPathSchema.safeParse(rawHeartbeat);

  if (!heartbeat.success) {
    issues.push(`WORKER_HEARTBEAT_PATH ${heartbeat.error.issues[0]?.message ?? 'is invalid'}`);
  }

  if (issues.length > 0) {
    throw new Error(`Invalid worker environment: ${issues.join('; ')}`);
  }

  return { cadences, heartbeatPath: heartbeat.success ? heartbeat.data : DEFAULT_HEARTBEAT_PATH };
}
