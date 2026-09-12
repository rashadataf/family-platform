/**
 * Breakpoints and the layout grid (artboard 04).
 *
 * Spec 007 FR-006: this directory imports NOTHING — not React, not React
 * Native, not @fp/kernel. A future web client consumes these exact values, and
 * `token-layer-imports-nothing` in .dependency-cruiser.cjs makes that
 * structural rather than aspirational.
 *
 * The normative source is the design canvas: `design/tokens.json` beside the
 * artboards. `pnpm verify:design-tokens` fails when this file and that one
 * disagree, so a value is changed on the canvas first and here second.
 */

/**
 * The only thing that changes between a phone and a desktop. Colour, type,
 * radius and elevation are identical everywhere — that identity is what lets
 * one component set serve both.
 */
export interface Breakpoint {
  /** Inclusive lower bound and inclusive upper bound; `null` means unbounded. */
  readonly range: readonly [number, number | null];
  readonly columns: number;
  readonly margin: number;
  readonly gutter: number;
  /** 48 where a thumb is the input, 40 where a cursor is. */
  readonly controlHeight: number;
}

export type BreakpointKey = 'sm' | 'md' | 'lg' | 'xl';

export const layout = {
  sm: { range: [0, 599], columns: 4, margin: 24, gutter: 16, controlHeight: 48 },
  md: { range: [600, 1023], columns: 8, margin: 32, gutter: 24, controlHeight: 48 },
  lg: { range: [1024, 1439], columns: 12, margin: 32, gutter: 24, controlHeight: 40 },
  xl: { range: [1440, null], columns: 12, margin: 120, gutter: 24, controlHeight: 40 },
} as const satisfies Record<BreakpointKey, Breakpoint>;
