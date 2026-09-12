/**
 * Pure, no `react-native` import (see tracking.ts's note — R13). React
 * Native's `fontWeight` accepts these exact strings (and the matching
 * numbers, unused here); this module doesn't import `TextStyle` to say so,
 * because doing that would make this file untestable for no real benefit —
 * the return values are checked against `typography`'s own closed
 * `FontWeight` union instead, one level up.
 */
import type { FontWeight } from '../tokens/index.js';

const FONT_WEIGHT_STRINGS: Record<FontWeight, '400' | '500' | '600' | '700'> = {
  400: '400',
  500: '500',
  600: '600',
  700: '700',
};

export function fontWeightToString(weight: FontWeight): '400' | '500' | '600' | '700' {
  return FONT_WEIGHT_STRINGS[weight];
}
