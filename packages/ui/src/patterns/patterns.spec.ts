/**
 * Guard tests for the four constitution-carrying patterns. Each pattern
 * component calls straight into `guards.ts` for its refusal behaviour (see
 * that file's header and R13), so these tests exercise the exact functions
 * each component runs — not a re-implementation of the same checks.
 */
import { describe, expect, it } from 'vitest';
import { assertConfidenceInRange, assertNonEmpty } from './guards.js';

describe('Proposal guards', () => {
  it('refuses an empty sourceReference', () => {
    expect(() => {
      assertNonEmpty('', 'sourceReference', 'Proposal');
    }).toThrow(/non-empty sourceReference/);
  });

  it('accepts a non-empty sourceReference', () => {
    expect(() => {
      assertNonEmpty('document-8f2c', 'sourceReference', 'Proposal');
    }).not.toThrow();
  });

  it('refuses a confidence outside [0, 1]', () => {
    expect(() => {
      assertConfidenceInRange(-0.1, 'Proposal');
    }).toThrow(/confidence in \[0, 1\]/);
    expect(() => {
      assertConfidenceInRange(1.1, 'Proposal');
    }).toThrow(/confidence in \[0, 1\]/);
  });

  it('accepts a confidence at either end of [0, 1]', () => {
    expect(() => {
      assertConfidenceInRange(0, 'Proposal');
    }).not.toThrow();
    expect(() => {
      assertConfidenceInRange(1, 'Proposal');
    }).not.toThrow();
  });
});

describe('GatedSurface guards', () => {
  it('refuses an empty allowedGroupLabel', () => {
    expect(() => {
      assertNonEmpty('', 'allowedGroupLabel', 'GatedSurface');
    }).toThrow(/non-empty allowedGroupLabel/);
  });

  it('refuses an empty auditNotice', () => {
    expect(() => {
      assertNonEmpty('', 'auditNotice', 'GatedSurface');
    }).toThrow(/non-empty auditNotice/);
  });
});

describe('Reminder guards', () => {
  it('refuses an empty ruleId', () => {
    expect(() => {
      assertNonEmpty('', 'ruleId', 'Reminder');
    }).toThrow(/non-empty ruleId/);
  });

  it('refuses an empty ruleVersion', () => {
    expect(() => {
      assertNonEmpty('', 'ruleVersion', 'Reminder');
    }).toThrow(/non-empty ruleVersion/);
  });

  it('refuses an empty sourceReference', () => {
    expect(() => {
      assertNonEmpty('', 'sourceReference', 'Reminder');
    }).toThrow(/non-empty sourceReference/);
  });
});

describe('NotFound guards', () => {
  it('refuses an empty description', () => {
    expect(() => {
      assertNonEmpty('', 'description', 'NotFound');
    }).toThrow(/non-empty description/);
  });

  it('refuses an empty actionLabel', () => {
    expect(() => {
      assertNonEmpty('', 'actionLabel', 'NotFound');
    }).toThrow(/non-empty actionLabel/);
  });
});
