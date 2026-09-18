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

const nonEmptyStringSchema = z.string().min(1, 'must not be empty');

export interface WorkerEnv {
  /** Cadence in seconds, keyed by sweep name. */
  readonly cadences: Readonly<Record<string, number>>;
  readonly heartbeatPath: string;
  /** ElasticMQ's URL at Stage 0, a real SQS regional endpoint at Stage 1 (ADR-018). */
  readonly relayQueueEndpoint: string;
  /** Passed to the AWS SDK client; a fixed placeholder at Stage 0 (ElasticMQ ignores it). */
  readonly relayQueueRegion: string;
}

/** Every variable this process reads, for documentation and for `pnpm verify:env`. */
export const WORKER_ENV_VARIABLES: readonly string[] = [
  ...SWEEPS.map((sweep) => cadenceVariableFor(sweep.name)),
  'WORKER_HEARTBEAT_PATH',
  'RELAY_QUEUE_ENDPOINT',
  'RELAY_QUEUE_REGION',
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
      : nonEmptyStringSchema.safeParse(rawHeartbeat);

  if (!heartbeat.success) {
    issues.push(`WORKER_HEARTBEAT_PATH ${heartbeat.error.issues[0]?.message ?? 'is invalid'}`);
  }

  // Required, unlike the cadences and the heartbeat path above: no default
  // exists for where the relay's queue actually lives (contracts/relay-
  // interfaces.md §6). A missing or malformed value fails boot, exactly as a
  // bad DATABASE_URL or MAIL_HOST already does elsewhere in this platform.
  const relayQueueEndpoint = nonEmptyStringSchema.safeParse(source.RELAY_QUEUE_ENDPOINT);
  if (!relayQueueEndpoint.success) {
    issues.push(
      `RELAY_QUEUE_ENDPOINT ${relayQueueEndpoint.error.issues[0]?.message ?? 'is invalid'}`,
    );
  }

  const relayQueueRegion = nonEmptyStringSchema.safeParse(source.RELAY_QUEUE_REGION);
  if (!relayQueueRegion.success) {
    issues.push(`RELAY_QUEUE_REGION ${relayQueueRegion.error.issues[0]?.message ?? 'is invalid'}`);
  }

  if (issues.length > 0) {
    throw new Error(`Invalid worker environment: ${issues.join('; ')}`);
  }

  return {
    cadences,
    heartbeatPath: heartbeat.success ? heartbeat.data : DEFAULT_HEARTBEAT_PATH,
    relayQueueEndpoint: relayQueueEndpoint.success ? relayQueueEndpoint.data : '',
    relayQueueRegion: relayQueueRegion.success ? relayQueueRegion.data : '',
  };
}
