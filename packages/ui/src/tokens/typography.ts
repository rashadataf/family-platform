/**
 * The type scale (artboard 02).
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
 * Two faces plus the system monospace. Newsreader ('serif') sets dates and
 * screen titles and is never used below 20px; Instrument Sans ('sans') does
 * everything else; 'mono' is reserved for machine identifiers.
 */
export type TypeFamily = 'sans' | 'serif' | 'mono';

/**
 * Closed rather than `number`: every step below uses one of these four, and
 * a fifth would need a decision (a new weight in the type family, not a typo)
 * — the same reasoning FR-009 applies to space and radius, applied here too.
 */
export type FontWeight = 400 | 500 | 600 | 700;

export interface TypeStep {
  readonly family: TypeFamily;
  /** Points on both platforms. Never a unitless multiplier — it resolves differently. */
  readonly size: number;
  readonly lineHeight: number;
  readonly weight: FontWeight;
  readonly tracking: string;
}

export type TypeToken =
  | 'display.lg'
  | 'display.sm'
  | 'title.lg'
  | 'title.sm'
  | 'body.lg'
  | 'body.md'
  | 'body.sm'
  | 'label.lg'
  | 'label.sm'
  | 'caption'
  | 'overline'
  | 'numeric'
  | 'mono';

export const typography = {
  'display.lg': { family: 'serif', size: 34, lineHeight: 38, weight: 400, tracking: '-0.01em' },
  'display.sm': { family: 'serif', size: 25, lineHeight: 30, weight: 400, tracking: '0' },
  'title.lg': { family: 'sans', size: 20, lineHeight: 26, weight: 600, tracking: '-0.005em' },
  'title.sm': { family: 'sans', size: 17, lineHeight: 23, weight: 600, tracking: '0' },
  'body.lg': { family: 'sans', size: 16, lineHeight: 24, weight: 400, tracking: '0' },
  'body.md': { family: 'sans', size: 15, lineHeight: 22, weight: 400, tracking: '0' },
  'body.sm': { family: 'sans', size: 13, lineHeight: 19, weight: 400, tracking: '0' },
  'label.lg': { family: 'sans', size: 15, lineHeight: 20, weight: 600, tracking: '0.005em' },
  'label.sm': { family: 'sans', size: 13, lineHeight: 16, weight: 600, tracking: '0.005em' },
  caption: { family: 'sans', size: 12, lineHeight: 16, weight: 500, tracking: '0.01em' },
  overline: { family: 'sans', size: 11, lineHeight: 14, weight: 700, tracking: '0.08em' },
  numeric: { family: 'sans', size: 15, lineHeight: 22, weight: 500, tracking: '0' },
  mono: { family: 'mono', size: 11, lineHeight: 16, weight: 400, tracking: '0' },
} as const satisfies Record<TypeToken, TypeStep>;
