import { randomUUID } from 'node:crypto';
import type { TransactionClient } from './transaction.js';

/**
 * Outbox relay fixtures (spec 011). Neither `outbox_event` nor
 * `processed_event` is family-scoped (data-model.md), so — unlike
 * `tasks-factories.ts`/`calendar-factories.ts` — nothing here needs
 * `scopeTo`; a bare `tx` is enough.
 *
 * Seed with `withDatabaseCommitted`, not `withDatabase`: `claimUnpublishedOutboxEvents`
 * opens its own top-level transaction against a separate connection
 * (`outbox-relay.repository.ts`'s own doc comment explains why), which
 * cannot see a row seeded inside a transaction `withDatabase` is going to
 * roll back. This is the same reasoning `withCommit`'s own doc comment gives
 * for apps/api's integration tests.
 */

/** Structural, not `@fp/kernel`'s `JsonValue` — this package depends only on `packages/persistence`. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface SeededOutboxEvent {
  readonly id: string;
}

export async function seedOutboxEvent(
  tx: TransactionClient,
  params: {
    eventType: string;
    aggregateType?: string;
    aggregateId?: string;
    payload?: Record<string, JsonValue>;
    correlationId?: string;
    occurredAt?: Date;
    /** Defaults to unpublished (`null`) — the claimable state every US1 test starts from. */
    publishedAt?: Date | null;
  },
): Promise<SeededOutboxEvent> {
  const row = await tx.outboxEvent.create({
    data: {
      eventType: params.eventType,
      aggregateType: params.aggregateType ?? 'RelayFixture',
      aggregateId: params.aggregateId ?? randomUUID(),
      payload: params.payload ?? {},
      correlationId: params.correlationId ?? randomUUID(),
      occurredAt: params.occurredAt ?? new Date(),
      publishedAt: params.publishedAt ?? null,
    },
  });
  return { id: row.id };
}

export interface SeededProcessedEvent {
  readonly id: string;
}

export async function seedProcessedEvent(
  tx: TransactionClient,
  params: { queueName: string; eventId: string; processedAt?: Date },
): Promise<SeededProcessedEvent> {
  const row = await tx.processedEvent.create({
    data: {
      queueName: params.queueName,
      eventId: params.eventId,
      processedAt: params.processedAt ?? new Date(),
    },
  });
  return { id: row.id };
}
