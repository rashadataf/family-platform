import { asUserId } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { EmailVerification } from './email-verification.entity.js';

const NOW = new Date('2026-01-01T00:00:00Z');
const ONE_HOUR_MS = 60 * 60 * 1000;

function issue(now = NOW, ttlMs = ONE_HOUR_MS) {
  return EmailVerification.issue({
    id: 'verification-1',
    userId: asUserId('user-1'),
    tokenHash: 'hash',
    now,
    ttlMs,
  });
}

describe('EmailVerification', () => {
  it('is consumable before it expires', () => {
    const verification = issue();

    const result = verification.consume(new Date(NOW.getTime() + 1000));

    expect(result.ok).toBe(true);
  });

  it('rejects consumption once expired (FR-003a)', () => {
    const verification = issue(NOW, ONE_HOUR_MS);

    const result = verification.consume(new Date(NOW.getTime() + ONE_HOUR_MS + 1));

    expect(result).toEqual({ ok: false, error: { kind: 'VerificationInvalid' } });
  });

  it('rejects a second consumption of the same link', () => {
    const verification = issue();
    verification.consume(new Date(NOW.getTime() + 1000));

    const secondAttempt = verification.consume(new Date(NOW.getTime() + 2000));

    expect(secondAttempt.ok).toBe(false);
  });

  it('rejects consumption once superseded by a resend (FR-003a)', () => {
    const verification = issue();
    verification.supersede(new Date(NOW.getTime() + 500));

    const result = verification.consume(new Date(NOW.getTime() + 1000));

    expect(result.ok).toBe(false);
  });
});
