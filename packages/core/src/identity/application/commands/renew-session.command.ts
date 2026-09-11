import {
  err,
  ok,
  type Clock,
  type DomainError,
  type Result,
  type SessionId,
  type TokenGeneratorPort,
} from '@fp/kernel';
import type { SessionRepository } from '../ports/session.repository.js';

export interface RenewSessionInput {
  token: string;
}

export interface RenewSessionDeps {
  sessionRepository: SessionRepository;
  tokenGenerator: TokenGeneratorPort;
  clock: Clock;
}

export interface RenewedSession {
  sessionId: SessionId;
  token: string;
  issuedAt: Date;
  absoluteExpiresAt: Date;
}

/**
 * FR-010/FR-011/FR-013: rotates the presented credential to a fresh one
 * under the same `SessionId`, refusing once the session is unusable — which
 * covers FR-013's absolute-lifetime ceiling via `Session.rotate()` itself.
 * A presented credential matching the *immediately-superseded* hash is
 * treated as a possible compromise: the whole session is revoked on the
 * spot (FR-011), never merely rejected as if it were an ordinary invalid
 * token.
 */
export async function renewSession(
  input: RenewSessionInput,
  deps: RenewSessionDeps,
): Promise<Result<RenewedSession, DomainError>> {
  const tokenHash = deps.tokenGenerator.hash(input.token);
  const match = await deps.sessionRepository.findByCurrentOrPreviousTokenHash(tokenHash);

  if (!match) {
    return err({ kind: 'SessionInvalid' });
  }

  const now = deps.clock.now();

  if (match.matchedPrevious) {
    match.session.revoke('replay_detected', now);
    await deps.sessionRepository.save(match.session);
    return err({ kind: 'SessionReplayDetected', sessionId: match.session.id });
  }

  const rawToken = deps.tokenGenerator.generate();
  const newTokenHash = deps.tokenGenerator.hash(rawToken);
  const rotateResult = match.session.rotate(newTokenHash, now);
  if (!rotateResult.ok) {
    return rotateResult;
  }

  await deps.sessionRepository.save(match.session);

  return ok({
    sessionId: match.session.id,
    token: rawToken,
    issuedAt: match.session.issuedAt,
    absoluteExpiresAt: match.session.absoluteExpiresAt,
  });
}
