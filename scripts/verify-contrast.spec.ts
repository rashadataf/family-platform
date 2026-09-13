import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex, relativeLuminance } from './lib/contrast.js';
import { checkContrast } from './verify-contrast.js';
import { loadDesignTokens, type DesignTokens } from './lib/design-tokens.js';

describe('contrast maths', () => {
  it('matches the WCAG reference extremes', () => {
    // Black on white is the definitional maximum; identical colours are 1:1.
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#1F1B16', '#FAF7F2')).toBeCloseTo(
      contrastRatio('#FAF7F2', '#1F1B16'),
      10,
    );
  });

  it('matches a known published value', () => {
    // #767676 on white is the canonical 4.54:1 example used to illustrate the
    // AA threshold for body text.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });

  it('puts luminance at the right ends of the scale', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
  });

  it('rejects a colour it cannot measure rather than guessing', () => {
    expect(() => parseHex('rgba(31,27,22,0.48)')).toThrow(/six-digit hex/);
    expect(() => parseHex('#FFF')).toThrow(/six-digit hex/);
  });
});

describe('the shipped palette', () => {
  it('clears every documented floor in both themes', () => {
    const report = checkContrast(loadDesignTokens());
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    // Both themes for every opaque pairing — a drop here means pairings were
    // removed from the table rather than fixed.
    expect(report.checked).toBeGreaterThanOrEqual(30);
  });

  it('fails loudly when a pairing drops below its floor', () => {
    const tokens = loadDesignTokens();
    const broken: DesignTokens = {
      ...tokens,
      colour: { ...tokens.colour, 'text.primary': { light: '#CCCCCC', dark: '#CCCCCC' } },
    };
    const report = checkContrast(broken);
    expect(report.ok).toBe(false);
    expect(report.message).toContain('text.primary');
    expect(report.message).toContain('Fix the value');
  });

  it('refuses a pairing that names a role which does not exist', () => {
    const tokens = loadDesignTokens();
    const dangling: DesignTokens = {
      ...tokens,
      contrastPairs: [{ foreground: 'text.ghost', background: 'surface.canvas', floor: 4.5 }],
    };
    expect(() => checkContrast(dangling)).toThrow(/does not exist/);
  });
});
