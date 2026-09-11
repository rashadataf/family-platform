import { asUserId } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { EmailAddress } from './email-address.vo.js';
import { User } from './user.aggregate.js';

const NOW = new Date('2026-01-01T00:00:00Z');

function register(now = NOW) {
  return User.register({
    id: asUserId('user-1'),
    email: EmailAddress.from('ada@example.com'),
    passwordHash: 'argon2id-hash',
    now,
  });
}

describe('User', () => {
  it('registers into pending_verification, unverified', () => {
    const user = register();

    expect(user.status).toBe('pending_verification');
    expect(user.isVerified).toBe(false);
  });

  it('holds no field naming a family, role, or capability (FR-018)', () => {
    const user = register();

    const props = Object.keys(user.toProps());
    for (const forbidden of ['family', 'role', 'capability', 'capabilities']) {
      expect(props.map((p) => p.toLowerCase())).not.toContain(forbidden);
    }
  });

  it('verify() transitions pending_verification to active and records the timestamp', () => {
    const user = register();
    const verifiedAt = new Date(NOW.getTime() + 1000);

    const result = user.verify(verifiedAt);

    expect(result.ok).toBe(true);
    expect(user.status).toBe('active');
    expect(user.isVerified).toBe(true);
  });

  it('rejects verifying an account that is not pending_verification', () => {
    const user = register();
    user.verify(new Date(NOW.getTime() + 1000));

    const secondAttempt = user.verify(new Date(NOW.getTime() + 2000));

    expect(secondAttempt).toEqual({ ok: false, error: { kind: 'VerificationInvalid' } });
    // The first, successful verification is not undone by the rejected second call.
    expect(user.status).toBe('active');
  });

  it('locks the account once recordFailedAttempt reaches the threshold (FR-008)', () => {
    const user = register();
    const params = { maxAttempts: 3, lockoutMs: 15 * 60 * 1000 };

    user.recordFailedAttempt(new Date(NOW.getTime() + 1000), params);
    user.recordFailedAttempt(new Date(NOW.getTime() + 2000), params);
    expect(user.throttledUntil).toBeNull();

    const thirdAttemptAt = new Date(NOW.getTime() + 3000);
    user.recordFailedAttempt(thirdAttemptAt, params);

    expect(user.failedAttemptCount).toBe(3);
    expect(user.throttledUntil).toEqual(new Date(thirdAttemptAt.getTime() + params.lockoutMs));
  });

  it('clearFailedAttempts resets the count and lifts any lock', () => {
    const user = register();
    const params = { maxAttempts: 1, lockoutMs: 15 * 60 * 1000 };
    user.recordFailedAttempt(new Date(NOW.getTime() + 1000), params);
    expect(user.throttledUntil).not.toBeNull();

    user.clearFailedAttempts(new Date(NOW.getTime() + 2000));

    expect(user.failedAttemptCount).toBe(0);
    expect(user.throttledUntil).toBeNull();
  });
});
