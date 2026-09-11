import { describe, expect, it } from 'vitest';
import { emailSchema, passwordSchema } from './identity.contract.js';

describe('emailSchema', () => {
  it('trims and lowercases (FR-022)', () => {
    expect(emailSchema.parse('  Ada@Example.com  ')).toBe('ada@example.com');
  });

  it('rejects a malformed address', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('accepts any string — FR-004 strength is enforced downstream, not here', () => {
    expect(passwordSchema.safeParse('short').success).toBe(true);
  });
});
