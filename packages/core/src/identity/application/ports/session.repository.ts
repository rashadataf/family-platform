import type { SessionId, UserId } from '@fp/kernel';
import type { Session } from '../../domain/session.aggregate.js';
import type { UserStatus } from '../../domain/user.aggregate.js';

/** What the FR-023 guard needs from one lookup: the session and its owner's current status. */
export interface SessionAuthContext {
  session: Session;
  userStatus: UserStatus;
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
 * What renewal needs to distinguish an ordinary rotation from a replay: the
 * session, and whether the presented hash matched its *current* credential
 * or the *immediately-superseded* one (FR-011).
 */
export interface SessionMatch {
  session: Session;
  matchedPrevious: boolean;
}

export interface SessionRepository {
  findById(id: SessionId): Promise<Session | null>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  /**
   * A single joined lookup of the session plus its owning user's current
   * status, for the FR-023 guard that runs on every authenticated request
   * (research.md §8's <5ms budget) — two separate repository calls would
   * double the round trip this exists to avoid.
   */
  findAuthContextByTokenHash(tokenHash: string): Promise<SessionAuthContext | null>;
  /**
   * Matches a presented token against either the current or the
   * immediately-superseded credential in one lookup — renewal's own use,
   * distinct from `findAuthContextByTokenHash`, since an ordinary
   * authenticated request never needs to know about a superseded hash.
   */
  findByCurrentOrPreviousTokenHash(tokenHash: string): Promise<SessionMatch | null>;
  listSummariesByUserId(userId: UserId): Promise<SessionSummary[]>;
  save(session: Session): Promise<void>;
}
