import { prepareTestDatabase } from './database.js';

/**
 * Referenced as `globalSetup` by the `integration` project in the root
 * vitest.config.ts. It must be globalSetup and not a setup file, and the
 * reason is not stylistic.
 *
 * `@fp/persistence` constructs its PrismaClient at module scope, and
 * PrismaClient reads `DATABASE_URL` when it is constructed. A setup file runs
 * inside the worker, but only *after* the test file's imports have been
 * evaluated — so the client is already built and already pointing at the
 * development database by the time the setup file could redirect it. The
 * symptom is a suite that appears to work while quietly reading and writing
 * the database you were developing against, which is precisely what FR-018
 * exists to prevent.
 *
 * globalSetup runs in the main process before any worker is forked, so the
 * `DATABASE_URL` it sets is inherited by every worker and is in place before
 * the first import.
 *
 * `harness.integration.spec.ts` asserts the connected database name ends in
 * `_test`, so a regression here fails loudly rather than silently.
 */
export default async function setup(): Promise<void> {
  await prepareTestDatabase();
}
