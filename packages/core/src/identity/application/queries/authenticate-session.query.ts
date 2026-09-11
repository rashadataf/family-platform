import {
  err,
  ok,
  type Clock,
  type DomainError,
  type Result,
  type SessionId,
  type TokenGeneratorPort,
  type UserId,
} from '@fp/kernel';
import type { SessionRepository } from '../ports/session.repository.js';

export interface AuthenticateSessionInput {
  token: string;
}

export interface AuthenticateSessionDeps {
  sessionRepository: SessionRepository;
  tokenGenerator: TokenGeneratorPort;
  clock: Clock;
}

export interface SessionContext {
  userId: UserId;
  sessionId: SessionId;
}

/**
 * FR-023's per-request check: revocation and the owning account's status are
 * re-verified on every use, not only at issuance. One repository call
 * (`findAuthContextByTokenHash`) supplies both the session and its owner's
 * current status, keeping this within research.md §8's <5ms budget.
 */
export async function authenticateSession(
  input: AuthenticateSessionInput,
  deps: AuthenticateSessionDeps,
): Promise<Result<SessionContext, DomainError>> {
  const tokenHash = deps.tokenGenerator.hash(input.token);
  const context = await deps.sessionRepository.findAuthContextByTokenHash(tokenHash);

  if (!context) {
    return err({ kind: 'SessionInvalid' });
  }

  const now = deps.clock.now();
  if (!context.session.isUsable(now) || context.userStatus !== 'active') {
    return err({ kind: 'SessionInvalid' });
  }

  return ok({ userId: context.session.userId, sessionId: context.session.id });
}
