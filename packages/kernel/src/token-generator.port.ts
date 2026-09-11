/**
 * Generic infrastructure capability. See password-hasher.port.ts for why this
 * lives in the kernel rather than under a context's own `application/ports`.
 *
 * Used for both session credentials and email verification links
 * (research.md §3): a 256-bit random value, plus a way to derive the hash
 * that is actually persisted (a database disclosure must not hand over a
 * live token or verification link).
 */
export interface TokenGeneratorPort {
  /** A cryptographically random opaque token, base64url-encoded. */
  generate(): string;
  /** The value stored and compared against — never the token itself. */
  hash(token: string): string;
}
