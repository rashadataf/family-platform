import type { Server } from 'node:http';
import type { INestApplication, LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { buildAppModule } from '../../app.module.js';
import type { AppEnv } from '../../config/env.schema.js';
import { MAILER } from '../../identity/identity.tokens.js';
import { FakeMailer } from '../../identity/test-support/fake-mailer.js';
import { TASKS_CLOCK } from '../tasks.tokens.js';

/**
 * A clock the suite controls. Declared here rather than taken from
 * `@fp/testing`'s identical helper: this file is not a spec, and only specs may
 * reach the harness (`harness-is-test-only`).
 */
export interface FixedClock {
  now(): Date;
  set(instant: Date | string): void;
  advanceDays(days: number): void;
}

function fixedClock(start: string): FixedClock {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    set: (instant) => {
      current = new Date(instant);
    },
    advanceDays: (days) => {
      current = new Date(current.getTime() + days * 86_400_000);
    },
  };
}

/** The "now" every Tasks suite runs at unless it moves the clock: the day spec 010 was implemented. */
export const TASKS_TEST_NOW = '2026-09-16T10:00:00Z';

/**
 * `bootstrapTestApp`'s real app graph, with Tasks' clock pinned.
 *
 * `isOverdue` is computed against the clock on every response (FR-025) and a
 * successor's due date is computed from the closing instant, so a Tasks test on
 * a wall clock would pass or fail depending on the day it ran — the kind of test
 * that is green for a year and red on a boundary nobody reproduces. Only
 * `TASKS_CLOCK` is replaced; sessions and families keep the system clock,
 * because nothing they assert depends on a date.
 */
export async function bootstrapTasksApp(
  options: { logger?: LoggerService; now?: string } = {},
): Promise<{
  app: INestApplication;
  server: Server;
  mailer: FakeMailer;
  clock: FixedClock;
}> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set — run this suite via `pnpm test:integration`.');
  }

  const env: AppEnv = {
    NODE_ENV: 'test',
    PORT: 0,
    LOG_LEVEL: 'error',
    POSTGRES_PORT: 5432,
    POSTGRES_DB: 'unused',
    DATABASE_URL: databaseUrl,
    MAIL_HOST: 'unused',
    MAIL_PORT: 1,
  };

  const mailer = new FakeMailer();
  const clock = fixedClock(options.now ?? TASKS_TEST_NOW);

  const moduleRef = await Test.createTestingModule({ imports: [buildAppModule(env)] })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .overrideProvider(TASKS_CLOCK)
    .useValue(clock)
    .compile();

  const app = moduleRef.createNestApplication();
  if (options.logger) app.useLogger(options.logger);
  await app.init();
  const server: unknown = app.getHttpServer();

  return { app, server: server as Server, mailer, clock };
}
