import { describe, expect, it } from 'vitest';
import { withRollback } from '../testing.js';
import { PrismaOutboxRepository } from './outbox.repository.js';

describe('PrismaOutboxRepository', () => {
  it('appends a row carrying every field, unpublished by default', async () => {
    await withRollback(async (tx) => {
      const repository = new PrismaOutboxRepository(tx);

      await repository.append({
        eventType: 'UserRegistered',
        aggregateType: 'User',
        aggregateId: 'user-1',
        payload: { userId: 'user-1' },
        correlationId: 'correlation-1',
      });

      const rows = await tx.outboxEvent.findMany({ where: { aggregateId: 'user-1' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        eventType: 'UserRegistered',
        aggregateType: 'User',
        aggregateId: 'user-1',
        payload: { userId: 'user-1' },
        correlationId: 'correlation-1',
        publishedAt: null,
      });
    });
  });
});
