import { defineConfig } from 'vitest/config';

/**
 * Two tiers, one configuration (FR-019).
 *
 * `unit` must run with no database anywhere and stay under 30 seconds
 * (FR-021, SC-007). If it ever needs a database the tiers have leaked into
 * each other, and the fast feedback loop this split exists to protect is gone.
 *
 * `integration` needs a real, migrated PostgreSQL. It is a separate CI job
 * (`test-integration`) rather than part of `test`, because the constitution's
 * gate table lists unit and integration tests as separate rows and because one
 * job would make the fast tier as slow as the slow one.
 */
const IGNORED = ['**/node_modules/**', '**/dist/**', '**/src/generated/**'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages,scripts,infrastructure}/**/*.spec.ts'],
          exclude: [...IGNORED, '**/*.integration.spec.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['{apps,packages}/**/*.integration.spec.ts'],
          exclude: IGNORED,
          // globalSetup, not setupFiles: the Prisma client is built at import
          // time, so DATABASE_URL has to be right before any worker forks.
          globalSetup: ['./packages/testing/src/vitest-global-setup.ts'],
          pool: 'forks',
          // One worker, files in sequence. The harness creates and migrates
          // the test database once per run and workers share no module state,
          // so parallel workers would each repeat that work and race on
          // CREATE DATABASE. Test-level isolation comes from transaction
          // rollback instead, which is cheaper than either.
          maxWorkers: 1,
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
