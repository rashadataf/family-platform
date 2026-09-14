import { randomUUID } from 'node:crypto';
import { asFamilyId, asFamilyMemberId, asGuardianshipId, asUserId, unwrap } from '@fp/kernel';
import { family } from '@fp/core';
import { createFamilyUnitOfWork } from '@fp/persistence';
import { describe, expect, it } from 'vitest';
import { runGuardianCoverageSweep } from './guardian-coverage.sweep.js';

const now = new Date('2026-09-13T10:00:00Z');

describe('runGuardianCoverageSweep (SC-006)', () => {
  it('finds a child with zero active guardians and leaves a guarded one out', async () => {
    const uow = createFamilyUnitOfWork();
    const familyId = asFamilyId(randomUUID());
    const ownerMemberId = asFamilyMemberId(randomUUID());
    const uncoveredChildId = asFamilyMemberId(randomUUID());
    const coveredChildId = asFamilyMemberId(randomUUID());

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
    const uncoveredChild = unwrap(
      family.FamilyMember.createUnlinked({
        id: uncoveredChildId,
        familyId,
        kind: 'child',
        displayName: 'Bo',
        now,
      }),
    );
    const coveredChild = unwrap(
      family.FamilyMember.createUnlinked({
        id: coveredChildId,
        familyId,
        kind: 'child',
        displayName: 'Cass',
        now,
      }),
    );
    const guardianship = unwrap(
      family.Guardianship.establish({
        id: asGuardianshipId(randomUUID()),
        familyId,
        guardianMemberId: ownerMemberId,
        guardianKind: 'adult',
        guardianRole: 'owner',
        childMemberId: coveredChildId,
        childKind: 'child',
        now,
      }),
    );

    await uow.withFamilyContext(familyId, async (tx) => {
      await tx.families.save(fam);
      await tx.members.save(owner);
      await tx.members.save(uncoveredChild);
      await tx.members.save(coveredChild);
      await tx.guardianships.save(guardianship);
    });

    const result = await runGuardianCoverageSweep();
    const foundIds = result.uncoveredChildren.map((c) => c.childMemberId);

    expect(foundIds).toContain(uncoveredChildId);
    expect(foundIds).not.toContain(coveredChildId);
  });
});
