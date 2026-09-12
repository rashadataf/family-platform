/**
 * Bridges an `elevation` token (a CSS `box-shadow` string — artboard 03,
 * ADR-016's note that elevation is the one token that does not map
 * one-to-one across platforms) to iOS's shadow* style properties and
 * Android's single `elevation` number. Pure string parsing, no
 * `react-native` import — testable per research R13, unlike the primitives
 * that consume it.
 */
import type { ElevationToken } from '../tokens/index.js';

const SHADOW_PATTERN =
  /^(-?\d+)(?:px)?\s+(-?\d+)(?:px)?\s+(\d+)(?:px)?\s+rgba?\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/;

export interface ElevationStyle {
  readonly shadowColor?: string;
  readonly shadowOffset?: { readonly width: number; readonly height: number };
  readonly shadowOpacity?: number;
  readonly shadowRadius?: number;
  /** Android has no offset/blur/colour model — a level number is all it takes. */
  readonly elevation: number;
}

const toHex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();

/**
 * Roughly Material's own step sizes — there is no principled conversion
 * from a CSS blur radius to Android's single elevation number, so this is
 * a per-level table, not a formula.
 */
const ANDROID_ELEVATION: Record<ElevationToken, number> = { '0': 0, '1': 2, '2': 4, '3': 8 };

export function elevationToShadowStyle(level: ElevationToken, cssShadow: string): ElevationStyle {
  if (cssShadow === 'none') {
    // No colour, offset or radius at all, rather than a zeroed-out one: a
    // literal hex has no meaning for a level that casts no shadow, and
    // every shadow* property is optional in React Native's own style type.
    return { elevation: 0 };
  }

  const match = SHADOW_PATTERN.exec(cssShadow);
  if (!match) {
    throw new Error(`elevationToShadowStyle: could not parse "${cssShadow}" as a CSS box-shadow`);
  }
  const [, x, y, blur, r, g, b, alpha] = match;
  if (
    x === undefined ||
    y === undefined ||
    blur === undefined ||
    r === undefined ||
    g === undefined ||
    b === undefined ||
    alpha === undefined
  ) {
    throw new Error(`elevationToShadowStyle: incomplete match parsing "${cssShadow}"`);
  }

  return {
    shadowColor: `#${toHex2(Number(r))}${toHex2(Number(g))}${toHex2(Number(b))}`,
    shadowOffset: { width: Number(x), height: Number(y) },
    shadowOpacity: Number(alpha),
    shadowRadius: Number(blur),
    elevation: ANDROID_ELEVATION[level],
  };
}
