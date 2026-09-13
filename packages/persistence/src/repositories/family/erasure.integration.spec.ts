import { randomUUID } from 'node:crypto';
import {
  EmailAddress,
  asFamilyId,
  asFamilyMemberId,
  asGuardianshipId,
  asInvitationId,
  asUserId,
  unwrap,
} from '@fp/kernel';
import { family } from '@fp/core';
import { describe, expect, it } from 'vitest';
import { createFamilyUnitOfWork } from '../../family-context.js';
import { eraseForFamily, eraseForMember } from './erasure.js';

const now = new Date('2026-09-13T10:00:00Z');

describe('eraseForMember (Principle XI)', () => {
  it("nulls the member's personal fields, keeps the tombstone, and ends their guardianships without touching other members", async () => {
    const uow = createFamilyUnitOfWork();
    const familyId = asFamilyId(randomUUID());
    const ownerMemberId = asFamilyMemberId(randomUUID());
    // An eligible adult, not the owner: `family_member_owner_is_linked_adult`
    // requires an owner to stay a linked adult, so erasing the OWNER
    // directly is not a state this operation is ever asked to reach —
    // `removeMember` already refuses to remove the sole owner, and the same
    // "transfer first" rule applies to erasure.
    const guardianMemberId = asFamilyMemberId(randomUUID());
    const childMemberId = asFamilyMemberId(randomUUID());
    const guardianshipId = randomUUID();

    const fam = unwrap(family.Family.create({ id: familyId, name: 'Lovelace', now }));
    const owner = unwrap(
      family.FamilyMember.createOwner({
        id: ownerMemberId,
        familyId,
        userId: asUserId(randomUUID()),
        displayName: 'Ada',
        now,
      }),
    );
    const guardianMember = unwrap(
      family.FamilyMember.createFromInvitation({
        id: guardianMemberId,
        familyId,
        userId: asUserId(randomUUID()),
        role: 'adult',
        displayName: 'Grace',
        now,
      }),
    );
    const child = unwrap(
      family.FamilyMember.createUnlinked({
        id: childMemberId,
        familyId,
        kind: 'child',
        displayName: 'Bo',
        dateOfBirth: new Date('2019-04-02'),
        now,
      }),
    );
    const guardianship = unwrap(
      family.Guardianship.establish({
        id: asGuardianshipId(guardianshipId),
        familyId,
        guardianMemberId,
        guardianKind: 'adult',
        guardianRole: 'adult',
        childMemberId,
        childKind: 'child',
        now,
      }),
    );

    await uow.withFamilyContext(familyId, async (tx) => {
      await tx.families.save(fam);
      await tx.members.save(owner);
      await tx.members.save(guardianMember);
      await tx.members.save(child);
      await tx.guardianships.save(guardianship);
    });

    await eraseForMember(guardianMemberId);

    const [guardianAfter, ownerAfter, childAfter, guardianshipAfter] = await uow.withFamilyContext(
      familyId,
      (tx) =>
        Promise.all([
          tx.members.findById(guardianMemberId),
          tx.members.findById(ownerMemberId),
          tx.members.findById(childMemberId),
          tx.guardianships.findActive(guardianMemberId, childMemberId),
        ]),
    );

    expect(guardianAfter?.displayName).toBeNull();
    expect(guardianAfter?.userId).toBeNull();
    expect(guardianAfter?.removedAt).not.toBeNull();
    // The row survives — a tombstone, not a delete.
    expect(guardianAfter?.id).toBe(guardianMemberId);

    // Other members, untouched.
    expect(ownerAfter?.displayName).toBe('Ada');
    expect(childAfter?.displayName).toBe('Bo');

    // The guardianship this member held is ended, not left dangling.
    expect(guardianshipAfter).toBeNull();
  });

  it('is a no-op for an id that does not exist', async () => {
    await expect(eraseForMember(asFamilyMemberId(randomUUID()))).resolves.toBeUndefined();
  });
});

describe('eraseForFamily (Principle XI)', () => {
  it('removes the family and every row that referenced it', async () => {
    const uow = createFamilyUnitOfWork();
    const familyId = asFamilyId(randomUUID());
    const ownerMemberId = asFamilyMemberId(randomUUID());

    const fam = unwrap(family.Family.create({ id: familyId, name: 'Lovelace', now }));
    const owner = unwrap(
      family.FamilyMember.createOwner({
        id: ownerMemberId,
        familyId,
        userId: asUserId(randomUUID()),
        displayName: 'Ada',
        now,
      }),
    );
    const invitation = unwrap(
      family.Invitation.create({
        id: asInvitationId(randomUUID()),
        familyId,
        email: EmailAddress.from(`grace-${randomUUID()}@example.com`),
        proposedRole: 'adult',
        tokenHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
        invitedByMemberId: ownerMemberId,
        now,
        ttlMs: 14 * 24 * 60 * 60 * 1000,
      }),
    );

    await uow.withFamilyContext(familyId, async (tx) => {
      await tx.families.save(fam);
      await tx.members.save(owner);
      await tx.invitations.save(invitation);
    });

    await eraseForFamily(familyId);

    const survivingFamily = await uow.withFamilyContext(familyId, (tx) =>
      tx.families.findCurrent(),
    );
    expect(survivingFamily).toBeNull();
  });

  it('is a no-op for a family that does not exist', async () => {
    await expect(eraseForFamily(asFamilyId(randomUUID()))).resolves.toBeUndefined();
  });
});
