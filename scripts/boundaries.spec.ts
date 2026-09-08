import { describe, expect, it } from 'vitest';
import { describeRules } from './boundaries.ts';

/**
 * The inventory exists so a passing run says what it checked. These tests
 * cover the two configurations that would make the gate vacuous while still
 * exiting zero — which is the failure mode worth guarding, because it looks
 * exactly like success.
 */
describe('describeRules', () => {
  const valid = {
    allowed: [{}, {}, {}],
    allowedSeverity: 'error',
    forbidden: [{ name: 'no-circular' }, { name: 'no-cross-app' }],
  };

  it('lists the allowed-entry count and every named rule', () => {
    const summary = describeRules(valid);

    expect(summary).toContain('3 allowed-edge entries');
    expect(summary).toContain('no-circular, no-cross-app');
  });

  it('reports an empty allowed set as fail-open rather than as a clean run', () => {
    expect(describeRules({ ...valid, allowed: [] })).toContain('fail-open');
  });

  it('reports a non-error allowedSeverity, which downgrades the gate to a warning', () => {
    const summary = describeRules({ ...valid, allowedSeverity: 'warn' });

    expect(summary).toContain('must fail the build');
  });

  it('treats a missing allowed set the same as an empty one', () => {
    expect(describeRules({ allowedSeverity: 'error' })).toContain('fail-open');
  });

  it('survives a rule with no name rather than printing undefined', () => {
    const summary = describeRules({ ...valid, forbidden: [{ name: 'a' }, {}] });

    expect(summary).toContain('1 named rules: a');
  });
});
