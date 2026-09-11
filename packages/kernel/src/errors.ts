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
  | { readonly kind: 'VerificationInvalid' }
  | { readonly kind: 'NotFound' };
