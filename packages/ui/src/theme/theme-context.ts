import { createContext } from 'react';
import type { ResolvedColours } from './resolve-colours.js';

/**
 * What a consumer receives from `useTheme` — resolved values only. FR-003
 * forbids exposing which theme produced them, so there is no `name` field
 * here for a component to branch on: the type itself is the enforcement.
 */
export interface ThemeValue {
  readonly colours: ResolvedColours;
}

/**
 * `undefined` by default, not a light-theme fallback: `useTheme` used outside
 * `ThemeProvider` is a programming error, and a plausible-looking default
 * would hide it instead of surfacing it.
 */
export const ThemeContext = createContext<ThemeValue | undefined>(undefined);
