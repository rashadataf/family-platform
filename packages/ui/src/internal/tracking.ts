/**
 * Pure on purpose, with no import of `react-native`: research R13 records
 * why that boundary matters here specifically — Vitest cannot parse
 * `react-native`'s own source (Flow syntax, no Babel transform in this
 * project's test pipeline), so anything a unit test needs to reach must not
 * import it, even transitively.
 *
 * `tracking` is a CSS em string (`'0.005em'`, or the literal `'0'`) because
 * that is how the canvas records it — relative to the type size it modifies.
 * React Native's `letterSpacing` takes absolute px, so it is resolved here,
 * against the caller's own `size`, not baked into the token.
 */
export function trackingToLetterSpacing(tracking: string, size: number): number {
  const match = /^(-?[\d.]+)em$/.exec(tracking);
  // `noUncheckedIndexedAccess` widens a capture group to `string | undefined`
  // even though a successful `match` here always has it — the pattern's only
  // group is not optional.
  return match?.[1] !== undefined ? parseFloat(match[1]) * size : 0;
}
