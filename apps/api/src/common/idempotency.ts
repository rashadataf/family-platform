import { createHash } from 'node:crypto';

/**
 * ADR-006, Constitution Principle IX: every creating route accepts and
 * honours an `Idempotency-Key` header. Shared here rather than duplicated
 * per controller, the same way `per-account-throttler.guard.ts` and its
 * siblings are — the mechanism does not vary between the routes that need it.
 *
 * Not modelled as a ts-rest `headers` schema, for the same reason
 * `identity.contract.ts` gives for the `Authorization` header: a missing key
 * simply means "no idempotency protection for this call" rather than a
 * request-validation failure, so it has to be read manually.
 */
export function readIdempotencyKey(headers: { 'idempotency-key'?: string }): string | null {
  const value = headers['idempotency-key'];
  return value !== undefined && value.trim() !== '' ? value : null;
}

/**
 * Scoped by route name as well as body: two different creating routes must
 * never collide on a key a client happened to reuse across both.
 */
export function hashIdempotentRequest(routeName: string, body: unknown): string {
  return createHash('sha256').update(routeName).update(JSON.stringify(body)).digest('hex');
}
