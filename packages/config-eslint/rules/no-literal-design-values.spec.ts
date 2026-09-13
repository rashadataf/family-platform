import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import rule from './no-literal-design-values.js';

/**
 * The enforcement ADR-016 made this feature's own responsibility. A rule that
 * silently matches nothing is worse than no rule, so these assert both halves:
 * that real violations are caught, and that legitimate code is left alone.
 */

const linter = new Linter();

function lint(code: string): string[] {
  const messages = linter.verify(code, [
    {
      plugins: { 'fp-design': { rules: { 'no-literal-design-values': rule } } },
      rules: { 'fp-design/no-literal-design-values': 'error' },
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
  ]);
  return messages.map((m) => m.message);
}

describe('no-literal-design-values', () => {
  it('catches a literal hex colour', () => {
    const found = lint("const s = { backgroundColor: '#FFFFFF' };");
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('#FFFFFF');
    expect(found[0]).toContain('resolves per theme');
  });

  it('catches rgba and hsl too', () => {
    expect(lint("const s = { color: 'rgba(31,27,22,0.48)' };")).toHaveLength(1);
    expect(lint("const s = { color: 'hsl(20 40% 50%)' };")).toHaveLength(1);
  });

  it('catches a spacing value between steps, and names the scale', () => {
    const found = lint('const s = { padding: 13 };');
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('padding: 13');
    expect(found[0]).toContain('off the scale');
    expect(found[0]).toContain('0, 4, 8, 12');
  });

  it('accepts every member of the spacing scale', () => {
    for (const n of [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64]) {
      expect(lint(`const s = { paddingTop: ${String(n)} };`)).toEqual([]);
    }
  });

  it('catches an off-scale radius but accepts a real one', () => {
    expect(lint('const s = { borderRadius: 10 };')).toHaveLength(1);
    expect(lint('const s = { borderRadius: 12 };')).toEqual([]);
    expect(lint('const s = { borderTopLeftRadius: 24 };')).toEqual([]);
  });

  // Regression (spec 007): `shadowRadius` is React Native's shadow blur
  // radius, part of the elevation model, and ends in "Radius" the same as a
  // corner-radius property — but it is not on the radius SCALE and never
  // should be checked against it.
  it('does not mistake a shadow blur radius for a corner radius', () => {
    expect(lint('const s = { shadowRadius: 2 };')).toEqual([]);
    expect(lint('const s = { shadowRadius: 0 };')).toEqual([]);
  });

  it('catches type values that are not steps in the scale', () => {
    expect(lint('const s = { fontSize: 14 };')).toHaveLength(1);
    expect(lint('const s = { fontSize: 17 };')).toEqual([]);
    expect(lint('const s = { lineHeight: 21 };')).toHaveLength(1);
    expect(lint('const s = { lineHeight: 23 };')).toEqual([]);
  });

  it('leaves values that came from a token alone', () => {
    // The type system already guarantees these; flagging them would make the
    // rule unusable and push people towards disabling it.
    expect(lint('const s = { padding: space[4] };')).toEqual([]);
    expect(lint('const s = { backgroundColor: theme.surface.raised };')).toEqual([]);
    expect(lint('const s = { borderRadius: radius.md };')).toEqual([]);
  });

  it('does not flag numbers on properties that are not design values', () => {
    expect(lint('const s = { flex: 1, zIndex: 10, opacity: 1, numberOfLines: 2 };')).toEqual([]);
  });

  it('does not flag a string that merely mentions a colour', () => {
    expect(lint("const label = 'Pick a colour';")).toEqual([]);
  });
});
