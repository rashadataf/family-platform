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
 * Parameters below are placeholders pending a real measurement against the
 * Stage 0 VPS (research.md §8's budget: ~100ms of the 300ms p95 auth
 * endpoint target). T090 replaces this comment with the measured values.
 */
const PARAMETERS = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
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
