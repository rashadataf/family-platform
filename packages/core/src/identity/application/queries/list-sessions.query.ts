import type { SessionId, UserId } from '@fp/kernel';
import type { SessionRepository } from '../ports/session.repository.js';

export interface ListSessionsInput {
  userId: UserId;
  /** So the response can flag which row is the one making this very request. */
  currentSessionId: SessionId;
}

export interface ListSessionsDeps {
  sessionRepository: SessionRepository;
}

export interface SessionListItem {
  sessionId: SessionId;
  deviceLabel: string;
  issuedAt: Date;
  rotatedAt: Date | null;
  absoluteExpiresAt: Date;
  isCurrent: boolean;
}

/**
 * A pure read — there is no failure mode a caller needs to branch on (an
 * account with no sessions yet is simply an empty list), so this returns the
 * list directly rather than a `Result`.
 */
export async function listSessions(
  input: ListSessionsInput,
  deps: ListSessionsDeps,
): Promise<SessionListItem[]> {
  const summaries = await deps.sessionRepository.listSummariesByUserId(input.userId);
  return summaries.map((summary) => ({
    ...summary,
    isCurrent: summary.sessionId === input.currentSessionId,
  }));
}
