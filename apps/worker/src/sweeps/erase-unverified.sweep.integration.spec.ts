import { randomUUID } from 'node:crypto';
import { asUserId } from '@fp/kernel';
import { identity } from '@fp/core';
import { createIdentityUnitOfWork } from '@fp/persistence';
import { describe, expect, it } from 'vitest';
import { runEraseUnverifiedSweep } from './erase-unverified.sweep.js';

function fixedClock(date: Date) {
  return { now: () => date };
}

describe('runEraseUnverifiedSweep', () => {
  it('deletes a registration unverified past 30 days, leaves a recent one alone, and is a no-op on rerun', async () => {
    const uow = createIdentityUnitOfWork();
    const asOf = new Date();
    const overdueRegisteredAt = new Date(asOf.getTime() - 31 * 24 * 60 * 60 * 1000);
    const recentRegisteredAt = new Date(asOf.getTime() - 1 * 24 * 60 * 60 * 1000);

    const overdueUser = identity.User.register({
      id: asUserId(randomUUID()),
      email: identity.EmailAddress.from(`overdue-${randomUUID()}@example.com`),
      passwordHash: 'not-a-real-hash',
      now: overdueRegisteredAt,
    });
    const recentUser = identity.User.register({
      id: asUserId(randomUUID()),
      email: identity.EmailAddress.from(`recent-${randomUUID()}@example.com`),
      passwordHash: 'not-a-real-hash',
      now: recentRegisteredAt,
    });

    await uow.run(async (tx) => {
      await tx.users.save(overdueUser);
      await tx.users.save(recentUser);
    });

    const result = await runEraseUnverifiedSweep(fixedClock(asOf));

    expect(result.deletedCount).toBeGreaterThanOrEqual(1);
    expect(await uow.run((tx) => tx.users.findById(overdueUser.id))).toBeNull();
    expect(await uow.run((tx) => tx.users.findById(recentUser.id))).not.toBeNull();

    // Rerunning immediately must not error, and must not somehow un-delete
    // or re-delete what is already gone (quickstart.md Scenario 7).
    await expect(runEraseUnverifiedSweep(fixedClock(asOf))).resolves.toBeDefined();
    expect(await uow.run((tx) => tx.users.findById(overdueUser.id))).toBeNull();

    // Clean up the fixture the sweep correctly left alone, so it doesn't
    // linger in the shared test database for a later run.
    await runEraseUnverifiedSweep(fixedClock(new Date(asOf.getTime() + 32 * 24 * 60 * 60 * 1000)));
  });
});
