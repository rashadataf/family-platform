/**
 * Pure theme-preference logic, split from `theme-provider.tsx` and
 * `theme-storage.ts` per R13: both of those hold a real `react-native` (or
 * `@react-native-async-storage/async-storage`, which itself requires
 * `react-native`) import, which makes them unreachable from a `.spec.ts`
 * file. Everything a test needs to exercise — how a preference and the OS
 * scheme resolve to a theme, and how a raw stored value is interpreted —
 * lives here instead, with no such import.
 */
import type { ThemeName } from '../tokens/index.js';

export type ThemePreference = ThemeName | 'system';

/** FR-004: `system` follows the OS scheme; an explicit override always wins. */
export function resolveThemePreference(
  preference: ThemePreference,
  systemScheme: ThemeName,
): ThemeName {
  return preference === 'system' ? systemScheme : preference;
}

/** FR-005: anything not a recognised preference — including no stored value at all — falls back to `system`. */
export function parseStoredThemePreference(raw: string | null): ThemePreference {
  if (raw === 'light' || raw === 'dark' || raw === 'system') {
    return raw;
  }
  return 'system';
}
