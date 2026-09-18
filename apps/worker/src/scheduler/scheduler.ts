import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { Clock } from '@fp/kernel';
import type { RegisteredSweep } from '../sweeps/registry.js';

/**
 * How stale a sweep's last success may get before the scheduler says so.
 * Three cadences: one missed tick is noise, three in a row is a pattern
 * (research.md §6, FR-038).
 */
const STALL_CADENCE_MULTIPLE = 3;

/**
 * The first run of each sweep is jittered across this many milliseconds, so
 * seven sweeps do not all open transactions in the same instant on boot.
 */
const STARTUP_JITTER_MS = 5_000;

export interface SchedulerLogger {
  log(line: string): void;
  warn(line: string): void;
  error(line: string, detail?: string): void;
}

const consoleLogger: SchedulerLogger = {
  log: (line) => {
    console.log(line);
  },
  warn: (line) => {
    console.warn(line);
  },
  error: (line, detail) => {
    if (detail === undefined) console.error(line);
    else console.error(line, detail);
  },
};

export interface SchedulerOptions {
  readonly sweeps: readonly RegisteredSweep[];
  /** Cadence in seconds, keyed by sweep name. */
  readonly cadences: Readonly<Record<string, number>>;
  readonly clock: Clock;
  readonly heartbeatPath: string;
  readonly logger?: SchedulerLogger;
  /** Injected in tests; defaults to writing the real heartbeat file. */
  readonly writeHeartbeat?: (path: string, contents: string) => Promise<void>;
  /** Injected in tests so the jitter is deterministic. */
  readonly random?: () => number;
}

interface SweepState {
  readonly sweep: RegisteredSweep;
  readonly cadenceMs: number;
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
  lastSuccessAt: Date | null;
  stallReported: boolean;
  /** Resolves when an in-flight run finishes; used by `stop`. */
  running: Promise<void> | null;
}

/**
 * The worker's in-process sweep scheduler (research.md §6, FR-037, FR-038).
 *
 * A `setTimeout` chain per sweep rather than one shared interval, so each keeps
 * its own cadence and a slow sweep delays only itself. No new dependency: a
 * cron library would buy expression parsing this does not need, and would still
 * need the overlap guard, the isolation and the heartbeat written here.
 *
 * Four properties it is built to have, each asserted in `scheduler.spec.ts`:
 *
 * - **No overlap.** A run still in flight when its next tick comes due is
 *   skipped and logged, never run concurrently — two overlapping passes of the
 *   same sweep is the failure mode that turns a slow query into a pile-up.
 * - **Isolation.** A throwing sweep is logged and neither stops the other
 *   sweeps nor cancels its own next tick.
 * - **Visibility.** Every tick writes the heartbeat and a structured
 *   `worker_sweep_run` line; a sweep whose last success is older than three
 *   cadences raises `ALERT sweep_stalled` once, and clears it on the next
 *   success.
 * - **Graceful stop.** `stop` cancels pending ticks and waits for in-flight
 *   runs up to a deadline.
 */
export class SweepScheduler {
  private readonly states: SweepState[];
  private readonly logger: SchedulerLogger;
  private readonly writeHeartbeatFile: (path: string, contents: string) => Promise<void>;
  private readonly random: () => number;
  private started = false;
  private stopping = false;

  constructor(private readonly options: SchedulerOptions) {
    this.logger = options.logger ?? consoleLogger;
    this.writeHeartbeatFile =
      options.writeHeartbeat ??
      (async (path, contents) => {
        await writeFile(path, contents, 'utf8');
      });
    this.random = options.random ?? Math.random;

    this.states = options.sweeps.map((sweep) => {
      const cadenceSeconds = options.cadences[sweep.name];
      if (cadenceSeconds === undefined) {
        throw new Error(`No cadence configured for sweep ${sweep.name}.`);
      }
      return {
        sweep,
        cadenceMs: cadenceSeconds * 1_000,
        timer: null,
        inFlight: false,
        lastSuccessAt: null,
        stallReported: false,
        running: null,
      };
    });
  }

  /** Schedules every sweep's first run, shortly after now and jittered. */
  start(): void {
    if (this.started) throw new Error('The sweep scheduler is already started.');
    this.started = true;
    this.stopping = false;

    for (const state of this.states) {
      this.logger.log(
        `worker_sweep_scheduled sweep=${state.sweep.name} cadence_seconds=${String(
          state.cadenceMs / 1_000,
        )}`,
      );
      this.arm(state, Math.floor(this.random() * STARTUP_JITTER_MS));
    }
  }

