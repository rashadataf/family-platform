import { randomUUID } from 'node:crypto';
import {
  EmailAddress,
  asFamilyId,
  asFamilyMemberId,
  asInvitationId,
  asUserId,
  unwrap,
} from '@fp/kernel';
import { family } from '@fp/core';
import { createFamilyUnitOfWork } from '@fp/persistence';
import { describe, expect, it } from 'vitest';
import { runExpireInvitationsSweep } from './expire-invitations.sweep.js';

function fixedClock(date: Date) {
  return { now: () => date };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const INVITATION_TTL_MS = 14 * DAY_MS;

describe('runExpireInvitationsSweep', () => {
  it('marks an overdue pending invitation expired, leaves a live one alone, and is a no-op on rerun', async () => {
    const uow = createFamilyUnitOfWork();
    const familyId = asFamilyId(randomUUID());
    const ownerMemberId = asFamilyMemberId(randomUUID());
    const asOf = new Date();

    const fam = unwrap(family.Family.create({ id: familyId, name: 'Lovelace', now: asOf }));
    const owner = unwrap(
      family.FamilyMember.createOwner({
        id: ownerMemberId,
        familyId,
        userId: asUserId(randomUUID()),
        displayName: 'Ada',
        now: asOf,
      }),
    );
    // Created long enough ago that its 14-day TTL already elapsed.
    const overdueInvitation = unwrap(
      family.Invitation.create({
        id: asInvitationId(randomUUID()),
        familyId,
        email: EmailAddress.from(`overdue-${randomUUID()}@example.com`),
        proposedRole: 'adult',
        tokenHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
        invitedByMemberId: ownerMemberId,
        now: new Date(asOf.getTime() - 20 * DAY_MS),
        ttlMs: INVITATION_TTL_MS,
      }),
    );
    const liveInvitation = unwrap(
      family.Invitation.create({
        id: asInvitationId(randomUUID()),
        familyId,
        email: EmailAddress.from(`live-${randomUUID()}@example.com`),
        proposedRole: 'adult',
        tokenHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
        invitedByMemberId: ownerMemberId,
        now: asOf,
        ttlMs: INVITATION_TTL_MS,
      }),
    );

    await uow.withFamilyContext(familyId, async (tx) => {
      await tx.families.save(fam);
      await tx.members.save(owner);
      await tx.invitations.save(overdueInvitation);
      await tx.invitations.save(liveInvitation);
    });

    const result = await runExpireInvitationsSweep(fixedClock(asOf));
    expect(result.expiredCount).toBeGreaterThanOrEqual(1);

    const [overdueAfter, liveAfter] = await uow.withFamilyContext(familyId, (tx) =>
      Promise.all([
        tx.invitations.findById(overdueInvitation.id),
        tx.invitations.findById(liveInvitation.id),
      ]),
    );
    expect(overdueAfter?.status).toBe('expired');
    expect(liveAfter?.status).toBe('pending');

    // Rerunning immediately must not error and must not touch what is
    // already settled (the same contract every retention sweep keeps).
    await expect(runExpireInvitationsSweep(fixedClock(asOf))).resolves.toBeDefined();
    const overdueAfterRerun = await uow.withFamilyContext(familyId, (tx) =>
      tx.invitations.findById(overdueInvitation.id),
    );
    expect(overdueAfterRerun?.status).toBe('expired');
  });
});
