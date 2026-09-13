import { asFamilyId, asFamilyMemberId, asUserId, isErr, isOk, unwrap } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { FamilyMember } from './family-member.aggregate.js';

const familyId = asFamilyId('11111111-1111-7111-8111-111111111111');
const id = asFamilyMemberId('22222222-2222-7222-8222-222222222222');
const userId = asUserId('33333333-3333-7333-8333-333333333333');
const now = new Date('2026-09-13T10:00:00Z');

describe('FamilyMember.createUnlinked', () => {
  /**
   * FR-003 and Principle VI. The strongest form of this guarantee is that
   * `createUnlinked` takes no `userId` parameter at all — there is nothing to
   * pass, so there is nothing to pass by mistake. These assert the resulting
   * state, which is what the CHECK constraints in the migration also enforce.
   */
  it('creates a child with no linked account and no login path', () => {
    const member = unwrap(
      FamilyMember.createUnlinked({
        id,
        familyId,
        kind: 'child',
        displayName: 'Bo',
        dateOfBirth: new Date('2019-04-02'),
        now,
      }),
    );

    expect(member.kind).toBe('child');
    expect(member.userId).toBeNull();
    expect(member.isChild).toBe(true);
  });

  it('fixes a child to the least privileged role', () => {
    // Not because a child exercises it — resolution needs a linked user, and a
    // child has none — but because the column is total, and least privilege is
    // the right value to carry if a future linkUserToMember promotes the
    // record.
    const child = unwrap(
      FamilyMember.createUnlinked({ id, familyId, kind: 'child', displayName: 'Bo', now }),
    );

    expect(child.role).toBe('viewer');
  });

  it('creates an extended member with the extended role and no account (FR-014)', () => {
    const member = unwrap(
      FamilyMember.createUnlinked({ id, familyId, kind: 'adult', displayName: 'Nan', now }),
    );

    expect(member.role).toBe('extended');
    expect(member.userId).toBeNull();
    expect(member.isChild).toBe(false);
  });

  it('refuses a member with no name', () => {
    expect(
      isErr(FamilyMember.createUnlinked({ id, familyId, kind: 'child', displayName: '  ', now })),
    ).toBe(true);
  });
});

describe('FamilyMember.createOwner', () => {
  it('is a linked adult, always', () => {
    // US4 Scenario 2: ownership carries billing:manage and family:delete, and
    // an unreachable owner is an unrecoverable family. Mirrored by the
    // `family_member_owner_is_linked_adult` CHECK.
    const owner = unwrap(
      FamilyMember.createOwner({ id, familyId, userId, displayName: 'Ada', now }),
    );

    expect(owner.role).toBe('owner');
    expect(owner.kind).toBe('adult');
    expect(owner.userId).toBe(userId);
  });
});

describe('FamilyMember.createFromInvitation', () => {
  it('links the accepting account to a new adult member', () => {
    const member = unwrap(
      FamilyMember.createFromInvitation({
        id,
        familyId,
        userId,
        role: 'adult',
        displayName: 'Grace',
        now,
      }),
    );

    expect(member.userId).toBe(userId);
    expect(member.kind).toBe('adult');
    expect(member.role).toBe('adult');
  });

  it('refuses to grant ownership by invitation (FR-018)', () => {
    const result = FamilyMember.createFromInvitation({
      id,
      familyId,
      userId,
      role: 'owner',
      displayName: 'Grace',
      now,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe('OwnerIneligible');
  });
});

describe('FamilyMember.changeRole', () => {
  function adult() {
    return unwrap(
      FamilyMember.createFromInvitation({
        id,
        familyId,
        userId,
        role: 'adult',
        displayName: 'Grace',
        now,
      }),
    );
  }

  it('changes a non-owner adult to another assignable role', () => {
    const member = adult();

    expect(isOk(member.changeRole('viewer', now))).toBe(true);
    expect(member.role).toBe('viewer');
  });

  it('refuses to promote anyone to owner (FR-018)', () => {
    // Ownership moves by transfer, in one transaction, so the
    // `family_one_owner` index never sees two.
    const result = adult().changeRole('owner', now);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe('OwnerRequired');
  });

  it('refuses to demote the owner directly (FR-018)', () => {
    const owner = unwrap(
      FamilyMember.createOwner({ id, familyId, userId, displayName: 'Ada', now }),
    );

    const result = owner.changeRole('adult', now);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe('OwnerRequired');
    expect(owner.role).toBe('owner');
  });

  it('refuses to give a child a role', () => {
    const child = unwrap(
      FamilyMember.createUnlinked({ id, familyId, kind: 'child', displayName: 'Bo', now }),
    );

    expect(isErr(child.changeRole('adult', now))).toBe(true);
    expect(child.role).toBe('viewer');
  });
});

describe('FamilyMember#promoteToOwner / #demoteFromOwnership (FR-018)', () => {
  it('promotes a linked adult member to owner', () => {
    const member = unwrap(
      FamilyMember.createFromInvitation({
        id,
        familyId,
        userId: asUserId('66666666-6666-7666-8666-666666666666'),
        role: 'adult',
        displayName: 'Grace',
        now,
      }),
    );

    const result = member.promoteToOwner(now);

    expect(isOk(result)).toBe(true);
    expect(member.role).toBe('owner');
  });

  it('refuses to promote an unlinked member', () => {
    const extended = unwrap(
      FamilyMember.createUnlinked({ id, familyId, kind: 'adult', displayName: 'Grandma', now }),
    );

    const result = extended.promoteToOwner(now);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe('OwnerIneligible');
  });

  it('demotes the current owner to adult', () => {
    const owner = unwrap(
      FamilyMember.createOwner({
        id,
        familyId,
        userId: asUserId('77777777-7777-7777-8777-777777777777'),
        displayName: 'Ada',
        now,
      }),
    );

    const result = owner.demoteFromOwnership(now);

    expect(isOk(result)).toBe(true);
    expect(owner.role).toBe('adult');
  });

  it('refuses to demote a member who is not the owner', () => {
    const adult = unwrap(
      FamilyMember.createFromInvitation({
        id,
        familyId,
        userId: asUserId('88888888-8888-7888-8888-888888888888'),
        role: 'adult',
        displayName: 'Grace',
        now,
      }),
    );

    const result = adult.demoteFromOwnership(now);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe('OwnerRequired');
  });
});

describe('FamilyMember.remove', () => {
  it('leaves a tombstone with no personal data on it (Principle XI)', () => {
    const member = unwrap(
      FamilyMember.createUnlinked({
        id,
        familyId,
        kind: 'child',
        displayName: 'Bo',
        dateOfBirth: new Date('2019-04-02'),
        now,
      }),
    );

    member.remove(now);

    // The row survives so that authorship references held by contexts that do
    // not exist yet have something to point at; the person does not.
    expect(member.isActive).toBe(false);
    expect(member.removedAt).toEqual(now);
    expect(member.displayName).toBeNull();
    expect(member.dateOfBirth).toBeNull();
    expect(member.userId).toBeNull();
  });
});
