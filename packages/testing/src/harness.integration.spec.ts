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
    const resolved = resolveTestDatabase(
      'postgresql://family_platform_app:pw@localhost:5432/family_platform',
      'postgresql://family_platform_owner:pw@localhost:5432/family_platform',
      'postgresql://postgres:pw@localhost:5432/family_platform',
    );

    expect(resolved.name).toBe('family_platform_test');
    expect(resolved.url).toContain('/family_platform_test');
    expect(resolved.ownerUrl).toContain('/family_platform_test');
    // CREATE DATABASE cannot run from inside the database it creates.
    expect(resolved.maintenanceUrl).toContain('/postgres');
  });

  it('keeps the three roles in their own lanes (ADR-017)', () => {
    const resolved = resolveTestDatabase(
      'postgresql://family_platform_app:pw@localhost:5432/family_platform',
      'postgresql://family_platform_owner:pw@localhost:5432/family_platform',
      'postgresql://postgres:pw@localhost:5432/family_platform',
    );

    // If the suite ever ran as the owner or the superuser, every row-level
    // security assertion in this repository would pass by seeing everything
    // rather than by being filtered — and would look identical either way.
    expect(new URL(resolved.url).username).toBe('family_platform_app');
    expect(new URL(resolved.ownerUrl).username).toBe('family_platform_owner');
    expect(new URL(resolved.maintenanceUrl).username).toBe('postgres');
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
      const before = await tx.user.count();
      await tx.user.create({
        data: { email: 'harness-write@example.com', passwordHash: 'not-a-real-hash' },
      });

      expect(await tx.user.count()).toBe(before + 1);
    });
  });

  it('rolls the write back, so the next test starts clean', async () => {
    const created = await withDatabase(async (tx) => {
      const row = await tx.user.create({
        data: { email: 'harness-rollback@example.com', passwordHash: 'not-a-real-hash' },
      });
      return row.id;
    });

    await withDatabase(async (tx) => {
      expect(await tx.user.findUnique({ where: { id: created } })).toBeNull();
    });
  });

  it('propagates a failure rather than swallowing it with the rollback (FR-023)', async () => {
    await expect(withDatabase(() => Promise.reject(new Error('deliberate')))).rejects.toThrow(
      'deliberate',
    );
  });
});
