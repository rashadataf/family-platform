import { describe, expect, it } from 'vitest';
import { EmailAddress } from './email-address.vo.js';

describe('EmailAddress', () => {
  it('normalises case so two differently-cased emails are equal (FR-022)', () => {
    const a = EmailAddress.from('User@Example.com');
    const b = EmailAddress.from('user@example.com');

    expect(a.equals(b)).toBe(true);
    expect(a.value).toBe('user@example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(EmailAddress.from('  ada@example.com  ').value).toBe('ada@example.com');
  });

  it('treats different addresses as unequal', () => {
    const a = EmailAddress.from('ada@example.com');
    const b = EmailAddress.from('grace@example.com');

    expect(a.equals(b)).toBe(false);
  });
});
