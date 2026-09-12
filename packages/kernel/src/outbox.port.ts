/**
 * ADR-005 Layer 2. Declared in the kernel, not under a context's own
 * `application/ports`, because the outbox is the same mechanism for every
 * bounded context (ARCHITECTURE.md §7.3) — the fields below are already
 * generic (`aggregateType` names the context's own aggregate), so a
 * per-context copy of this interface would just be duplication waiting to
 * drift. `packages/persistence` provides the one implementation, shared by
 * every context, writing inside the caller's own transaction.
 */
/** A value that survives a JSON round trip — what a queue message payload must be. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface OutboxEventToAppend {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  /** Identifiers and correlation metadata only — never personal data (Principle VI, VIII). */
  payload: Record<string, JsonValue>;
  correlationId: string;
}

export interface OutboxPort {
  append(event: OutboxEventToAppend): Promise<void>;
}
