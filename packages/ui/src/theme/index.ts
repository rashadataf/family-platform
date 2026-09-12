/**
 * `resolveColours` is deliberately not re-exported here. The public contract
 * (contracts/package-api.md) names exactly `ThemeProvider` and `useTheme` —
 * a consumer resolving colours itself is the "resolution happens once, at
 * the root" rule (FR-003) bypassed by an escape hatch, not honoured by one.
 */
export { ThemeProvider, type ThemeProviderProps } from './theme-provider.js';
export { useTheme } from './use-theme.js';
export type { ThemeValue } from './theme-context.js';
