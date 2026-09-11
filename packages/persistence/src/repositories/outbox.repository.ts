import type { OutboxEventToAppend, OutboxPort } from '@fp/kernel';
import type { Prisma, PrismaClient } from '../generated/prisma/index.js';

/**
 * Shared across every future bounded context, not identity-specific — see
 * `OutboxPort`'s own comment in packages/kernel. Lives at the top level of
 * `repositories/`, not under `repositories/identity/`, for the same reason.
 *
 * Takes a plain `PrismaClient` or an open `Prisma.TransactionClient`
 * (constructor injection) so a command handler's unit of work can construct
 * this against the SAME transaction as its aggregate write — the whole point
 * of ADR-005 Layer 2 is that both writes commit or fail together.
 */
export class PrismaOutboxRepository implements OutboxPort {
  constructor(private readonly client: PrismaClient | Prisma.TransactionClient) {}

  async append(event: OutboxEventToAppend): Promise<void> {
    await this.client.outboxEvent.create({
      data: {
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        correlationId: event.correlationId,
      },
    });
  }
}
