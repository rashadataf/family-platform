import { describe, expect, it } from 'vitest';
import { fontWeightToString } from './font-weight.js';

describe('fontWeightToString', () => {
  it('maps every weight typography actually uses', () => {
    expect(fontWeightToString(400)).toBe('400');
    expect(fontWeightToString(500)).toBe('500');
    expect(fontWeightToString(600)).toBe('600');
    expect(fontWeightToString(700)).toBe('700');
  });
});
