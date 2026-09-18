import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisteredSweep } from '../sweeps/registry.js';
import { SweepScheduler, type SchedulerLogger } from './scheduler.js';

/** A clock the test moves by hand, so "3× the cadence ago" is exact. */
function movableClock(start: string) {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}

function recordingLogger() {
  const lines: { level: 'log' | 'warn' | 'error'; line: string }[] = [];
  const logger: SchedulerLogger = {
    log: (line) => lines.push({ level: 'log', line }),
    warn: (line) => lines.push({ level: 'warn', line }),
    error: (line) => lines.push({ level: 'error', line }),
  };
  return {
    logger,
    lines,
    matching: (needle: string) => lines.filter((entry) => entry.line.includes(needle)),
  };
}

/** A sweep whose behaviour the test controls per call. */
function controllableSweep(name: string, cadenceSeconds: number) {
  const calls: number[] = [];
  let behaviour: (call: number) => Promise<string> = () => Promise.resolve('ok');
  const sweep: RegisteredSweep = {
    name,
    defaultCadenceSeconds: cadenceSeconds,
    run: async () => {
      const call = calls.length;
      calls.push(call);
      return behaviour(call);
    },
  };
  return {
    sweep,
    calls,
    set(next: (call: number) => Promise<string>) {
      behaviour = next;
    },
  };
}

