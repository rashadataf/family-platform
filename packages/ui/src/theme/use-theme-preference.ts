import { useContext } from 'react';
import { ThemePreferenceContext, type ThemePreferenceValue } from './theme-preference-context.js';

/**
 * For the one screen that offers the system/light/dark override (T035) —
 * everything else should use `useTheme`, which exposes no name to branch
 * on.
 */
export function useThemePreference(): ThemePreferenceValue {
  const value = useContext(ThemePreferenceContext);
  if (!value) {
    throw new Error('useThemePreference() was called outside a <ThemeProvider>.');
  }
  return value;
}
