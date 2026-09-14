import { asFamilyId, isErr, isOk, unwrap } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { Family } from './family.aggregate.js';
import { HouseholdProfile } from './household-profile.vo.js';

const id = asFamilyId('11111111-1111-7111-8111-111111111111');
const now = new Date('2026-09-13T10:00:00Z');

describe('Family.create', () => {
  it('creates a family with a trimmed name and an empty profile by default', () => {
    const result = Family.create({ id, name: '  Lovelace  ', now });

    expect(isOk(result)).toBe(true);
    const family = unwrap(result);
    expect(family.name).toBe('Lovelace');
    expect(family.profile.postcode).toBeNull();
    expect(family.deletionRequestedAt).toBeNull();
  });

  it.each([
    ['', 'empty'],
    ['   ', 'only whitespace'],
  ])('refuses a name that is %s (%s) with an actionable reason', (name) => {
    const result = Family.create({ id, name, now });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe('NameRequired');
      // US1 Scenario 3 asks for "a specific, actionable reason" — a message
      // that says what to do, not one that restates the field name.
      expect(result.error).toHaveProperty('reason');
    }
  });

  it('refuses a name longer than the documented maximum, and says how long it was', () => {
    const result = Family.create({ id, name: 'x'.repeat(121), now });

    expect(isErr(result)).toBe(true);
    if (isErr(result) && result.error.kind === 'NameRequired') {
      expect(result.error.reason).toContain('121');
    }
  });

  it('holds no reference to an owner', () => {
    // SC-007 is guaranteed by the `family_one_owner` partial unique index over
    // the member set. An `ownerMemberId` here would be a second source of
    // truth for the same fact, and the two would eventually disagree.
    const family = unwrap(Family.create({ id, name: 'Lovelace', now }));

    expect(Object.keys(family)).not.toContain('ownerMemberId');
    expect(family).not.toHaveProperty('ownerMemberId');
  });
});

describe('Family profile and rename', () => {
  it('stores a profile independently of any member record (FR-002)', () => {
    const family = unwrap(Family.create({ id, name: 'Lovelace', now }));

    family.updateProfile(
      HouseholdProfile.from({
        postcode: 'sw1a  1aa',
        localAuthorityCode: 'e09000033',
        composition: { adults: 2, children: 1 },
      }),
      now,
    );

    expect(family.profile.postcode).toBe('SW1A 1AA');
    expect(family.profile.localAuthorityCode).toBe('E09000033');
    expect(family.profile.composition).toEqual({ adults: 2, children: 1 });
  });

  it('applies the same name rule on rename as on create', () => {
    const family = unwrap(Family.create({ id, name: 'Lovelace', now }));

    expect(isErr(family.rename('  ', now))).toBe(true);
    expect(family.name).toBe('Lovelace');

    expect(isOk(family.rename('  Byron  ', now))).toBe(true);
    expect(family.name).toBe('Byron');
  });
});

describe('Family#requestDeletion (FR-023, FR-025)', () => {
  it('sets deletionRequestedAt', () => {
    const family = unwrap(Family.create({ id, name: 'Lovelace', now }));

    family.requestDeletion(now);

    expect(family.deletionRequestedAt).toEqual(now);
  });

  it('is idempotent — a second request does not move the clock', () => {
    const family = unwrap(Family.create({ id, name: 'Lovelace', now }));
    family.requestDeletion(now);

    const later = new Date(now.getTime() + 60_000);
    family.requestDeletion(later);

    expect(family.deletionRequestedAt).toEqual(now);
  });
});

describe('HouseholdProfile', () => {
  it('normalises a postcode without validating that it exists', () => {
    // Validation against real reference data belongs to Reference and Locale.
    // A half-right regex here would reject valid overseas-territory and BFPO
    // codes that a UK-first product should still be able to store.
    expect(HouseholdProfile.from({ postcode: ' bfpo 801 ' }).postcode).toBe('BFPO 801');
    expect(HouseholdProfile.from({ postcode: 'not a postcode' }).postcode).toBe('NOT A POSTCODE');
  });

  it('treats blank input as absent rather than as an empty string', () => {
    const profile = HouseholdProfile.from({ postcode: '   ', localAuthorityCode: '' });

    expect(profile.postcode).toBeNull();
    expect(profile.localAuthorityCode).toBeNull();
  });
});
