/**
 * The one place a `ThemeName` and the colour token module meet. Everything
 * downstream of `ThemeProvider` sees only the result — this is where FR-003
 * ("resolution happens once, at the root") is actually done.
 */
import { colour, type ColourRole, type ThemeName } from '../tokens/index.js';

export type ResolvedColours = Readonly<Record<ColourRole, string>>;

export function resolveColours(theme: ThemeName): ResolvedColours {
  const resolved = {} as Record<ColourRole, string>;
  for (const role of Object.keys(colour) as ColourRole[]) {
    resolved[role] = colour[role][theme];
  }
  return resolved;
}
