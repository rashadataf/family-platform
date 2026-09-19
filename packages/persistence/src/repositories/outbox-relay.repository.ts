import type { JsonValue } from '@fp/kernel';
import { prisma } from '../client.js';
import type { Prisma, PrismaClient } from '../generated/prisma/index.js';

export interface ClaimedOutboxEvent {
  readonly id: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, JsonValue>;
  readonly occurredAt: Date;
  readonly correlationId: string;
}

interface RawClaimedRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  occurred_at: Date;
  correlation_id: string;
}

function toClaimedOutboxEvent(row: RawClaimedRow): ClaimedOutboxEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: row.payload as Record<string, JsonValue>,
    occurredAt: row.occurred_at,
    correlationId: row.correlation_id,
  };
}

/**
 * FR-023/SC-002/SC-003 (spec 011), data-model.md's lifecycle diagram: the
 * claim, every `send`, and the mark all have to be ONE database transaction —
 * releasing the `FOR UPDATE SKIP LOCKED` row lock before marking would let a
 * concurrent tick re-claim and re-send the same row, and marking on a second
 * connection while this one still holds the lock would deadlock against
 * itself. Prisma's interactive transactions only stay open for the lifetime
 * of a single callback, and the `PrismaClient` singleton this package
 * instantiates never leaves it (ADR-003, Principle IV) — so `apps/worker`
 * cannot open its own transaction here. This function is therefore the one
 * that opens it, and `work` is where the caller's own claim-scoped logic
 * (resolving destinations, calling `MessagePublisherPort.send`, deciding what
 * finished) runs, still inside it. `markPublished`, handed to `work` bound to
 * this same transaction, is how a row actually gets marked before it
 * commits — the crash-and-resume test (T025) is what happens when `work`
 * never reaches that call: the transaction rolls back, `published_at` stays
 * `NULL`, and the row is claimable again on the next tick.
 */
export async function claimUnpublishedOutboxEvents<T>(
  limit: number,
  work: (
    claimed: readonly ClaimedOutboxEvent[],
    markPublished: (ids: readonly string[]) => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<RawClaimedRow[]>`
        SELECT "id", "event_type", "aggregate_type", "aggregate_id", "payload", "occurred_at", "correlation_id"
        FROM "outbox_event"
        WHERE "published_at" IS NULL
        ORDER BY "occurred_at" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
      const claimed = rows.map(toClaimedOutboxEvent);
      return work(claimed, (ids) => markOutboxEventsPublished(tx, ids));
    },
    // Publishing involves network calls (SQS/ElasticMQ), well past Prisma's
    // default 5s interactive-transaction timeout.
    { timeout: 30_000 },
  );
}

/**
 * Takes `PrismaClient | Prisma.TransactionClient`, exactly as
 * `PrismaOutboxRepository` and `PrismaProcessedEventRepository` do — called
 * with the transaction `claimUnpublishedOutboxEvents` opened, via the
 * `markPublished` closure it hands to `work`, for every row that finished
 * successfully.
 */
export async function markOutboxEventsPublished(
  client: PrismaClient | Prisma.TransactionClient,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await client.outboxEvent.updateMany({
    where: { id: { in: [...ids] } },
    data: { publishedAt: new Date() },
  });
}

/**
 * FR-016/FR-025: how far behind the relay is — `now − min(occurred_at)` over
 * rows still unpublished. `0` when nothing is outstanding. Mirrors
 * `measureOverdueLag` (`repositories/tasks/overdue-sweep.ts`) exactly; reads
 * outside any claim transaction, so it reports what a tick could not fix.
 */
export async function measureOutboxLag(now: Date): Promise<number> {
  const rows = await prisma.$queryRaw<{ oldest_occurred_at: Date | null }[]>`
    SELECT min("occurred_at") AS "oldest_occurred_at"
    FROM "outbox_event"
    WHERE "published_at" IS NULL
  `;
  const oldest = rows[0]?.oldest_occurred_at ?? null;
  return oldest === null ? 0 : Math.max(0, Math.round((now.getTime() - oldest.getTime()) / 1000));
}
