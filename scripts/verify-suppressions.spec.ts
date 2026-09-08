import { describe, expect, it } from 'vitest';
import { checkSuppressionText } from './verify-suppressions.ts';

/**
 * The case worth guarding is the one that looks like success: an entry with no
 * expiry silences its finding forever, and osv-scanner reports a clean scan
 * while it does so.
 */
describe('checkSuppressionText', () => {
  const withExpiry = [
    '[[IgnoredVulns]]',
    'id = "GHSA-aaaa-bbbb-cccc"',
    'ignoreUntil = 2026-12-01',
    'reason = "No fix published upstream."',
  ].join('\n');

  it('accepts an entry carrying an expiry', () => {
    const result = checkSuppressionText(withExpiry);

    expect(result.ok).toBe(true);
    expect(result.entries).toBe(1);
  });

  it('rejects an entry with no expiry, naming the advisory', () => {
    const result = checkSuppressionText(withExpiry.replace('ignoreUntil = 2026-12-01\n', ''));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('GHSA-aaaa-bbbb-cccc');
    expect(result.message).toContain('ignoreUntil');
  });

  it('accepts an expiry already in the past — the finding simply fails again', () => {
    expect(checkSuppressionText(withExpiry.replace('2026-12-01', '2020-01-01')).ok).toBe(true);
  });

  it('requires effectiveUntil on a PackageOverrides entry', () => {
    const toml = ['[[PackageOverrides]]', 'name = "lib"', 'ignore = true'].join('\n');
    const result = checkSuppressionText(toml);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('effectiveUntil');
  });

  it('ignores commented-out examples, which every config file has', () => {
    const toml = ['# [[IgnoredVulns]]', '# id = "GHSA-xxxx"', '# reason = "example"'].join('\n');
    const result = checkSuppressionText(toml);

    expect(result.ok).toBe(true);
    expect(result.entries).toBe(0);
  });

  it('checks every entry, not just the first', () => {
    const toml = `${withExpiry}\n\n[[IgnoredVulns]]\nid = "GHSA-dddd"\nreason = "x"\n`;
    const result = checkSuppressionText(toml);

    expect(result.ok).toBe(false);
    expect(result.entries).toBe(2);
    expect(result.message).toContain('GHSA-dddd');
  });

  it('does not let a following table smuggle an expiry into the previous entry', () => {
    const toml = `[[IgnoredVulns]]\nid = "GHSA-eeee"\n\n[SomethingElse]\nignoreUntil = 2026-12-01\n`;

    expect(checkSuppressionText(toml).ok).toBe(false);
  });

  it('passes on a file with no suppressions at all', () => {
    expect(checkSuppressionText('# nothing here\n').ok).toBe(true);
  });
});
