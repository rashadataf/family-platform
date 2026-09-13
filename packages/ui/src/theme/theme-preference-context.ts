import { createContext } from 'react';
import type { ThemePreference } from './resolve-theme-preference.js';

/**
 * Deliberately a separate context from `ThemeContext`. `useTheme` must
 * never expose the active theme's name (FR-003, contracts/package-api.md
 * rule 3) — but an override control has no other way to read or change
 * what a person picked, which is a different concern from a component
 * reading the theme to choose its own style. Two contexts keep both true
 * at once: ordinary components see only `{ colours }`; the one screen that
 * legitimately needs the preference reaches it through this instead.
 */
export interface ThemePreferenceValue {
  readonly preference: ThemePreference;
  readonly setPreference: (preference: ThemePreference) => void;
}

export const ThemePreferenceContext = createContext<ThemePreferenceValue | undefined>(undefined);
