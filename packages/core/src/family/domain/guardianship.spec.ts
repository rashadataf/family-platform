import { asFamilyId, asFamilyMemberId, asGuardianshipId, isErr, isOk, unwrap } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { assertGuardianCoverage, Guardianship } from './guardianship.js';

const id = asGuardianshipId('11111111-1111-7111-8111-111111111111');
const familyId = asFamilyId('22222222-2222-7222-8222-222222222222');
const guardianMemberId = asFamilyMemberId('33333333-3333-7333-8333-333333333333');
const childMemberId = asFamilyMemberId('44444444-4444-7444-8444-444444444444');
const now = new Date('2026-09-13T10:00:00Z');

function establish(overrides: {
  guardianKind?: 'adult' | 'child';
  guardianRole?: 'owner' | 'adult' | 'extended' | 'viewer';
  childKind?: 'adult' | 'child';
}) {
  return Guardianship.establish({
    id,
    familyId,
    guardianMemberId,
    guardianKind: overrides.guardianKind ?? 'adult',
    guardianRole: overrides.guardianRole ?? 'owner',
    childMemberId,
    childKind: overrides.childKind ?? 'child',
    now,
  });
}

describe('Guardianship.establish — eligibility (FR-006)', () => {
  it.each([
    ['owner', true],
    ['adult', true],
    ['extended', false],
    ['viewer', false],
  ] as const)('an adult member with role %s is eligible: %s', (role, eligible) => {
    const result = establish({ guardianRole: role });
    expect(isOk(result)).toBe(eligible);
    if (!eligible && isErr(result)) {
      expect(result.error.kind).toBe('GuardianIneligible');
    }
  });

  it('refuses a guardian who is themself a child, regardless of role', () => {
    const result = establish({ guardianKind: 'child', guardianRole: 'owner' });
    expect(isErr(result)).toBe(true);
  });

  it('refuses a subject who is not marked as a child', () => {
    const result = establish({ childKind: 'adult' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe('GuardianIneligible');
    }
  });

  it('establishes an active relationship with no end date', () => {
    const guardianship = unwrap(establish({}));
    expect(guardianship.isActive).toBe(true);
    expect(guardianship.endedAt).toBeNull();
    expect(guardianship.guardianMemberId).toBe(guardianMemberId);
    expect(guardianship.childMemberId).toBe(childMemberId);
  });
});

describe('Guardianship#end', () => {
  it('ends an active relationship', () => {
    const guardianship = unwrap(establish({}));
    guardianship.end(now);
    expect(guardianship.isActive).toBe(false);
    expect(guardianship.endedAt).toBe(now);
  });
});

describe('assertGuardianCoverage (FR-008)', () => {
  it.each([
    [0, false],
    [1, true],
    [2, true],
  ])('a post-action count of %i is allowed: %s', (count, allowed) => {
    const result = assertGuardianCoverage(count);
    expect(isOk(result)).toBe(allowed);
    if (!allowed && isErr(result)) {
      expect(result.error.kind).toBe('LastGuardian');
    }
  });
});
