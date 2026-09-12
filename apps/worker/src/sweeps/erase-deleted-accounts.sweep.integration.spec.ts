import { randomUUID } from 'node:crypto';
import { asUserId } from '@fp/kernel';
import { identity } from '@fp/core';
import { createIdentityUnitOfWork } from '@fp/persistence';
import { describe, expect, it } from 'vitest';
import { runEraseDeletedAccountsSweep } from './erase-deleted-accounts.sweep.js';

function fixedClock(date: Date) {
  return { now: () => date };
}

describe('runEraseDeletedAccountsSweep', () => {
  it('deletes an account whose deletion was requested over 30 days ago, leaves a recent one alone, and is a no-op on rerun', async () => {
    const uow = createIdentityUnitOfWork();
    const asOf = new Date();
    const overdueRequestedAt = new Date(asOf.getTime() - 31 * 24 * 60 * 60 * 1000);
    const recentRequestedAt = new Date(asOf.getTime() - 1 * 24 * 60 * 60 * 1000);

    const overdueUser = identity.User.register({
      id: asUserId(randomUUID()),
      email: identity.EmailAddress.from(`overdue-${randomUUID()}@example.com`),
      passwordHash: 'not-a-real-hash',
      now: new Date(overdueRequestedAt.getTime() - 1000),
    });
    overdueUser.verify(new Date(overdueRequestedAt.getTime() - 500));
    overdueUser.requestDeletion(overdueRequestedAt);

    const recentUser = identity.User.register({
      id: asUserId(randomUUID()),
      email: identity.EmailAddress.from(`recent-${randomUUID()}@example.com`),
      passwordHash: 'not-a-real-hash',
      now: new Date(recentRequestedAt.getTime() - 1000),
    });
    recentUser.verify(new Date(recentRequestedAt.getTime() - 500));
    recentUser.requestDeletion(recentRequestedAt);

    await uow.run(async (tx) => {
      await tx.users.save(overdueUser);
      await tx.users.save(recentUser);
    });

    const result = await runEraseDeletedAccountsSweep(fixedClock(asOf));

    expect(result.deletedCount).toBeGreaterThanOrEqual(1);
    expect(await uow.run((tx) => tx.users.findById(overdueUser.id))).toBeNull();
    expect(await uow.run((tx) => tx.users.findById(recentUser.id))).not.toBeNull();

    // Rerunning immediately must not error, and must not re-delete or
    // un-delete anything (quickstart.md Scenario 7).
    await expect(runEraseDeletedAccountsSweep(fixedClock(asOf))).resolves.toBeDefined();
    expect(await uow.run((tx) => tx.users.findById(overdueUser.id))).toBeNull();

    // Clean up the fixture the sweep correctly left alone.
    await runEraseDeletedAccountsSweep(
      fixedClock(new Date(asOf.getTime() + 32 * 24 * 60 * 60 * 1000)),
    );
  });
});
