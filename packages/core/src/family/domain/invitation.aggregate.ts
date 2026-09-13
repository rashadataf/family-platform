import {
  EmailAddress,
  err,
  ok,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type InvitationId,
  type Result,
} from '@fp/kernel';
import type { MemberRole } from './capabilities.js';

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** A role an invitation may propose. `owner` is excluded — see `Invitation.create`'s own check. */
export type InvitableRole = Exclude<MemberRole, 'owner'>;

export interface InvitationProps {
  id: InvitationId;
  familyId: FamilyId;
  email: EmailAddress;
  proposedRole: InvitableRole;
  tokenHash: string;
  status: InvitationStatus;
  expiresAt: Date;
  invitedByMemberId: FamilyMemberId;
  acceptedByMemberId: FamilyMemberId | null;
  createdAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * FR-011: an invitation is addressed to an email, not to an account — it
 * works whether or not that address already has one. The token is hashed the
 * same way spec 006 handles verification tokens (research.md §8): never
 * stored raw, so a database disclosure hands over nothing usable.
 */
export class Invitation {
  private constructor(private props: InvitationProps) {}

  static create(params: {
    id: InvitationId;
    familyId: FamilyId;
    email: EmailAddress;
    /** Broad on purpose (defense in depth, the same as `FamilyMember.createFromInvitation`'s param): the check below is what narrows it. */
    proposedRole: MemberRole;
    tokenHash: string;
    invitedByMemberId: FamilyMemberId;
    now: Date;
    ttlMs: number;
  }): Result<Invitation, DomainError> {
    if (params.proposedRole === 'owner') {
      return err({
        kind: 'OwnerIneligible',
        reason: 'Ownership is transferred to an existing member, never granted by invitation.',
      });
    }

    return ok(
      new Invitation({
        id: params.id,
        familyId: params.familyId,
        email: params.email,
        proposedRole: params.proposedRole,
        tokenHash: params.tokenHash,
        status: 'pending',
        expiresAt: new Date(params.now.getTime() + params.ttlMs),
        invitedByMemberId: params.invitedByMemberId,
        acceptedByMemberId: null,
        createdAt: params.now,
        acceptedAt: null,
        revokedAt: null,
      }),
    );
  }

  static reconstitute(props: InvitationProps): Invitation {
    return new Invitation(props);
  }

  get id(): InvitationId {
    return this.props.id;
  }

  get familyId(): FamilyId {
    return this.props.familyId;
  }

  get email(): EmailAddress {
    return this.props.email;
  }

  get proposedRole(): InvitableRole {
    return this.props.proposedRole;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get status(): InvitationStatus {
    return this.props.status;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get invitedByMemberId(): FamilyMemberId {
    return this.props.invitedByMemberId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get acceptedAt(): Date | null {
    return this.props.acceptedAt;
  }

  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }

  get acceptedByMemberId(): FamilyMemberId | null {
    return this.props.acceptedByMemberId;
  }

  /**
   * FR-012: a token that expired one minute ago must not be acceptable
   * merely because the sweep has not run yet — this takes the clock as a
   * parameter (never reads it directly) and checks `expiresAt` itself,
   * rather than trusting `status`, which the sweep may not have caught up to.
   * Shared by acceptance and by the sweep's own decision to call
   * `markExpired`.
   */
  isExpired(now: Date): boolean {
    return this.props.status === 'pending' && this.props.expiresAt <= now;
  }

  /** US3 Scenario 4: unknown, revoked, and expired all collapse to one type on the wire — see the contract. */
  private isAcceptable(now: Date): boolean {
    return this.props.status === 'pending' && this.props.expiresAt > now;
  }

  accept(now: Date, acceptedByMemberId: FamilyMemberId): Result<void, DomainError> {
    if (!this.isAcceptable(now)) {
      return err({ kind: 'InvitationInvalid' });
    }
    this.props = {
      ...this.props,
      status: 'accepted',
      acceptedAt: now,
      acceptedByMemberId,
    };
    return ok(undefined);
  }

  revoke(now: Date): Result<void, DomainError> {
    if (this.props.status !== 'pending') {
      return err({ kind: 'InvitationInvalid' });
    }
    this.props = { ...this.props, status: 'revoked', revokedAt: now };
    return ok(undefined);
  }

  /** The expiry sweep's own write (FR-012) — a status change, not a new decision: `isExpired` already made this call. */
  markExpired(): void {
    if (this.props.status !== 'pending') return;
    this.props = { ...this.props, status: 'expired' };
  }
}
