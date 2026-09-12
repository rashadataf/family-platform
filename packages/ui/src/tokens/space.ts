/**
 * The spacing scale (artboard 03).
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
 * One 4px base unit, eleven steps, nothing between them. FR-009: `Space` is a
 * union of exactly these members, so a 13 is a compile error at the point of
 * use rather than something a lint rule has to notice.
 */
export const space = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;

export type Space = (typeof space)[number];