describe('SweepScheduler (Phase 8, FR-037, FR-038)', () => {
  const CADENCE_SECONDS = 60;
  const CADENCE_MS = CADENCE_SECONDS * 1_000;

  let clock: ReturnType<typeof movableClock>;
  let heartbeats: { path: string; contents: string }[];
  let writeHeartbeat: (path: string, contents: string) => Promise<void>;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = movableClock('2026-09-16T10:00:00Z');
    heartbeats = [];
    writeHeartbeat = (path, contents) => {
      heartbeats.push({ path, contents });
      return Promise.resolve();
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function build(sweeps: readonly RegisteredSweep[], logger?: SchedulerLogger) {
    const cadences = Object.fromEntries(sweeps.map((s) => [s.name, CADENCE_SECONDS]));
    return new SweepScheduler({
      sweeps,
      cadences,
      clock,
      heartbeatPath: '/tmp/heartbeat',
      logger,
      writeHeartbeat,
      // No jitter, so the first run is deterministic.
      random: () => 0,
    });
  }

  it('runs a registered sweep shortly after start, then once per cadence', async () => {
    const bins = controllableSweep('report-overdue-tasks', CADENCE_SECONDS);
    const scheduler = build([bins.sweep]);
    scheduler.start();

    expect(bins.calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(bins.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(CADENCE_MS);
    expect(bins.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(CADENCE_MS * 3);
    expect(bins.calls).toHaveLength(5);

    await scheduler.stop(0);
  });

  it('refuses to start twice', () => {
    const scheduler = build([controllableSweep('a', CADENCE_SECONDS).sweep]);
    scheduler.start();
    expect(() => {
      scheduler.start();
    }).toThrow(/already started/);
  });

  it('throws at construction when a sweep has no configured cadence', () => {
    expect(
      () =>
        new SweepScheduler({
          sweeps: [controllableSweep('unconfigured', 60).sweep],
          cadences: {},
          clock,
          heartbeatPath: '/tmp/heartbeat',
          writeHeartbeat,
        }),
    ).toThrow(/No cadence configured for sweep unconfigured/);
  });

  describe('overlap', () => {
    it('skips the next tick and logs skipped_overlap rather than running two at once', async () => {
      const slow = controllableSweep('slow', CADENCE_SECONDS);
      let concurrent = 0;
      let maxConcurrent = 0;
      slow.set(async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        // Two and a half cadences long.
        await new Promise((resolve) => setTimeout(resolve, CADENCE_MS * 2.5));
        concurrent -= 1;
        return 'ok';
      });

      const recorder = recordingLogger();
      const scheduler = build([slow.sweep], recorder.logger);
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1);
      expect(slow.calls).toHaveLength(1);

      // Two ticks come due while the first run is still going.
      await vi.advanceTimersByTimeAsync(CADENCE_MS * 2);
      expect(slow.calls).toHaveLength(1);
      expect(recorder.matching('outcome=skipped_overlap')).toHaveLength(2);
      expect(maxConcurrent).toBe(1);

      // A run is still in flight, so stop's own deadline is a fake timer too
      // and has to be advanced rather than merely awaited.
      const stopping = scheduler.stop(0);
      await vi.advanceTimersByTimeAsync(1);
      await stopping;
    });
  });

  describe('isolation', () => {
    it('logs a throwing sweep as failed and still gives it its next tick', async () => {
      const flaky = controllableSweep('flaky', CADENCE_SECONDS);
      flaky.set((call) => {
        if (call === 0) return Promise.reject(new Error('boom'));
        return Promise.resolve('ok');
      });

      const recorder = recordingLogger();
      const scheduler = build([flaky.sweep], recorder.logger);
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1);
      expect(recorder.matching('outcome=failed')).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(CADENCE_MS);
      expect(flaky.calls).toHaveLength(2);
      expect(recorder.matching('outcome=succeeded')).toHaveLength(1);

      await scheduler.stop(0);
    });

    it('does not let one sweep’s failure stop another', async () => {
      const broken = controllableSweep('broken', CADENCE_SECONDS);
      broken.set(() => Promise.reject(new Error('boom')));
      const healthy = controllableSweep('healthy', CADENCE_SECONDS);

      const scheduler = build([broken.sweep, healthy.sweep]);
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(CADENCE_MS * 2);

      expect(broken.calls.length).toBeGreaterThanOrEqual(3);
      expect(healthy.calls.length).toBeGreaterThanOrEqual(3);

      await scheduler.stop(0);
    });
  });

  describe('the heartbeat', () => {
    it('is rewritten after every tick, with the current instant', async () => {
      const sweep = controllableSweep('beats', CADENCE_SECONDS);
      const scheduler = build([sweep.sweep]);
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1);
      expect(heartbeats).toHaveLength(1);
      expect(heartbeats[0]?.path).toBe('/tmp/heartbeat');
      expect(heartbeats[0]?.contents.trim()).toBe('2026-09-16T10:00:00.000Z');

      clock.advance(CADENCE_MS);
      await vi.advanceTimersByTimeAsync(CADENCE_MS);
      expect(heartbeats).toHaveLength(2);
      expect(heartbeats[1]?.contents.trim()).toBe('2026-09-16T10:01:00.000Z');

      await scheduler.stop(0);
    });

    it('is written even for a tick whose sweep failed', async () => {
      const broken = controllableSweep('broken', CADENCE_SECONDS);
      broken.set(() => Promise.reject(new Error('boom')));
      const scheduler = build([broken.sweep]);
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1);
      expect(heartbeats).toHaveLength(1);

      await scheduler.stop(0);
    });

    it('survives a heartbeat write that fails, and keeps sweeping', async () => {
      writeHeartbeat = () => Promise.reject(new Error('read-only filesystem'));
      const sweep = controllableSweep('beats', CADENCE_SECONDS);
      const recorder = recordingLogger();
      const scheduler = build([sweep.sweep], recorder.logger);
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(CADENCE_MS);

      expect(recorder.matching('worker_heartbeat_write_failed').length).toBeGreaterThan(0);
      expect(sweep.calls.length).toBeGreaterThanOrEqual(2);

      await scheduler.stop(0);
    });
  });

  describe('ALERT sweep_stalled (FR-038)', () => {
    it('is emitted once the last success is older than three cadences, and only once', async () => {
      const flaky = controllableSweep('flaky', CADENCE_SECONDS);
      const recorder = recordingLogger();
      const scheduler = build([flaky.sweep], recorder.logger);
      scheduler.start();

      // One success, so there is a "last success" to age.
      await vi.advanceTimersByTimeAsync(1);
      expect(recorder.matching('ALERT sweep_stalled')).toHaveLength(0);

      // Everything after this fails, while the clock runs past 3× the cadence.
      flaky.set(() => Promise.reject(new Error('boom')));
      for (let i = 0; i < 4; i += 1) {
        clock.advance(CADENCE_MS);
        await vi.advanceTimersByTimeAsync(CADENCE_MS);
      }

      expect(recorder.matching('ALERT sweep_stalled')).toHaveLength(1);
      expect(recorder.matching('ALERT sweep_stalled')[0]?.line).toContain('sweep=flaky');

      await scheduler.stop(0);
    });

    it('clears after a success, so a later stall alerts again', async () => {
      const flaky = controllableSweep('flaky', CADENCE_SECONDS);
      const recorder = recordingLogger();
      const scheduler = build([flaky.sweep], recorder.logger);
      scheduler.start();
      await vi.advanceTimersByTimeAsync(1);

      flaky.set(() => Promise.reject(new Error('boom')));
      for (let i = 0; i < 4; i += 1) {
        clock.advance(CADENCE_MS);
        await vi.advanceTimersByTimeAsync(CADENCE_MS);
      }
      expect(recorder.matching('ALERT sweep_stalled')).toHaveLength(1);

      // Recovers.
      flaky.set(() => Promise.resolve('ok'));
      clock.advance(CADENCE_MS);
      await vi.advanceTimersByTimeAsync(CADENCE_MS);

      // Stalls again.
      flaky.set(() => Promise.reject(new Error('boom')));
      for (let i = 0; i < 4; i += 1) {
        clock.advance(CADENCE_MS);
        await vi.advanceTimersByTimeAsync(CADENCE_MS);
      }
      expect(recorder.matching('ALERT sweep_stalled')).toHaveLength(2);

      await scheduler.stop(0);
    });

    it('is not emitted while a sweep keeps succeeding', async () => {
      const healthy = controllableSweep('healthy', CADENCE_SECONDS);
      const recorder = recordingLogger();
      const scheduler = build([healthy.sweep], recorder.logger);
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1);
      for (let i = 0; i < 5; i += 1) {
        clock.advance(CADENCE_MS);
        await vi.advanceTimersByTimeAsync(CADENCE_MS);
      }

      expect(recorder.matching('ALERT sweep_stalled')).toHaveLength(0);

      await scheduler.stop(0);
    });
  });

  describe('stop', () => {
    it('stops new ticks', async () => {
      const sweep = controllableSweep('stops', CADENCE_SECONDS);
      const scheduler = build([sweep.sweep]);
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1);
      expect(sweep.calls).toHaveLength(1);

      await scheduler.stop(0);
      await vi.advanceTimersByTimeAsync(CADENCE_MS * 5);
      expect(sweep.calls).toHaveLength(1);
    });

    it('awaits an in-flight run and reports that it finished', async () => {
      const slow = controllableSweep('slow', CADENCE_SECONDS);
      let finished = false;
      slow.set(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        finished = true;
        return 'ok';
      });

      const scheduler = build([slow.sweep]);
      scheduler.start();
      await vi.advanceTimersByTimeAsync(1);

      const stopping = scheduler.stop(30_000);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(stopping).resolves.toBe(true);
      expect(finished).toBe(true);
    });

    it('gives up on an in-flight run past the deadline and says so', async () => {
      const stuck = controllableSweep('stuck', CADENCE_SECONDS);
      stuck.set(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600_000));
        return 'ok';
      });

      const recorder = recordingLogger();
      const scheduler = build([stuck.sweep], recorder.logger);
      scheduler.start();
      await vi.advanceTimersByTimeAsync(1);

      const stopping = scheduler.stop(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(stopping).resolves.toBe(false);
      expect(recorder.matching('worker_sweep_stop_timeout')).toHaveLength(1);
    });

    it('returns true immediately when nothing is running', async () => {
      const scheduler = build([controllableSweep('idle', CADENCE_SECONDS).sweep]);
      scheduler.start();
      await expect(scheduler.stop(0)).resolves.toBe(true);
    });
  });

  /**
   * SC-011 reaches the operational logs too: a sweep summary is counts, and a
   * scheduler line is a name, an outcome, a duration and a correlation id.
   */
  it('logs names, outcomes, durations and correlation ids only', async () => {
    const sweep = controllableSweep('report-overdue-tasks', CADENCE_SECONDS);
    sweep.set(() => Promise.resolve('reported 3, skipped 0, failed 0, lag 0s'));

    const recorder = recordingLogger();
    const scheduler = build([sweep.sweep], recorder.logger);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1);

    const run = recorder.matching('worker_sweep_run')[0]?.line ?? '';
    expect(run).toContain('sweep=report-overdue-tasks');
    expect(run).toContain('outcome=succeeded');
    expect(run).toMatch(/duration_ms=\d/);
    expect(run).toMatch(/correlationId=[0-9a-f-]{36}/);
    // Nothing resembling a person or a title anywhere in the output.
    for (const { line } of recorder.lines) {
      expect(line).not.toMatch(/@|Charlie|title=/);
    }

    await scheduler.stop(0);
  });
});
