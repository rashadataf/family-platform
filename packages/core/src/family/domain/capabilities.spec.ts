import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  MEMBER_ROLES,
  capabilitiesFor,
  isEligibleGuardian,
  roleHasCapability,
  type Capability,
  type MemberRole,
} from './capabilities.js';

/**
 * The table in specs/008-family-membership/data-model.md, transcribed. It is
 * asserted cell by cell rather than spot-checked because this map *is* the
 * authorization model: a wrong cell here is a silent privilege change
 * everywhere in the platform, and no other test would catch it.
 */
const EXPECTED: Record<MemberRole, Record<Capability, boolean>> = {
  owner: {
    'family:read': true,
    'family:manage': true,
    'family:delete': true,
    'members:read': true,
    'members:add': true,
    'members:manage': true,
    'guardianship:manage': true,
    'billing:manage': true,
    'documents:read': true,
    'documents:write': true,
    'documents:write:sensitive': true,
    'calendar:read': true,
    'calendar:write': true,
    'tasks:read': true,
    'tasks:write': true,
  },
  adult: {
    'family:read': true,
    'family:manage': true,
    'family:delete': false,
    'members:read': true,
    'members:add': true,
    'members:manage': false,
    'guardianship:manage': false,
    'billing:manage': false,
    'documents:read': true,
    'documents:write': true,
    'documents:write:sensitive': true,
    'calendar:read': true,
    'calendar:write': true,
    'tasks:read': true,
    'tasks:write': true,
  },
  extended: {
    'family:read': true,
    'family:manage': false,
    'family:delete': false,
    'members:read': true,
    'members:add': false,
    'members:manage': false,
    'guardianship:manage': false,
    'billing:manage': false,
    'documents:read': true,
    'documents:write': true,
    'documents:write:sensitive': false,
    'calendar:read': true,
    'calendar:write': true,
    'tasks:read': true,
    'tasks:write': true,
  },
  viewer: {
    'family:read': true,
    'family:manage': false,
    'family:delete': false,
    'members:read': true,
    'members:add': false,
    'members:manage': false,
    'guardianship:manage': false,
    'billing:manage': false,
    'documents:read': true,
    'documents:write': false,
    'documents:write:sensitive': false,
    'calendar:read': true,
    'calendar:write': false,
    'tasks:read': true,
    'tasks:write': false,
  },
};

describe('capabilitiesFor', () => {
  it.each(MEMBER_ROLES)('matches data-model.md for %s, cell by cell', (role) => {
    for (const capability of CAPABILITIES) {
      expect(roleHasCapability(role, capability), `${role} × ${capability}`).toBe(
        EXPECTED[role][capability],
      );
    }
  });

  it('returns every capability the table marks, and no others', () => {
    for (const role of MEMBER_ROLES) {
      const expected = CAPABILITIES.filter((c) => EXPECTED[role][c]);
      expect([...capabilitiesFor(role)].sort()).toEqual([...expected].sort());
    }
  });

  it('grants exactly one role the capabilities that can end a family or spend money', () => {
    // FR-018 and the clarification behind it: ownership is not held jointly.
    for (const capability of ['family:delete', 'billing:manage', 'members:manage'] as const) {
      const holders = MEMBER_ROLES.filter((r) => roleHasCapability(r, capability));
      expect(holders).toEqual(['owner']);
    }
  });

  it('gives viewer no write capability at all', () => {
    const writes = capabilitiesFor('viewer').filter((c) => c.includes(':write'));
    expect(writes).toEqual([]);
  });

  it('withholds documents:write:sensitive from extended members', () => {
    // The boundary an extended family member does not cross (data-model.md).
    expect(roleHasCapability('extended', 'documents:write')).toBe(true);
    expect(roleHasCapability('extended', 'documents:write:sensitive')).toBe(false);
  });

  it('never mutates the returned array between calls', () => {
    const first = capabilitiesFor('owner');
    const second = capabilitiesFor('owner');
    expect(second).toEqual(first);
  });
});

describe('isEligibleGuardian', () => {
  // FR-006, from spec.md's resolved clarification: owner and adult only.
  it.each([
    ['adult' as const, 'owner' as const, true],
    ['adult' as const, 'adult' as const, true],
    ['adult' as const, 'extended' as const, false],
    ['adult' as const, 'viewer' as const, false],
  ])('kind=%s role=%s → %s', (kind, role, expected) => {
    expect(isEligibleGuardian(kind, role)).toBe(expected);
  });

  it('refuses a child as a guardian whatever role the record carries', () => {
    // A child's role is fixed to `viewer` by a check constraint, but the rule
    // must not depend on that holding — the kind is the discriminator.
    for (const role of MEMBER_ROLES) {
      expect(isEligibleGuardian('child', role)).toBe(false);
    }
  });

  it('is not the same question as who may grant guardianship', () => {
    // `guardianship:manage` is owner-only; eligibility is owner *and* adult.
    // If these ever coincide, one of them has been changed by accident.
    expect(isEligibleGuardian('adult', 'adult')).toBe(true);
    expect(roleHasCapability('adult', 'guardianship:manage')).toBe(false);
  });
});
