import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * The schema of `design/tokens.json`, the canvas-to-code boundary (spec 007
 * FR-012, contracts/tokens-json.md).
 *
 * Principle II applies here in full. This file is data entering the system
 * from outside a program's own memory — authored beside the artboards, edited
 * by whoever changes a value on the canvas — so it is PARSED, never cast. A
 * malformed token file fails the check loudly rather than silently producing a
 * comparison against `undefined`, which would pass.
 */

const HEX = /^#[0-9A-F]{6}$/;

/** A colour role always carries both themes — FR-002 is structural, not a lint. */
const themedColour = z.object({
  light: z.string(),
  dark: z.string(),
});

const typeStep = z.object({
  family: z.enum(['sans', 'serif', 'mono']),
  size: z.number().int().positive(),
  lineHeight: z.number().int().positive(),
  weight: z.number().int(),
  tracking: z.string(),
});

const breakpoint = z.object({
  range: z.tuple([z.number().int(), z.number().int().nullable()]),
  columns: z.number().int().positive(),
  margin: z.number().int().nonnegative(),
  gutter: z.number().int().nonnegative(),
  controlHeight: z.number().int().positive(),
});

const contrastPair = z.object({
  foreground: z.string(),
  background: z.string(),
  floor: z.number().positive(),
});

export const designTokensSchema = z.object({
  // Present so the check can refuse a file it does not understand rather than
  // misinterpret one.
  version: z.literal(1),
  colour: z.record(z.string(), themedColour),
  typography: z.record(z.string(), typeStep),
  space: z.array(z.number().int().nonnegative()),
  radius: z.record(z.string(), z.number().int().nonnegative()),
  elevation: z.record(z.string(), z.string()),
  layout: z.record(z.string(), breakpoint),
  contrastPairs: z.array(contrastPair),
});

export type DesignTokens = z.infer<typeof designTokensSchema>;

/** Opaque roles only — the scrim is translucent by design and has no ratio. */
export function isOpaque(value: string): boolean {
  return HEX.test(value);
}

export function parseDesignTokens(raw: string): DesignTokens {
  return designTokensSchema.parse(JSON.parse(raw) as unknown);
}

export function loadDesignTokens(
  url: URL = new URL('../../design/tokens.json', import.meta.url),
): DesignTokens {
  return parseDesignTokens(readFileSync(url, 'utf-8'));
}
