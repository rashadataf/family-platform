import {
  err,
  ok,
  type DomainError,
  type Result,
  type Clock,
  type SessionId,
  type UserId,
} from '@fp/kernel';
import type { SessionRepository } from '../ports/session.repository.js';

export interface RevokeSessionInput {
  userId: UserId;
  sessionId: SessionId;
}

export interface RevokeSessionDeps {
  sessionRepository: SessionRepository;
  clock: Clock;
}

/**
 * FR-012: revokes one of the caller's own sessions by its stable id.
 * Ownership is checked here, and a mismatch returns `NotFound` rather than a
 * forbidden error (contracts/identity-api.md's Authorization matrix: a
 * cross-tenant access attempt must not disclose that the resource exists).
 */
export async function revokeSession(
  input: RevokeSessionInput,
  deps: RevokeSessionDeps,
): Promise<Result<void, DomainError>> {
  const session = await deps.sessionRepository.findById(input.sessionId);

  if (session?.userId !== input.userId) {
    return err({ kind: 'NotFound' });
  }

  session.revoke('user_revoked', deps.clock.now());
  await deps.sessionRepository.save(session);

  return ok(undefined);
}
