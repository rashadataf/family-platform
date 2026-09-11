import type { SessionId, UserId } from '@fp/kernel';
import type { Session } from '../../domain/session.aggregate.js';
import type { UserStatus } from '../../domain/user.aggregate.js';

/**
 * What every authenticated request needs from one lookup: the session, its
 * owner's current status (the FR-023 guard's job), and whether the
 * presented hash matched the session's *current* credential or its
 * *immediately-superseded* one (FR-011's replay check) — a superseded
 * credential is a possible compromise no matter which route it is
 * presented to, not only the renewal route.
 */
export interface SessionAuthContext {
  session: Session;
  userStatus: UserStatus;
  matchedPrevious: boolean;
}

/** The read shape `GET /v1/identity/sessions` renders — never a token hash or other credential material. */
export interface SessionSummary {
  sessionId: SessionId;
  deviceLabel: string;
  issuedAt: Date;
  rotatedAt: Date | null;
  absoluteExpiresAt: Date;
}

/**
 * FR-021's export field list for a session: device label plus issued and
 * revoked timestamps only — never a token hash, and distinct from
 * `SessionSummary` (which never surfaces `revokedAt` — a revoked session
 * still appears in the wire-facing session list unchanged; export needs the
 * revocation timestamp specifically).
 */
export interface ExportedSessionSummary {
  deviceLabel: string;
  issuedAt: Date;
  revokedAt: Date | null;
}

export interface SessionRepository {
  findById(id: SessionId): Promise<Session | null>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  /**
   * A single joined lookup (`tokenHash` OR `previousTokenHash`, plus the
   * owning user's status) that serves every authenticated request — the
   * FR-023 guard and renewal alike — so replay detection applies uniformly
   * rather than only on the one route that happens to rotate credentials
   * (research.md §8's <5ms budget: one repository call either way).
   */
  findAuthContextByTokenHash(tokenHash: string): Promise<SessionAuthContext | null>;
  listSummariesByUserId(userId: UserId): Promise<SessionSummary[]>;
  /** Every session for a user, as full aggregates — FR-015's "revoke every active session" needs to mutate and save each one. */
  listByUserId(userId: UserId): Promise<Session[]>;
  listExportSummariesByUserId(userId: UserId): Promise<ExportedSessionSummary[]>;
  save(session: Session): Promise<void>;
}
