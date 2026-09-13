import { withCommit, withRollback, type TransactionClient } from '@fp/persistence/testing';

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

/**
 * The committing counterpart to `withDatabase`, for the one case rollback
 * cannot cover: seeding a fixture an apps/api integration test needs a
 * *separately connected* running app to see. A rolled-back write is invisible
 * to any transaction but its own; a route handler's `withFamilyContext` opens
 * its own. Left uncleaned deliberately, the same way every apps/api
 * integration test that calls a real HTTP route already leaves a real
 * committed row behind rather than rolling one back — random ids keep runs
 * from colliding, not a truncate.
 */
export async function withDatabaseCommitted<T>(
  work: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return withCommit(work);
}
