import type { DeviceId, SessionId, UserId } from '@fp/kernel';

/**
 * Matches the `session_revoked_reason` enum in
 * packages/persistence/prisma/schema.prisma (data-model.md). Distinguishing
 * these is what makes a replay incident visible rather than indistinguishable
 * from an ordinary logout.
 */
export type SessionRevokedReason = 'user_revoked' | 'account_deleted' | 'replay_detected';

export interface SessionProps {
  id: SessionId;
  userId: UserId;
  deviceId: DeviceId;
  tokenHash: string;
  previousTokenHash: string | null;
  issuedAt: Date;
  rotatedAt: Date | null;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revokedReason: SessionRevokedReason | null;
}

/**
 * Aggregate root for one continuous authenticated relationship between a
 * `User` and a `Device`. `SessionId` is the **stable identity** that survives
 * rotation (data-model.md, spec.md clarification 2) — "log out this device"
 * revokes this id, never a particular token. US3 adds rotation and
 * revocation; this story only needs issuance and the usability check the
 * FR-023 guard relies on.
 */
export class Session {
  private constructor(private props: SessionProps) {}

  static issue(params: {
    id: SessionId;
    userId: UserId;
    deviceId: DeviceId;
    tokenHash: string;
    now: Date;
    absoluteLifetimeMs: number;
  }): Session {
    return new Session({
      id: params.id,
      userId: params.userId,
      deviceId: params.deviceId,
      tokenHash: params.tokenHash,
      previousTokenHash: null,
      issuedAt: params.now,
      rotatedAt: null,
      absoluteExpiresAt: new Date(params.now.getTime() + params.absoluteLifetimeMs),
      revokedAt: null,
      revokedReason: null,
    });
  }

  /** Rebuilds a `Session` from persisted state. No invariant re-checking — persistence already enforced it. */
  static reconstitute(props: SessionProps): Session {
    return new Session(props);
  }

  get id(): SessionId {
    return this.props.id;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get deviceId(): DeviceId {
    return this.props.deviceId;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get previousTokenHash(): string | null {
    return this.props.previousTokenHash;
  }

  get issuedAt(): Date {
    return this.props.issuedAt;
  }

  get rotatedAt(): Date | null {
    return this.props.rotatedAt;
  }

  get absoluteExpiresAt(): Date {
    return this.props.absoluteExpiresAt;
  }

  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }

  get revokedReason(): SessionRevokedReason | null {
    return this.props.revokedReason;
  }

  /** Snapshot for a repository to persist. Never exposed as the mutable `props` object itself. */
  toProps(): Readonly<SessionProps> {
    return { ...this.props };
  }

  /** FR-023: revoked or past its absolute ceiling both fail the same way, checked on every use. */
  isUsable(now: Date): boolean {
    return this.props.revokedAt === null && this.props.absoluteExpiresAt > now;
  }
}
