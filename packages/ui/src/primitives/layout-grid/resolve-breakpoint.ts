/**
 * Pure width-to-breakpoint resolution, split from `use-breakpoint.ts` per
 * R13 (that file imports `react-native`'s `useWindowDimensions` and is
 * therefore unreachable from a `.spec.ts` file; this one imports nothing
 * but the token module and is fully testable).
 */
import { layout, type Breakpoint, type BreakpointKey } from '../../tokens/index.js';

const KEYS: readonly BreakpointKey[] = ['sm', 'md', 'lg', 'xl'];

/**
 * The four ranges in `layout` are contiguous and start at 0 (artboard 04),
 * so every non-negative width matches exactly one. A negative width cannot
 * occur from a real window measurement; it resolves to `sm`, the narrowest
 * breakpoint, rather than being treated as an error.
 */
export function resolveBreakpointKey(width: number): BreakpointKey {
  for (const key of KEYS) {
    const [min, max] = layout[key].range;
    if (width >= min && (max === null || width <= max)) {
      return key;
    }
  }
  return 'sm';
}

export function resolveBreakpoint(width: number): Breakpoint {
  return layout[resolveBreakpointKey(width)];
}