  /**
   * Stops new ticks and awaits in-flight runs, up to `deadlineMs`. Returns
   * whether everything finished in time — a `false` means a sweep was still
   * running when the process gave up waiting.
   */
  async stop(deadlineMs = 25_000): Promise<boolean> {
    this.stopping = true;
    for (const state of this.states) {
      if (state.timer !== null) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    }

    const running = this.states.map((state) => state.running).filter((p) => p !== null);
    if (running.length === 0) {
      this.started = false;
      return true;
    }

    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timeout');
      }, deadlineMs);
    });

    try {
      const outcome = await Promise.race([
        Promise.all(running).then(() => 'done' as const),
        deadline,
      ]);
      if (outcome === 'timeout') {
        this.logger.warn(`worker_sweep_stop_timeout waited_ms=${String(deadlineMs)}`);
        return false;
      }
      return true;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.started = false;
    }
  }

  private arm(state: SweepState, delayMs: number): void {
    if (this.stopping) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.tick(state);
    }, delayMs);
    // Deliberately left ref'd: `main.ts` starts no server and no queue
    // consumer, so a pending tick is the ONLY thing keeping the process
    // alive. `unref()` here left nothing else to hold the event loop open —
    // Node exited right after `bootstrap()` returned, before any timer ever
    // fired (spec 010 quickstart Scenario 10). `stop()` still clears every
    // timer explicitly, so graceful shutdown is unaffected.
  }

  private async tick(state: SweepState): Promise<void> {
    if (this.stopping) return;

    // Fixed RATE, not fixed delay: the next tick is armed before this one runs,
    // so a cadence means "every 60 s" rather than "60 s after the last one
    // finished". That is what makes the in-flight guard below load-bearing —
    // a run longer than its cadence really does meet its own next tick.
    // Armed first, so a sweep that throws still gets its next tick.
    this.arm(state, state.cadenceMs);

    if (state.inFlight) {
      // Never two passes of one sweep at once.
      this.logger.warn(`worker_sweep_run sweep=${state.sweep.name} outcome=skipped_overlap`);
      await this.heartbeat();
      this.checkStalled(state);
      return;
    }

    state.inFlight = true;
    const run = this.runOnce(state);
    state.running = run;
    try {
      await run;
    } finally {
      state.inFlight = false;
      state.running = null;
      await this.heartbeat();
      this.checkStalled(state);
    }
  }

  private async runOnce(state: SweepState): Promise<void> {
    const correlationId = randomUUID();
    const startedAt = performance.now();
    try {
      const summary = await state.sweep.run(this.options.clock);
      state.lastSuccessAt = this.options.clock.now();
      state.stallReported = false;
      this.logger.log(
        `worker_sweep_run sweep=${state.sweep.name} outcome=succeeded duration_ms=${(
          performance.now() - startedAt
        ).toFixed(1)} summary="${summary}" [correlationId=${correlationId}]`,
      );
    } catch (error) {
      // Isolated: logged, and the other sweeps know nothing about it.
      this.logger.error(
        `worker_sweep_run sweep=${state.sweep.name} outcome=failed duration_ms=${(
          performance.now() - startedAt
        ).toFixed(1)} [correlationId=${correlationId}]`,
        error instanceof Error ? error.name : 'unknown error',
      );
    }
  }

  private async heartbeat(): Promise<void> {
    try {
      await this.writeHeartbeatFile(
        this.options.heartbeatPath,
        `${this.options.clock.now().toISOString()}\n`,
      );
    } catch (error) {
      // A heartbeat that cannot be written must not stop the sweeps; the
      // container's HEALTHCHECK will notice the stale file soon enough.
      this.logger.error(
        'worker_heartbeat_write_failed',
        error instanceof Error ? error.name : 'unknown error',
      );
    }
  }

  /** FR-038: says so once when a sweep stops succeeding, and clears on recovery. */
  private checkStalled(state: SweepState): void {
    const threshold = state.cadenceMs * STALL_CADENCE_MULTIPLE;
    const now = this.options.clock.now().getTime();
    const last = state.lastSuccessAt?.getTime() ?? null;

    const stalled = last === null ? false : now - last > threshold;
    if (stalled && !state.stallReported) {
      state.stallReported = true;
      this.logger.warn(
        `ALERT sweep_stalled sweep=${state.sweep.name} last_success_age_seconds=${String(
          Math.floor((now - (last ?? now)) / 1_000),
        )} threshold_seconds=${String(threshold / 1_000)}`,
      );
    }
  }
}
