import { useMemo, type ReactNode } from 'react';
import { resolveColours } from './resolve-colours.js';
import { ThemeContext, type ThemeValue } from './theme-context.js';

export interface ThemeProviderProps {
  readonly children?: ReactNode;
}

/**
 * Resolves the theme once, at the root (FR-003). This phase (US1) always
 * resolves `light` — following the OS scheme, the device-stored override and
 * live switching are T033-T036 (US2). Nothing downstream changes shape when
 * that lands: the context's value stays `{ colours }`, only how `light`
 * versus `dark` gets chosen changes.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const value = useMemo<ThemeValue>(() => ({ colours: resolveColours('light') }), []);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
