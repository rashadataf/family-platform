/**
 * Colour roles, resolved per theme (artboard 01).
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

export type ThemeName = 'light' | 'dark';

/**
 * Every role carries both themes. FR-002 is enforced by the type below rather
 * than by review: a role declared with only one resolution does not compile.
 */
export interface ThemedColour {
  readonly light: string;
  readonly dark: string;
}

export type ColourRole =
  | 'surface.canvas'
  | 'surface.raised'
  | 'surface.sunken'
  | 'surface.inverse'
  | 'surface.scrim'
  | 'text.primary'
  | 'text.secondary'
  | 'text.tertiary'
  | 'text.inverse'
  | 'text.onAction'
  | 'text.link'
  | 'border.subtle'
  | 'border.strong'
  | 'border.focus'
  | 'action.primary'
  | 'action.primaryPressed'
  | 'action.quiet'
  | 'action.disabledBg'
  | 'action.disabledFg'
  | 'action.destructive'
  | 'action.destructivePressed'
  | 'sensitive.fg'
  | 'sensitive.bg'
  | 'sensitive.border'
  | 'status.positive.fg'
  | 'status.positive.bg'
  | 'status.positive.border'
  | 'status.caution.fg'
  | 'status.caution.bg'
  | 'status.caution.border'
  | 'status.critical.fg'
  | 'status.critical.bg'
  | 'status.critical.border'
  | 'status.info.fg'
  | 'status.info.bg'
  | 'status.info.border'
  | 'status.proposed.fg'
  | 'status.proposed.bg'
  | 'status.proposed.border';

export const colour = {
  'surface.canvas': { light: '#FAF7F2', dark: '#17150F' },
  'surface.raised': { light: '#FFFFFF', dark: '#221F18' },
  'surface.sunken': { light: '#F2EDE5', dark: '#100E0A' },
  'surface.inverse': { light: '#1F1B16', dark: '#F2EDE4' },
  'surface.scrim': { light: 'rgba(31,27,22,0.48)', dark: 'rgba(6,5,3,0.64)' },
  'text.primary': { light: '#1F1B16', dark: '#F2EDE4' },
  'text.secondary': { light: '#5C544A', dark: '#B5AC9E' },
  'text.tertiary': { light: '#786F64', dark: '#908779' },
  'text.inverse': { light: '#FAF7F2', dark: '#17150F' },
  'text.onAction': { light: '#FFFFFF', dark: '#17150F' },
  'text.link': { light: '#8A4A2C', dark: '#E0A077' },
  'border.subtle': { light: '#E7E0D5', dark: '#332E25' },
  'border.strong': { light: '#D2C8B8', dark: '#4A4236' },
  'border.focus': { light: '#B15E39', dark: '#D98A5F' },
  'action.primary': { light: '#B15E39', dark: '#D98A5F' },
  'action.primaryPressed': { light: '#94492A', dark: '#C0764C' },
  'action.quiet': { light: '#F2EDE5', dark: '#2A251D' },
  'action.disabledBg': { light: '#EDE7DD', dark: '#2A251D' },
  'action.disabledFg': { light: '#8D8170', dark: '#797060' },
  'action.destructive': { light: '#8A352C', dark: '#E0897B' },
  'action.destructivePressed': { light: '#70291F', dark: '#C9705F' },
  'sensitive.fg': { light: '#6E4B2E', dark: '#D0A87C' },
  'sensitive.bg': { light: '#F6EFE8', dark: '#241D16' },
  'sensitive.border': { light: '#DCC6AE', dark: '#4A3A2A' },
  'status.positive.fg': { light: '#3C5A41', dark: '#8FB093' },
  'status.positive.bg': { light: '#E8F0E6', dark: '#1E2A20' },
  'status.positive.border': { light: '#C6D9C4', dark: '#35472F' },
  'status.caution.fg': { light: '#7A5310', dark: '#D4A33F' },
  'status.caution.bg': { light: '#FBF1DC', dark: '#2E2513' },
  'status.caution.border': { light: '#E8D3A2', dark: '#4A3C1B' },
  'status.critical.fg': { light: '#8A352C', dark: '#E0897B' },
  'status.critical.bg': { light: '#FBE9E6', dark: '#301A17' },
  'status.critical.border': { light: '#EFC7BF', dark: '#4D2721' },
  'status.info.fg': { light: '#3E5372', dark: '#93A9C7' },
  'status.info.bg': { light: '#E9EEF6', dark: '#1A2130' },
  'status.info.border': { light: '#C4D2E4', dark: '#2E3A4D' },
  'status.proposed.fg': { light: '#5A4372', dark: '#AD93C7' },
  'status.proposed.bg': { light: '#F0EAF6', dark: '#241C30' },
  'status.proposed.border': { light: '#D6C7E4', dark: '#3D3150' },
} as const satisfies Record<ColourRole, ThemedColour>;
