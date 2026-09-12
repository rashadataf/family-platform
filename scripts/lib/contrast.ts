/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * Spec 007 FR-010 requires every colour pairing artboard 01 documents to be
 * verified automatically in both themes. The maths lives here rather than in
 * the script so that it can be unit-tested against published reference values
 * — a contrast check that is itself wrong is worse than no check, because it
 * produces a passing gate and a false sense of having looked.
 */

/** Undoes sRGB gamma encoding for one channel. */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** `#RRGGBB` (case-insensitive) to its three channels. Throws on anything else. */
export function parseHex(hex: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (match?.[1] === undefined) {
    throw new Error(
      `Not a six-digit hex colour: ${JSON.stringify(hex)}. ` +
        'Contrast can only be measured between opaque colours — a translucent ' +
        'value depends on whatever happens to be behind it, which is exactly ' +
        'the situation a documented pairing is meant to remove.',
    );
  }
  const value = match[1];
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ] as const;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
