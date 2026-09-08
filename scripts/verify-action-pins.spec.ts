import { describe, expect, it } from 'vitest';
import { findPinProblems } from './verify-action-pins.ts';

const file = (content: string) => [{ path: 'ci.yml', content }];

/**
 * The interesting cases are the two the naive grep gets wrong: a local
 * composite action (correctly unpinned, must not be reported) and a bare hash
 * with no version comment (pinned, but unreviewable).
 */
describe('findPinProblems', () => {
  const pinned = 'uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0';

  it('accepts a SHA pin carrying a version comment', () => {
    const result = findPinProblems(file(`      - ${pinned}\n`));

    expect(result.ok).toBe(true);
    expect(result.checked).toBe(1);
  });

  it('rejects a mutable tag, naming the file, line and reference', () => {
    const result = findPinProblems(file('      - uses: actions/checkout@v4\n'));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('ci.yml:1');
    expect(result.message).toContain('actions/checkout@v4');
  });

  it('rejects a branch reference', () => {
    expect(findPinProblems(file('      - uses: some/action@main\n')).ok).toBe(false);
  });

  it('rejects a short SHA, which is neither immutable nor unambiguous', () => {
    expect(findPinProblems(file('      - uses: some/action@11d5960\n')).ok).toBe(false);
  });

  it('rejects a bare 40-character hash with no version comment', () => {
    const bare = 'uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262';
    const result = findPinProblems(file(`      - ${bare}\n`));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('unreviewable');
  });

  it('ignores local actions, which resolve from the checked-out commit', () => {
    const result = findPinProblems(file('      - uses: ./.github/actions/setup\n'));

    expect(result.ok).toBe(true);
    expect(result.checked).toBe(0);
  });

  it('handles a `uses:` that is a step key rather than a list item', () => {
    const result = findPinProblems(file(`      ${pinned}\n`));

    expect(result.ok).toBe(true);
    expect(result.checked).toBe(1);
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const content = '      - uses: a/one@v1\n      - uses: b/two@v2\n';
    const result = findPinProblems(file(content));

    expect(result.problems).toHaveLength(2);
  });

  it('passes vacuously when there is nothing to check', () => {
    expect(findPinProblems([]).ok).toBe(true);
  });
});
