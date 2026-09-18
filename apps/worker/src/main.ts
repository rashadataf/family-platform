import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { disconnectDatabase } from '@fp/persistence';
import { SystemClock } from '@fp/platform';
import { parseWorkerEnv } from './config/worker-env.js';
import { SweepScheduler } from './scheduler/scheduler.js';
import { SWEEPS } from './sweeps/registry.js';

/**
 * ADR-002 scopes this host to queue consumers and scheduled sweeps — no HTTP
 * listener. `createApplicationContext` gives DI without binding a port.
 *
 * As of spec 010 the worker runs the platform's scheduled sweeps itself, on
 * validated per-sweep cadences (FR-037): before this, no sweep had ever run
 * automatically anywhere. Queue consumers arrive with spec 011, behind
 * ADR-018.
 */
@Module({})
class WorkerModule {}

const STOP_DEADLINE_MS = 25_000;

async function bootstrap(): Promise<void> {
  // Parsed before anything is scheduled, so a bad cadence fails the boot
  // rather than surfacing as a sweep that never runs (Principle II).
  const env = parseWorkerEnv();

  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  const scheduler = new SweepScheduler({
    sweeps: SWEEPS,
    cadences: env.cadences,
    clock: new SystemClock(),
    heartbeatPath: env.heartbeatPath,
  });
  scheduler.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`worker_shutdown signal=${signal}`);

    // In-flight sweeps first, then the pool, then the context: a sweep still
    // holding a transaction when the client disconnects would fail on the way
    // out and log a spurious error.
    const settled = await scheduler.stop(STOP_DEADLINE_MS);
    if (!settled) console.warn('worker_shutdown incomplete=true');
    await disconnectDatabase();
    await app.close();
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

await bootstrap();
