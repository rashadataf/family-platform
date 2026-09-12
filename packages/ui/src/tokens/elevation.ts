/**
 * Elevation levels (artboard 03).
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
 * Four levels, and a fifth would be a hierarchy problem rather than a missing
 * token. Values are CSS shadow strings; ADR-016 notes elevation as the one
 * token that does not map one-to-one across platforms, so the React Native
 * adapter reads these rather than consuming them directly.
 */
export const elevation = {
  '0': 'none',
  '1': '0 1px 2px rgba(31,27,22,0.06)',
  '2': '0 2px 8px rgba(31,27,22,0.08)',
  '3': '0 8px 24px rgba(31,27,22,0.12)',
} as const;

export type ElevationToken = keyof typeof elevation;
