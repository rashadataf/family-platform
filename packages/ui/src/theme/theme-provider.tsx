import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { resolveColours } from './resolve-colours.js';
import { ThemeContext, type ThemeValue } from './theme-context.js';
import { ThemePreferenceContext } from './theme-preference-context.js';
import { resolveThemePreference, type ThemePreference } from './resolve-theme-preference.js';
import { loadThemePreference, saveThemePreference } from './theme-storage.js';

export interface ThemeProviderProps {
  readonly children?: ReactNode;
}

/**
 * Resolves the theme once, at the root (FR-003), following the OS scheme
 * by default and a stored override when one exists (FR-004, FR-005). The
 * stored preference loads asynchronously — `system` is the state until it
 * resolves, which is the same value a person who has never set an override
 * would end up with anyway, so there is no visible flash to a wrong theme.
 *
 * Live switching (T036) falls out of this shape rather than needing its
 * own code: `colours` and the preference both come from context values on
 * a `ThemeProvider` that stays mounted for the app's whole lifetime, so an
 * open `Sheet` or `Dialog` re-renders with the new value in place — it is
 * never unmounted, because nothing here keys a subtree on the theme.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let cancelled = false;
    void loadThemePreference().then((stored) => {
      if (!cancelled) {
        setPreferenceState(stored);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void saveThemePreference(next);
  }, []);

  const resolvedTheme = resolveThemePreference(preference, systemScheme);

  const themeValue = useMemo<ThemeValue>(
    () => ({ colours: resolveColours(resolvedTheme) }),
    [resolvedTheme],
  );

  const preferenceValue = useMemo(
    () => ({ preference, setPreference }),
    [preference, setPreference],
  );

  return (
    <ThemePreferenceContext.Provider value={preferenceValue}>
      <ThemeContext.Provider value={themeValue}>{children}</ThemeContext.Provider>
    </ThemePreferenceContext.Provider>
  );
}
