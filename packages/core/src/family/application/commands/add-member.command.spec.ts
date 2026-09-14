import { asFamilyId, asFamilyMemberId, asGuardianshipId, asUserId } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { FamilyMember } from '../../domain/family-member.aggregate.js';
import { emptyFamilyState, fakeFamilyUnitOfWork } from '../family-unit-of-work.fake.js';
import { addMember } from './add-member.command.js';

const familyId = asFamilyId('11111111-1111-7111-8111-111111111111');
const ownerMemberId = asFamilyMemberId('22222222-2222-7222-8222-222222222222');
const viewerMemberId = asFamilyMemberId('55555555-5555-7555-8555-555555555555');
const newMemberId = asFamilyMemberId('33333333-3333-7333-8333-333333333333');
const guardianshipId = asGuardianshipId('44444444-4444-7444-8444-444444444444');
const clock = { now: () => new Date('2026-09-13T10:00:00Z') };

function owner(): FamilyMember {
  return FamilyMember.reconstitute({
    id: ownerMemberId,
    familyId,
    kind: 'adult',
    role: 'owner',
    userId: asUserId('66666666-6666-7666-8666-666666666666'),
    displayName: 'Ada',
    dateOfBirth: null,
    createdAt: clock.now(),
    updatedAt: clock.now(),
    removedAt: null,
  });
}

function viewer(): FamilyMember {
  return FamilyMember.reconstitute({
    id: viewerMemberId,
    familyId,
    kind: 'adult',
    role: 'viewer',
    userId: asUserId('77777777-7777-7777-8777-777777777777'),
    displayName: 'Guest',
    dateOfBirth: null,
    createdAt: clock.now(),
    updatedAt: clock.now(),
    removedAt: null,
  });
}

describe('addMember — child path (FR-003, FR-005)', () => {
  it('creates the child with no userId and establishes the adder as guardian in the same transaction', async () => {
    const state = emptyFamilyState({ members: [owner()] });

    const result = await addMember(
      {
        familyId,
        memberId: newMemberId,
        addedByMemberId: ownerMemberId,
        kind: 'child',
        displayName: 'Bo',
        dateOfBirth: new Date('2019-04-02'),
        guardianshipId,
        correlationId: 'correlation-1',
      },
      { unitOfWork: fakeFamilyUnitOfWork(state), clock },
    );

    expect(result.ok).toBe(true);
    expect(state.savedMembers).toHaveLength(1);
    expect(state.savedMembers[0]?.userId).toBeNull();
    expect(state.savedMembers[0]?.kind).toBe('child');
    expect(state.savedGuardianships).toHaveLength(1);
    expect(state.savedGuardianships[0]?.guardianMemberId).toBe(ownerMemberId);
    expect(state.savedGuardianships[0]?.childMemberId).toBe(newMemberId);

    const eventTypes = state.events.map((event) => event.eventType);
    expect(eventTypes).toContain('family.MemberAdded.v1');
    expect(eventTypes).toContain('family.GuardianshipEstablished.v1');
  });

  it('refuses when the adder is not an eligible guardian, writing nothing (FR-006)', async () => {
    const state = emptyFamilyState({ members: [viewer()] });

    const result = await addMember(
      {
        familyId,
        memberId: newMemberId,
        addedByMemberId: viewerMemberId,
        kind: 'child',
        displayName: 'Bo',
        guardianshipId,
        correlationId: 'correlation-1',
      },
      { unitOfWork: fakeFamilyUnitOfWork(state), clock },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('GuardianIneligible');
    expect(state.savedMembers).toHaveLength(0);
    expect(state.savedGuardianships).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });
});

describe('addMember — extended path (FR-014)', () => {
  it('creates an unlinked adult with role extended and establishes no guardianship', async () => {
    const state = emptyFamilyState({ members: [owner()] });

    const result = await addMember(
      {
        familyId,
        memberId: newMemberId,
        addedByMemberId: ownerMemberId,
        kind: 'adult',
        displayName: 'Grandma',
        guardianshipId,
        correlationId: 'correlation-1',
      },
      { unitOfWork: fakeFamilyUnitOfWork(state), clock },
    );

    expect(result.ok).toBe(true);
    expect(state.savedMembers[0]?.role).toBe('extended');
    expect(state.savedGuardianships).toHaveLength(0);
    expect(state.events.map((e) => e.eventType)).toEqual(['family.MemberAdded.v1']);
  });
});
