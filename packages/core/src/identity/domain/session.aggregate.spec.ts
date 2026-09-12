import { asDeviceId, asSessionId, asUserId } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { Session } from './session.aggregate.js';

const NOW = new Date('2026-01-01T00:00:00Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function issue(now = NOW, absoluteLifetimeMs = 90 * ONE_DAY_MS) {
  return Session.issue({
    id: asSessionId('session-1'),
    userId: asUserId('user-1'),
    deviceId: asDeviceId('device-1'),
    tokenHash: 'hash',
    now,
    absoluteLifetimeMs,
  });
}

describe('Session', () => {
  it('issues with its device association, no prior credential, and a computed absolute expiry', () => {
    const session = issue(NOW, ONE_DAY_MS);

    expect(session.id).toBe('session-1');
    expect(session.deviceId).toBe('device-1');
    expect(session.tokenHash).toBe('hash');
    expect(session.previousTokenHash).toBeNull();
    expect(session.absoluteExpiresAt).toEqual(new Date(NOW.getTime() + ONE_DAY_MS));
    expect(session.revokedAt).toBeNull();
  });

  it('is usable before its absolute expiry', () => {
    const session = issue(NOW, ONE_DAY_MS);

    expect(session.isUsable(new Date(NOW.getTime() + 1000))).toBe(true);
  });

  it('is not usable once past its absolute expiry (FR-013)', () => {
    const session = issue(NOW, ONE_DAY_MS);

    expect(session.isUsable(new Date(NOW.getTime() + ONE_DAY_MS + 1))).toBe(false);
  });

  it('is not usable once revoked, even before its absolute expiry (FR-023)', () => {
    const session = Session.reconstitute({
      id: asSessionId('session-2'),
      userId: asUserId('user-1'),
      deviceId: asDeviceId('device-1'),
      tokenHash: 'hash',
      previousTokenHash: null,
      issuedAt: NOW,
      rotatedAt: null,
      absoluteExpiresAt: new Date(NOW.getTime() + ONE_DAY_MS),
      revokedAt: new Date(NOW.getTime() + 500),
      revokedReason: 'user_revoked',
    });

    expect(session.isUsable(new Date(NOW.getTime() + 1000))).toBe(false);
  });

  it('rotate() replaces the current credential, retaining the superseded one (FR-010, FR-011)', () => {
    const session = issue(NOW, ONE_DAY_MS);
    const rotatedAt = new Date(NOW.getTime() + 1000);

    const result = session.rotate('new-hash', rotatedAt);

    expect(result.ok).toBe(true);
    expect(session.tokenHash).toBe('new-hash');
    expect(session.previousTokenHash).toBe('hash');
    expect(session.rotatedAt).toEqual(rotatedAt);
  });

  it('rotate() refuses once past the absolute lifetime (FR-013)', () => {
    const session = issue(NOW, ONE_DAY_MS);

    const result = session.rotate('new-hash', new Date(NOW.getTime() + ONE_DAY_MS + 1));

    expect(result).toEqual({ ok: false, error: { kind: 'SessionInvalid' } });
    expect(session.tokenHash).toBe('hash');
  });

  it('rotate() refuses an already-revoked session', () => {
    const session = issue(NOW, ONE_DAY_MS);
    session.revoke('user_revoked', new Date(NOW.getTime() + 500));

    const result = session.rotate('new-hash', new Date(NOW.getTime() + 1000));

    expect(result.ok).toBe(false);
  });

  it('revoke() invalidates the session regardless of its remaining lifetime (FR-012)', () => {
    const session = issue(NOW, ONE_DAY_MS);

    session.revoke('replay_detected', new Date(NOW.getTime() + 1000));

    expect(session.revokedReason).toBe('replay_detected');
    expect(session.isUsable(new Date(NOW.getTime() + 2000))).toBe(false);
  });
});
