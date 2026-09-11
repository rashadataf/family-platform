import { err, ok, type DomainError, type Result, type UserId } from '@fp/kernel';
import type { EmailAddress } from './email-address.vo.js';

/**
 * Matches the `user_status` enum in packages/persistence/prisma/schema.prisma
 * (data-model.md). There is no path back from `deletion_requested` — see the
 * state diagram there.
 */
export type UserStatus = 'pending_verification' | 'active' | 'deletion_requested';

export interface UserProps {
  id: UserId;
  email: EmailAddress;
  passwordHash: string;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  deletionRequestedAt: Date | null;
  failedAttemptCount: number;
  throttledUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregate root for the Identity and Access context. Holds no reference to
 * any family, role, or capability, by construction (FR-018) — there is
 * simply no field for one here.
 */
export class User {
  private constructor(private props: UserProps) {}

  static register(params: {
    id: UserId;
    email: EmailAddress;
    passwordHash: string;
    now: Date;
  }): User {
    return new User({
      id: params.id,
      email: params.email,
      passwordHash: params.passwordHash,
      status: 'pending_verification',
      emailVerifiedAt: null,
      deletionRequestedAt: null,
      failedAttemptCount: 0,
      throttledUntil: null,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  /** Rebuilds a `User` from persisted state. No invariant re-checking — persistence already enforced it. */
  static reconstitute(props: UserProps): User {
    return new User(props);
  }

  get id(): UserId {
    return this.props.id;
  }

  get email(): EmailAddress {
    return this.props.email;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  get status(): UserStatus {
    return this.props.status;
  }

  get failedAttemptCount(): number {
    return this.props.failedAttemptCount;
  }

  get throttledUntil(): Date | null {
    return this.props.throttledUntil;
  }

  get deletionRequestedAt(): Date | null {
    return this.props.deletionRequestedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  /** Verification, once granted, is never revoked by a later status change (data-model.md). */
  get isVerified(): boolean {
    return this.props.emailVerifiedAt !== null;
  }

  /** Snapshot for a repository to persist. Never exposed as the mutable `props` object itself. */
  toProps(): Readonly<UserProps> {
    return { ...this.props };
  }

  verify(now: Date): Result<void, DomainError> {
    if (this.props.status !== 'pending_verification') {
      return err({ kind: 'VerificationInvalid' });
    }
    this.props = { ...this.props, status: 'active', emailVerifiedAt: now, updatedAt: now };
    return ok(undefined);
  }

  /**
   * FR-008: called on every failed authentication attempt against this
   * account. Locking on the count crossing the threshold, rather than on
   * every attempt once locked, means the lockout window keeps resetting for
   * as long as the attacker keeps trying — the intended behaviour, not a bug.
   */
  recordFailedAttempt(now: Date, params: { maxAttempts: number; lockoutMs: number }): void {
    const failedAttemptCount = this.props.failedAttemptCount + 1;
    const throttledUntil =
      failedAttemptCount >= params.maxAttempts
        ? new Date(now.getTime() + params.lockoutMs)
        : this.props.throttledUntil;
    this.props = { ...this.props, failedAttemptCount, throttledUntil, updatedAt: now };
  }

  /** A successful authentication clears any accumulated failure history. */
  clearFailedAttempts(now: Date): void {
    if (this.props.failedAttemptCount === 0 && this.props.throttledUntil === null) {
      return;
    }
    this.props = { ...this.props, failedAttemptCount: 0, throttledUntil: null, updatedAt: now };
  }
}
