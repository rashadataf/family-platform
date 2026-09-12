/**
 * Bridges a `TypeStep` (artboard 02) to the subset of React Native's `Text`
 * style properties that render it. This lives outside `tokens/` on purpose —
 * it is presentation logic derived from a token, not a value of its own, and
 * `tokens/` may import nothing (FR-006) while this file legitimately imports
 * `react-native`.
 *
 * The two pure pieces (`tracking.ts`, `font-weight.ts`) live in their own
 * files and stay unit-tested; this file is the thin, RN-importing seam that
 * composes them, and per research R13 it is not itself unit-tested — Vitest
 * cannot parse `react-native`'s own source (Flow, no Babel transform in this
 * project's pipeline), so nothing that imports it, even for a value as small
 * as `Platform.select`, can be reached from a `.spec.ts` file.
 *
 * Custom font loading (Instrument Sans, Newsreader) is not part of this
 * spec's scope — no task here adds `expo-font` or bundles a font file. Family
 * resolution falls back to each platform's system faces until a later spec
 * does that work; every other property (size, line height, weight, tracking)
 * is exact.
 */
import { Platform } from 'react-native';
import type { TypeStep } from '../tokens/index.js';
import { fontWeightToString } from './font-weight.js';
import { trackingToLetterSpacing } from './tracking.js';

const FONT_FAMILIES: Record<TypeStep['family'], string | undefined> = {
  // `undefined` selects the platform default (San Francisco / Roboto) —
  // the closest system-face stand-in for Instrument Sans until it is loaded.
  sans: undefined,
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
};

export interface TextStyleFromStep {
  readonly fontFamily?: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: '400' | '500' | '600' | '700';
  readonly letterSpacing: number;
}

export function typeStepToTextStyle(step: TypeStep): TextStyleFromStep {
  return {
    fontFamily: FONT_FAMILIES[step.family],
    fontSize: step.size,
    lineHeight: step.lineHeight,
    fontWeight: fontWeightToString(step.weight),
    letterSpacing: trackingToLetterSpacing(step.tracking, step.size),
  };
}
