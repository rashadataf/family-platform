import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasherPort } from '@fp/kernel';

/**
 * argon2id via `@node-rs/argon2` (research.md §2): OWASP's current
 * recommendation, and prebuilt native binaries mean no `node-gyp` at image
 * build time (ADR-014).
 *
 * `algorithm: 2` is `Algorithm.Argon2id` — the numeric literal is used
 * directly rather than importing the enum because `@node-rs/argon2` declares
 * it as an ambient `const enum`, which `verbatimModuleSyntax` (Principle I)
 * cannot import as a value.
 *
 * Parameters (T090): OWASP's strongest standard argon2id recommendation,
 * measured directly against the Stage 0 VPS (82.165.181.83, x86_64) on
 * 2026-09-12 via an ephemeral `node:20-slim` container — verify p50 31.5ms /
 * p95 59.2ms over 30 iterations, comfortably inside research.md §8's ~100ms
 * budget with headroom for load from the portfolio site sharing that VPS.
 * The four weaker OWASP options were also measured (verify p95 12-20ms) and
 * rejected only because this one buys more security for the same budget.
 */
const PARAMETERS = {
  algorithm: 2,
  memoryCost: 47104,
  timeCost: 1,
  parallelism: 1,
};

export class Argon2PasswordHasher implements PasswordHasherPort {
  async hash(plaintext: string): Promise<string> {
    return hash(plaintext, PARAMETERS);
  }

  async verify(plaintext: string, digest: string): Promise<boolean> {
    return verify(digest, plaintext);
  }
}
