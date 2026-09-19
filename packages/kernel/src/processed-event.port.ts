/**
 * ADR-005 Layer 3, Principle VIII. Declared here for the same reason
 * `MessagePublisherPort` is — the consumer-side idempotency check is the
 * same mechanism for every queue and every future consumer. Implemented
 * once, by `packages/persistence`'s `PrismaProcessedEventRepository`,
 * against the `processed_event` table (data-model.md).
 *
 * Takes `PrismaClient | Prisma.TransactionClient` in its constructor,
 * exactly as `PrismaOutboxRepository` already does: a caller with its own
 * unit of work constructs its implementation against that same transaction
 * client to get same-transaction atomicity (contracts/relay-interfaces.md
 * §4). `SqsConsumer`'s own default sequence does not do this — it is a
 * known, accepted limitation of that default path, not of this port.
 */
export interface ProcessedEventPort {
  /** `true` if this (queue, event) pair has already been handled. */
  wasProcessed(queueName: string, eventId: string): Promise<boolean>;

  /** Records that it now has. A duplicate call is not an error. */
  markProcessed(queueName: string, eventId: string): Promise<void>;
}
