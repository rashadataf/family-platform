import { withRollback, type TransactionClient } from '@fp/persistence/testing';

export type { TransactionClient };

/**
 * Runs a test body against a real database inside a transaction that is rolled
 * back afterwards (FR-018).
 *
 * The client comes from `@fp/persistence`, which owns the only PrismaClient in
 * the codebase and never exports it (ADR-003, Principle IV). This package adds
 * the test ergonomics; it does not open a second connection pool.
 */
export async function withDatabase<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return withRollback(work);
}
