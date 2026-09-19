import type { ProcessedEventPort } from '@fp/kernel';
import { type Prisma, type PrismaClient } from '../generated/prisma/index.js';

/**
 * ADR-005 Layer 3, FR-011. Lives at the top level of `repositories/`, the
 * same as `PrismaIdempotencyRepository`, for the same reason — the
 * consumer-side idempotency check is a platform mechanism, not owned by any
 * one bounded context.
 *
 * Constructor takes `PrismaClient | Prisma.TransactionClient`, exactly as
 * `PrismaOutboxRepository` already does: a caller with its own unit of work
 * constructs this against that same transaction client to get
 * same-transaction atomicity (contracts/relay-interfaces.md §4). `SqsConsumer`'s
 * own default sequence constructs it against the bare `PrismaClient` instead.
 */
export class PrismaProcessedEventRepository implements ProcessedEventPort {
  constructor(private readonly client: PrismaClient | Prisma.TransactionClient) {}

  async wasProcessed(queueName: string, eventId: string): Promise<boolean> {
    const row = await this.client.processedEvent.findUnique({
      where: { queueName_eventId: { queueName, eventId } },
    });
    return row !== null;
  }

  /** An `upsert` with a no-op `update`, so a duplicate call is not an error. */
  async markProcessed(queueName: string, eventId: string): Promise<void> {
    await this.client.processedEvent.upsert({
      where: { queueName_eventId: { queueName, eventId } },
      create: { queueName, eventId },
      update: {},
    });
  }
}
