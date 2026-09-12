import { describe, expect, it } from 'vitest';
import { trackingToLetterSpacing } from './tracking.js';

describe('trackingToLetterSpacing', () => {
  it('converts a positive em value relative to the given size', () => {
    expect(trackingToLetterSpacing('0.005em', 15)).toBeCloseTo(0.075, 5);
  });

  it('converts a negative em value', () => {
    expect(trackingToLetterSpacing('-0.01em', 34)).toBeCloseTo(-0.34, 5);
  });

  it('treats the literal "0" (no unit) as zero', () => {
    expect(trackingToLetterSpacing('0', 15)).toBe(0);
  });

  it('scales with size — the same em value is a different px at a different size', () => {
    expect(trackingToLetterSpacing('0.08em', 11)).toBeCloseTo(0.88, 5);
    expect(trackingToLetterSpacing('0.08em', 22)).toBeCloseTo(1.76, 5);
  });
});
