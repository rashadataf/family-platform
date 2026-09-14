import {
  EmailAddress,
  asFamilyId,
  asFamilyMemberId,
  asInvitationId,
  isErr,
  isOk,
  unwrap,
} from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { Invitation } from './invitation.aggregate.js';

const id = asInvitationId('11111111-1111-7111-8111-111111111111');
const familyId = asFamilyId('22222222-2222-7222-8222-222222222222');
const invitedByMemberId = asFamilyMemberId('33333333-3333-7333-8333-333333333333');
const acceptedByMemberId = asFamilyMemberId('44444444-4444-7444-8444-444444444444');
const now = new Date('2026-09-13T10:00:00Z');
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function create(overrides: { proposedRole?: 'adult' | 'extended' | 'viewer' | 'owner' } = {}) {
  return Invitation.create({
    id,
    familyId,
    email: EmailAddress.from('Grace@Example.com'),
    proposedRole: overrides.proposedRole ?? 'adult',
    tokenHash: 'a'.repeat(64),
    invitedByMemberId,
    now,
    ttlMs: TWO_WEEKS_MS,
  });
}

describe('Invitation.create', () => {
  it('refuses proposedRole owner — ownership is transferred, never invited', () => {
    const result = create({ proposedRole: 'owner' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe('OwnerIneligible');
  });

  it('normalises the email and starts pending, expiring 14 days out', () => {
    const invitation = unwrap(create());
    expect(invitation.email.value).toBe('grace@example.com');
    expect(invitation.status).toBe('pending');
    expect(invitation.expiresAt.getTime()).toBe(now.getTime() + TWO_WEEKS_MS);
    expect(invitation.acceptedByMemberId).toBeNull();
  });
});

describe('Invitation#accept', () => {
  it('accepts a live invitation, recording who and when', () => {
    const invitation = unwrap(create());
    const result = invitation.accept(now, acceptedByMemberId);

    expect(isOk(result)).toBe(true);
    expect(invitation.status).toBe('accepted');
    expect(invitation.acceptedByMemberId).toBe(acceptedByMemberId);
  });

  it('refuses a token that expired a minute ago, even though status is still "pending" (FR-012)', () => {
    const invitation = unwrap(create());
    const oneMinuteAfterExpiry = new Date(invitation.expiresAt.getTime() + 60_000);

    const result = invitation.accept(oneMinuteAfterExpiry, acceptedByMemberId);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe('InvitationInvalid');
  });

  it('refuses a revoked invitation', () => {
    const invitation = unwrap(create());
    unwrap(invitation.revoke(now));

    const result = invitation.accept(now, acceptedByMemberId);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe('InvitationInvalid');
  });

  it('refuses a second acceptance (the command layer, not this method, makes a repeat idempotent)', () => {
    const invitation = unwrap(create());
    unwrap(invitation.accept(now, acceptedByMemberId));

    const secondAttempt = invitation.accept(
      now,
      asFamilyMemberId('55555555-5555-7555-8555-555555555555'),
    );

    expect(isErr(secondAttempt)).toBe(true);
  });
});

describe('Invitation#revoke', () => {
  it('revokes a pending invitation', () => {
    const invitation = unwrap(create());
    const result = invitation.revoke(now);

    expect(isOk(result)).toBe(true);
    expect(invitation.status).toBe('revoked');
  });

  it('refuses to revoke an already-accepted invitation', () => {
    const invitation = unwrap(create());
    unwrap(invitation.accept(now, acceptedByMemberId));

    const result = invitation.revoke(now);

    expect(isErr(result)).toBe(true);
  });
});

describe('Invitation#isExpired', () => {
  it('is true only once the clock passes expiresAt and status is still pending', () => {
    const invitation = unwrap(create());

    expect(invitation.isExpired(now)).toBe(false);
    expect(invitation.isExpired(new Date(invitation.expiresAt.getTime() + 1))).toBe(true);
  });

  it('is false for an invitation already marked accepted or revoked, however old', () => {
    const invitation = unwrap(create());
    unwrap(invitation.revoke(now));

    expect(invitation.isExpired(new Date(invitation.expiresAt.getTime() + 1))).toBe(false);
  });
});
