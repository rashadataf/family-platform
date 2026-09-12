/**
 * Pure, no `react-native` import (research R13). Colour is derived from the
 * member id, never chosen — artboard 07: "the same person is the same
 * colour on every device". The five roles below are exactly the values the
 * canvas's avatar swatches use (traced back like every other primitive's
 * colours, not copied): action.primary and the four status `.fg` roles,
 * reused rather than duplicated into a new avatar-only palette.
 */
import type { ColourRole } from '../tokens/index.js';

/**
 * A tuple, not `ColourRole[]`, on purpose: indexing a tuple with a literal
 * in-range number is exempt from `noUncheckedIndexedAccess`, so
 * `avatarColourRole` below needs no non-null assertion to stay total.
 */
const AVATAR_PALETTE = [
  'action.primary',
  'status.positive.fg',
  'status.info.fg',
  'status.caution.fg',
  'status.proposed.fg',
] as const satisfies readonly ColourRole[];

/**
 * A simple, deterministic string hash (djb2). Not cryptographic — it only
 * needs to be stable across runs and platforms, which `Array.prototype.sort`
 * comparators or `String.prototype.hashCode`-style shortcuts are not
 * guaranteed to be; this one is, because it is specified here rather than
 * borrowed from a runtime.
 */
function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

export function avatarColourRole(memberId: string): ColourRole {
  const index = hashString(memberId) % AVATAR_PALETTE.length;
  if (index === 0) return AVATAR_PALETTE[0];
  if (index === 1) return AVATAR_PALETTE[1];
  if (index === 2) return AVATAR_PALETTE[2];
  if (index === 3) return AVATAR_PALETTE[3];
  return AVATAR_PALETTE[4];
}
