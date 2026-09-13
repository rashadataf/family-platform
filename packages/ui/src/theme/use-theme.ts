import { useContext } from 'react';
import { ThemeContext, type ThemeValue } from './theme-context.js';

/**
 * Resolved values only — never the active theme's name (FR-003,
 * contracts/package-api.md rule 3). A consumer has nothing to branch on.
 */
export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme() was called outside a <ThemeProvider>.');
  }
  return value;
}
