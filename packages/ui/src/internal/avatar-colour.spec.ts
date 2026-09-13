import { describe, expect, it } from 'vitest';
import { avatarColourRole } from './avatar-colour.js';

describe('avatarColourRole', () => {
  it('is deterministic — the same id always resolves the same role', () => {
    const first = avatarColourRole('member-rashad-01');
    const second = avatarColourRole('member-rashad-01');
    expect(first).toBe(second);
  });

  it('spreads across the palette rather than collapsing to one role', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const roles = new Set(ids.map((id) => avatarColourRole(id)));
    expect(roles.size).toBeGreaterThan(1);
  });

  it('is a valid colour role for every id it is given', () => {
    const valid = new Set([
      'action.primary',
      'status.positive.fg',
      'status.info.fg',
      'status.caution.fg',
      'status.proposed.fg',
    ]);
    for (const id of ['x', 'yy', 'zzz', '', '1234567890']) {
      expect(valid.has(avatarColourRole(id))).toBe(true);
    }
  });
});
