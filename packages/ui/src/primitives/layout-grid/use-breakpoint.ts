import { useWindowDimensions } from 'react-native';
import { resolveBreakpoint } from './resolve-breakpoint.js';
import type { Breakpoint } from '../../tokens/index.js';

/** The current breakpoint's columns, margin, gutter and control height (artboard 04). */
export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  return resolveBreakpoint(width);
}
