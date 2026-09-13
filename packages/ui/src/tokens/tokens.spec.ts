import { describe, expect, it } from 'vitest';
import { colour, elevation, layout, radius, space, typography } from './index.js';
import type { ThemedColour } from './index.js';

/**
 * Widened by assignment, not by an assertion. `colour` is `as const`, so its
 * values are literal types and the compiler can already prove things like
 * "light and dark differ" — which makes the direct comparison a type error
 * rather than a test. Reading it through the declared shape keeps the runtime
 * assertions meaningful if those literal types are ever relaxed.
 */
const roles: Record<string, ThemedColour> = colour;

/**
 * The token layer's own invariants — the ones a type cannot express and the
 * drift check against `design/tokens.json` does not cover.
 *
 * `scripts/verify-design-tokens.ts` asserts these values match the canvas.
 * These assert the set is internally coherent, so that a canvas edit which is
 * faithfully mirrored here still cannot produce a nonsensical token set.
 */

describe('colour', () => {
  it('gives every role both themes', () => {
    // FR-002. The `satisfies` clause makes this a compile error too; the test
    // exists because a compile error is invisible in a review diff.
    for (const [role, value] of Object.entries(roles)) {
      expect(value.light, `${role}.light`).toBeTruthy();
      expect(value.dark, `${role}.dark`).toBeTruthy();
    }
  });

  it('uses uppercase six-digit hex, or an explicit translucent value', () => {
    for (const [role, value] of Object.entries(roles)) {
      for (const resolved of [value.light, value.dark]) {
        const ok = /^#[0-9A-F]{6}$/.test(resolved) || resolved.startsWith('rgba(');
        expect(ok, `${role}: ${resolved}`).toBe(true);
      }
    }
  });

  it('never resolves a role to the same value in both themes', () => {
    // A role identical in light and dark is a role that did not need to be
    // themed — either it is a mistake, or it belongs in a different category.
    const identical = Object.entries(roles).filter(([, v]) => v.light === v.dark);
    expect(identical).toEqual([]);
  });
});

describe('scales', () => {
  it('keeps spacing on a 4px grid, ascending, starting at zero', () => {
    expect(space[0]).toBe(0);
    expect([...space]).toEqual([...space].sort((a, b) => a - b));
    for (const n of space) expect(n % 4, `space ${String(n)}`).toBe(0);
  });

  it('has no duplicate steps', () => {
    expect(new Set(space).size).toBe(space.length);
  });

  it('orders radius from tightest to fully round', () => {
    const values = Object.values(radius);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(radius.full).toBeGreaterThan(radius.xl);
  });

  it('gives every elevation level a shadow, with level 0 flat', () => {
    expect(elevation['0']).toBe('none');
    for (const [level, shadow] of Object.entries(elevation)) {
      if (level !== '0') expect(shadow, `elevation ${level}`).toContain('rgba');
    }
  });
});

describe('typography', () => {
  it('never sets a line height below its font size', () => {
    for (const [name, step] of Object.entries(typography)) {
      expect(step.lineHeight, name).toBeGreaterThanOrEqual(step.size);
    }
  });

  it('keeps the serif face out of small sizes', () => {
    // Artboard 02: Newsreader is never used below 20px, because a serif at
    // 13px on a phone is unreadable in daylight.
    for (const [name, step] of Object.entries(typography)) {
      if (step.family === 'serif') expect(step.size, name).toBeGreaterThanOrEqual(20);
    }
  });

  it('puts nothing below the 11px floor', () => {
    for (const [name, step] of Object.entries(typography)) {
      expect(step.size, name).toBeGreaterThanOrEqual(11);
    }
  });
});

describe('layout', () => {
  it('covers the width axis with no gap and no overlap', () => {
    const ordered = Object.values(layout).sort((a, b) => a.range[0] - b.range[0]);
    expect(ordered[0]?.range[0]).toBe(0);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const upper = ordered[i]?.range[1];
      const nextLower = ordered[i + 1]?.range[0];
      expect(upper, `breakpoint ${String(i)} upper bound`).not.toBeNull();
      expect(nextLower).toBe((upper ?? 0) + 1);
    }
    expect(ordered[ordered.length - 1]?.range[1]).toBeNull();
  });

  it('drops the control height only where the input is a cursor', () => {
    // Artboard 04: 48 for a thumb, 40 for a pointer. Never anything else.
    for (const [key, bp] of Object.entries(layout)) {
      expect([40, 48], `${key} controlHeight`).toContain(bp.controlHeight);
    }
    expect(layout.sm.controlHeight).toBe(48);
    expect(layout.xl.controlHeight).toBe(40);
  });

  it('never narrows the column count as the viewport grows', () => {
    const ordered = Object.values(layout).sort((a, b) => a.range[0] - b.range[0]);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      expect(ordered[i + 1]?.columns).toBeGreaterThanOrEqual(ordered[i]?.columns ?? 0);
    }
  });
});
