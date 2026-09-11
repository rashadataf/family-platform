import { randomUUID } from 'node:crypto';
import { asDeviceId, asSessionId, asUserId } from '@fp/kernel';
import { identity } from '@fp/core';
import { createIdentityUnitOfWork } from '@fp/persistence';
import { describe, expect, it } from 'vitest';
import { runEraseDeletedAccountsSweep } from './erase-deleted-accounts.sweep.js';
import { runEraseStaleSessionsSweep } from './erase-stale-sessions.sweep.js';

function fixedClock(date: Date) {
  return { now: () => date };
}

function hexToken(): string {
  return randomUUID().replace(/-/g, '');
}

describe('runEraseStaleSessionsSweep', () => {
  it('deletes a session revoked over 90 days ago, leaves a recently-revoked one alone, and is a no-op on rerun', async () => {
    const uow = createIdentityUnitOfWork();
    const asOf = new Date();
    const overdueRevokedAt = new Date(asOf.getTime() - 91 * 24 * 60 * 60 * 1000);
    const recentRevokedAt = new Date(asOf.getTime() - 1 * 24 * 60 * 60 * 1000);
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;

    const user = identity.User.register({
      id: asUserId(randomUUID()),
      email: identity.EmailAddress.from(`stale-${randomUUID()}@example.com`),
      passwordHash: 'not-a-real-hash',
      now: asOf,
    });

    const overdueDevice = identity.Device.register({
      id: asDeviceId(randomUUID()),
      userId: user.id,
      label: 'Overdue device',
      now: asOf,
    });
    const overdueSession = identity.Session.issue({
      id: asSessionId(randomUUID()),
      userId: user.id,
      deviceId: overdueDevice.id,
      tokenHash: hexToken(),
      now: asOf,
      absoluteLifetimeMs: oneYearMs,
    });
    overdueSession.revoke('user_revoked', overdueRevokedAt);

    const recentDevice = identity.Device.register({
      id: asDeviceId(randomUUID()),
      userId: user.id,
      label: 'Recent device',
      now: asOf,
    });
    const recentSession = identity.Session.issue({
      id: asSessionId(randomUUID()),
      userId: user.id,
      deviceId: recentDevice.id,
      tokenHash: hexToken(),
      now: asOf,
      absoluteLifetimeMs: oneYearMs,
    });
    recentSession.revoke('user_revoked', recentRevokedAt);

    await uow.run(async (tx) => {
      await tx.users.save(user);
      await tx.devices.save(overdueDevice);
      await tx.devices.save(recentDevice);
      await tx.sessions.save(overdueSession);
      await tx.sessions.save(recentSession);
    });

    const result = await runEraseStaleSessionsSweep(fixedClock(asOf));

    expect(result.deletedCount).toBeGreaterThanOrEqual(1);
    expect(await uow.run((tx) => tx.sessions.findById(overdueSession.id))).toBeNull();
    expect(await uow.run((tx) => tx.sessions.findById(recentSession.id))).not.toBeNull();

    // Rerunning immediately must not error, and must not re-delete or
    // un-delete anything (quickstart.md Scenario 7).
    await expect(runEraseStaleSessionsSweep(fixedClock(asOf))).resolves.toBeDefined();
    expect(await uow.run((tx) => tx.sessions.findById(overdueSession.id))).toBeNull();

    // Clean up every fixture this test left behind — the recent session and
    // the user itself, whose deletion cascades to any remaining session and
    // device rows (data-model.md).
    await runEraseStaleSessionsSweep(
      fixedClock(new Date(asOf.getTime() + 91 * 24 * 60 * 60 * 1000)),
    );
    const deletionRequestedAt = asOf;
    user.verify(deletionRequestedAt);
    user.requestDeletion(deletionRequestedAt);
    await uow.run((tx) => tx.users.save(user));
    await runEraseDeletedAccountsSweep(
      fixedClock(new Date(deletionRequestedAt.getTime() + 31 * 24 * 60 * 60 * 1000)),
    );
  });
});
