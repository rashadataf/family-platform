import { describe, expect, it } from 'vitest';
import { filterAdvisories, type OsvReport } from './filter-advisories.ts';

const report = (
  name: string,
  version: string,
  id: string,
  maxSeverity?: string,
  label?: string,
): OsvReport => ({
  results: [
    {
      packages: [
        {
          package: { name, version, ecosystem: 'npm' },
          groups: maxSeverity === undefined ? [] : [{ ids: [id], max_severity: maxSeverity }],
          vulnerabilities: [
            {
              id,
              database_specific: label === undefined ? undefined : { severity: label },
              affected: [{ ranges: [{ events: [{ introduced: '0' }, { fixed: '2.3.0' }] }] }],
            },
          ],
        },
      ],
    },
  ],
});

describe('filterAdvisories', () => {
  it('blocks on a HIGH advisory and names package, id and fix', () => {
    const result = filterAdvisories(report('multer', '2.2.0', 'GHSA-535w', '7.5'));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('multer@2.2.0');
    expect(result.message).toContain('GHSA-535w');
    expect(result.message).toContain('2.3.0');
  });

  it('does not block on a LOW advisory, but still reports it', () => {
    const result = filterAdvisories(report('multer', '2.2.0', 'GHSA-qvfw', '3.7'));

    expect(result.ok).toBe(true);
    expect(result.message).toContain('GHSA-qvfw');
  });

  it('treats 7.0 exactly as blocking — it is the HIGH boundary, not above it', () => {
    expect(filterAdvisories(report('p', '1', 'X', '7.0')).ok).toBe(false);
    expect(filterAdvisories(report('p', '1', 'X', '6.9')).ok).toBe(true);
  });

  it('falls back to the GitHub severity label when no score is present', () => {
    expect(filterAdvisories(report('p', '1', 'X', undefined, 'CRITICAL')).ok).toBe(false);
    expect(filterAdvisories(report('p', '1', 'X', undefined, 'MODERATE')).ok).toBe(true);
  });

  it('does not block on an advisory of unknown severity, but names it', () => {
    const result = filterAdvisories(report('p', '1', 'X'));

    expect(result.ok).toBe(true);
    expect(result.message).toContain('UNKNOWN');
  });

  it('says so plainly when an advisory has no published fix', () => {
    const bare: OsvReport = {
      results: [
        {
          packages: [
            {
              package: { name: 'p', version: '1' },
              groups: [{ ids: ['X'], max_severity: '9.1' }],
              vulnerabilities: [{ id: 'X' }],
            },
          ],
        },
      ],
    };

    expect(filterAdvisories(bare).message).toContain('no fix published');
  });

  it('passes on an empty report', () => {
    expect(filterAdvisories({}).ok).toBe(true);
    expect(filterAdvisories({ results: [] }).message).toContain('No known advisories');
  });
});
