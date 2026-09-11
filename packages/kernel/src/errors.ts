import type { SessionId } from './branded-id.js';

/**
 * The domain error taxonomy shared across contexts. Each context's
 * application layer returns one of these as a `Result` error rather than
 * throwing an arbitrary `Error`, so a caller can exhaustively switch on
 * `error.kind` (Principle I: discriminated unions over
 * optional-field-plus-type-string modelling). Construct these as plain
 * object literals at the call site — the discriminant alone gives full type
 * checking with no helper or cast needed.
 */
export type DomainError =
  | { readonly kind: 'EmailAlreadyRegistered' }
  | { readonly kind: 'WeakPassword'; readonly reason: string }
  | { readonly kind: 'InvalidCredentials' }
  | { readonly kind: 'AccountNotVerified' }
  | { readonly kind: 'Throttled'; readonly retryAfterSeconds: number }
  | { readonly kind: 'SessionInvalid' }
  /**
   * FR-011: a superseded credential was presented. Wire-visible behaviour is
   * identical to `SessionInvalid` (contracts/identity-api.md: the caller is
   * never told a replay was detected) — this exists only so the composition
   * root can log or alert on it distinctly from an ordinary invalid session.
   */
  | { readonly kind: 'SessionReplayDetected'; readonly sessionId: SessionId }
  | { readonly kind: 'VerificationInvalid' }
  | { readonly kind: 'NotFound' };
