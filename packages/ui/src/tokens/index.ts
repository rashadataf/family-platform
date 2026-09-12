/**
 * The token layer's public surface.
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

export { colour, type ColourRole, type ThemedColour, type ThemeName } from './colour.js';
export {
  typography,
  type TypeFamily,
  type FontWeight,
  type TypeStep,
  type TypeToken,
} from './typography.js';
export { space, type Space } from './space.js';
export { radius, type Radius, type RadiusToken } from './radius.js';
export { elevation, type ElevationToken } from './elevation.js';
export { layout, type Breakpoint, type BreakpointKey } from './layout.js';
