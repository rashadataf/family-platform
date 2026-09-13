/**
 * `resolveColours` is deliberately not re-exported here. The public contract
 * (contracts/package-api.md) names exactly `ThemeProvider` and `useTheme` —
 * a consumer resolving colours itself is the "resolution happens once, at
 * the root" rule (FR-003) bypassed by an escape hatch, not honoured by one.
 *
 * `useThemePreference` is the one sanctioned exception to "never expose the
 * theme's name" (T035): it exists solely for the system/light/dark override
 * control, a different concern from a component branching on the theme to
 * pick its own style. See `theme-preference-context.ts`.
 */
export { ThemeProvider, type ThemeProviderProps } from './theme-provider.js';
export { useTheme } from './use-theme.js';
export type { ThemeValue } from './theme-context.js';
export { useThemePreference } from './use-theme-preference.js';
export type { ThemePreferenceValue } from './theme-preference-context.js';
export type { ThemePreference } from './resolve-theme-preference.js';
