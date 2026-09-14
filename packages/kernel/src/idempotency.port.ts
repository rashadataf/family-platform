import type { JsonValue } from './outbox.port.js';
import type { UserId } from './branded-id.js';

/**
 * ADR-006, Principle IX: `Idempotency-Key` is required on every creating
 * route, because a mobile client retries aggressively on a flaky connection
 * and a second, identical `POST` must not create a second resource. Declared
 * here for the same reason `OutboxPort` is — the mechanism is identical for
 * every bounded context, so a per-context copy would just be duplication
 * waiting to drift. `packages/persistence` provides the one implementation.
 *
 * Scoped by `userId`, not by tenant: the route this protects first
 * (`POST /v1/families`) runs before any family exists to scope to, and a key
 * is only ever meaningful relative to the caller who chose it — two different
 * users reusing the same key string by coincidence must not collide.
 */
export interface IdempotencyRecord {
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: JsonValue;
}

export interface IdempotencyPort {
  /** The stored outcome of an earlier request under this key, or `null` on first use. */
  findByKey(userId: UserId, key: string): Promise<IdempotencyRecord | null>;

  /** Records the outcome of a request handled for the first time under this key. */
  save(entry: {
    userId: UserId;
    key: string;
    requestHash: string;
    responseStatus: number;
    responseBody: JsonValue;
  }): Promise<void>;
}
