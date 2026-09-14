import { asFamilyId, asFamilyMemberId, asUserId } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { Family } from '../../domain/family.aggregate.js';
import { HouseholdProfile } from '../../domain/household-profile.vo.js';
import { emptyFamilyState, fakeFamilyUnitOfWork } from '../family-unit-of-work.fake.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';
import { resolveFamilyContext } from './resolve-family-context.query.js';

const familyId = asFamilyId('11111111-1111-7111-8111-111111111111');
const memberId = asFamilyMemberId('22222222-2222-7222-8222-222222222222');
const userId = asUserId('33333333-3333-7333-8333-333333333333');

function unitOfWork(overrides: {
  family?: { deletionRequestedAt: Date | null } | null;
  standing?: { memberId: typeof memberId; role: 'owner' | 'adult' | 'extended' | 'viewer' } | null;
}): FamilyUnitOfWorkPort {
  return fakeFamilyUnitOfWork(
    emptyFamilyState({
      family:
        overrides.family == null
          ? null
          : Family.reconstitute({
              id: familyId,
              name: 'Lovelace',
              profile: HouseholdProfile.empty,
              createdAt: new Date('2026-01-01T00:00:00Z'),
              updatedAt: new Date('2026-01-01T00:00:00Z'),
              deletionRequestedAt: overrides.family.deletionRequestedAt,
            }),
      standing: overrides.standing ?? null,
    }),
  );
}

describe('resolveFamilyContext', () => {
  it("returns the member id, role and the role's capability set", async () => {
    const context = await resolveFamilyContext(
      { userId, familyId },
      {
        unitOfWork: unitOfWork({
          family: { deletionRequestedAt: null },
          standing: { memberId, role: 'adult' },
        }),
      },
    );

    expect(context).not.toBeNull();
    expect(context?.memberId).toBe(memberId);
    expect(context?.role).toBe('adult');
    expect(context?.capabilities).toContain('documents:write:sensitive');
    expect(context?.capabilities).not.toContain('billing:manage');
  });

  /**
   * FR-021 and SC-004. Four different situations, one answer — a caller must
   * not be able to tell "not yours" from "not there", because a distinguishable
   * response is an enumeration oracle. Asserted together rather than one per
   * test, because it is the *sameness* that is the requirement.
   */
  it.each([
    ['the family does not exist', { family: null, standing: null }],
    ['the caller is not a member', { family: { deletionRequestedAt: null }, standing: null }],
    ['the membership was removed', { family: { deletionRequestedAt: null }, standing: null }],
    [
      'the family is pending deletion',
      {
        family: { deletionRequestedAt: new Date('2026-09-13T00:00:00Z') },
        standing: { memberId, role: 'owner' as const },
      },
    ],
  ])('returns null when %s', async (_case, overrides) => {
    const context = await resolveFamilyContext(
      { userId, familyId },
      { unitOfWork: unitOfWork(overrides) },
    );

    expect(context).toBeNull();
  });

  it('revokes an owner the moment deletion is requested, not when erasure completes', async () => {
    // FR-023: the request revokes access immediately. The rows survive the
    // grace period; standing does not.
    const stillTheOwner = { memberId, role: 'owner' as const };

    const before = await resolveFamilyContext(
      { userId, familyId },
      {
        unitOfWork: unitOfWork({ family: { deletionRequestedAt: null }, standing: stillTheOwner }),
      },
    );
    const after = await resolveFamilyContext(
      { userId, familyId },
      {
        unitOfWork: unitOfWork({
          family: { deletionRequestedAt: new Date() },
          standing: stillTheOwner,
        }),
      },
    );

    expect(before?.role).toBe('owner');
    expect(after).toBeNull();
  });

  it('resolves inside a transaction scoped to the requested family', () => {
    // The scope is what makes this safe to run before authorization: the
    // policies apply to the lookup like any other query, so a caller naming
    // someone else's family gets a transaction scoped to it and no rows back.
    const state = emptyFamilyState();

    return resolveFamilyContext(
      { userId, familyId },
      { unitOfWork: fakeFamilyUnitOfWork(state) },
    ).then(() => {
      expect(state.scopedTo).toEqual([familyId]);
    });
  });
});
