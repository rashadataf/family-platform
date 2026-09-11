import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { buildAppModule } from '../../app.module.js';
import type { AppEnv } from '../../config/env.schema.js';
import { MAILER } from '../identity.tokens.js';
import { FakeMailer } from './fake-mailer.js';

/**
 * Boots the real app graph (the same `buildAppModule` main.ts uses) against
 * the real test database `vitest-global-setup.ts` already pointed
 * `DATABASE_URL` at, with the mailer swapped for an in-memory fake — nothing
 * here should reach a real SMTP server.
 *
 * Returns `server` (typed) alongside `app`, so callers pass it to `supertest`
 * directly — `app.getHttpServer()` itself returns `any`, and Nest's
 * Express-platform server is a real `http.Server` at runtime.
 */
export async function bootstrapTestApp(): Promise<{
  app: INestApplication;
  server: Server;
  mailer: FakeMailer;
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

  const moduleRef = await Test.createTestingModule({ imports: [buildAppModule(env)] })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  const server: unknown = app.getHttpServer();

  return { app, server: server as Server, mailer };
}
