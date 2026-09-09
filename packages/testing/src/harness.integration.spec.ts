import { describe, expect, it } from 'vitest';
import { checkDatabaseHealth } from '@fp/persistence';
import { withDatabase } from './transaction.js';
import { resolveTestDatabase } from './database.js';

/**
 * FR-022: at least one real integration test proves the harness end to end,
 * before there is any domain code to use it — the same reasoning that had
 * spec 001 prove the migration mechanism with a scaffolding table rather than
 * waiting for a real one.
 *
 * These tests are the harness's own acceptance criteria. If the transaction
 * did not actually roll back, everything built on it would leak state between
 * tests and the failures would surface much later, somewhere else.
 */
describe('the integration harness', () => {
  it('runs against a database carrying every committed migration', async () => {
    await expect(checkDatabaseHealth()).resolves.toBeUndefined();
  });

  it('targets a separate database, never the development one', () => {
    const resolved = resolveTestDatabase('postgresql://postgres:pw@localhost:5432/family_platform');

    expect(resolved.name).toBe('family_platform_test');
    expect(resolved.url).toContain('/family_platform_test');
  });

  it('is connected to the test database, not the development one', async () => {
    // The guard for the failure mode that has no symptoms: the Prisma client
    // is constructed at import time, so if DATABASE_URL is redirected even
    // slightly too late the whole suite runs against the database you were
    // developing in, passing the entire way.
    await withDatabase(async (tx) => {
      const [row] = await tx.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;

      expect(row?.name).toMatch(/_test$/);
    });
  });

  it('sees what the test itself writes', async () => {
    await withDatabase(async (tx) => {
      const before = await tx.scaffoldProbe.count();
      await tx.scaffoldProbe.create({ data: {} });

      expect(await tx.scaffoldProbe.count()).toBe(before + 1);
    });
  });

  it('rolls the write back, so the next test starts clean', async () => {
    const created = await withDatabase(async (tx) => {
      const row = await tx.scaffoldProbe.create({ data: {} });
      return row.id;
    });

    await withDatabase(async (tx) => {
      expect(await tx.scaffoldProbe.findUnique({ where: { id: created } })).toBeNull();
    });
  });

  it('propagates a failure rather than swallowing it with the rollback (FR-023)', async () => {
    await expect(withDatabase(() => Promise.reject(new Error('deliberate')))).rejects.toThrow(
      'deliberate',
    );
  });
});
