import type { IdempotencyPort, IdempotencyRecord, JsonValue, UserId } from '@fp/kernel';
import { Prisma, type PrismaClient } from '../generated/prisma/index.js';

/**
 * `JsonValue` admits a bare `null`; Prisma's generated input type for this
 * NOT NULL `jsonb` column does not, and wants its own `JsonNull` sentinel
 * instead. Every response this repository actually stores is an object, so
 * this only exists to satisfy the type, not because `null` is a real case.
 */
function toInputJson(value: JsonValue): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value ?? Prisma.JsonNull;
}

/**
 * ADR-006, Principle IX. Shared across every future creating route, not
 * family-specific — see `IdempotencyPort`'s own comment in packages/kernel.
 * Lives at the top level of `repositories/`, the same as `PrismaOutboxRepository`.
 *
 * Ordinary Prisma calls, unlike `PrismaAuditLogRepository`: the grant on this
 * table is SELECT and INSERT (no UPDATE, no DELETE — a key is written once and
 * never revised), so `create()`'s `RETURNING` is covered and there is no
 * conflict to route around with raw SQL.
 */
export class PrismaIdempotencyRepository implements IdempotencyPort {
  constructor(private readonly client: PrismaClient | Prisma.TransactionClient) {}

  async findByKey(userId: UserId, key: string): Promise<IdempotencyRecord | null> {
    const row = await this.client.idempotencyKey.findUnique({
      where: { userId_key: { userId, key } },
    });
    if (row === null) return null;

    return {
      requestHash: row.requestHash,
      responseStatus: row.responseStatus,
      responseBody: row.responseBody as JsonValue,
    };
  }

  async save(entry: {
    userId: UserId;
    key: string;
    requestHash: string;
    responseStatus: number;
    responseBody: JsonValue;
  }): Promise<void> {
    await this.client.idempotencyKey.create({
      data: {
        userId: entry.userId,
        key: entry.key,
        requestHash: entry.requestHash,
        responseStatus: entry.responseStatus,
        responseBody: toInputJson(entry.responseBody),
      },
    });
  }
}
