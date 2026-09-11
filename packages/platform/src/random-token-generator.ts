import { randomBytes, createHash } from 'node:crypto';
import type { TokenGeneratorPort } from '@fp/kernel';

/**
 * 256-bit opaque tokens for both session credentials and verification links
 * (research.md §3). `hash()` returns a hex string rather than a Buffer, so
 * the port stays storage-agnostic — the persistence layer converts to/from
 * the `bytea` column.
 */
export class RandomTokenGenerator implements TokenGeneratorPort {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
