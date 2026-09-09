/**
 * The integration-test harness (FR-017 - FR-021).
 *
 * Deliberately does NOT export a Prisma client. `packages/persistence` owns
 * the single instantiation and never exposes it (ADR-003, Principle IV); a
 * harness that handed one out would be a second door into the database with
 * none of the family-scoping the first one will carry.
 */
export { prepareTestDatabase, resolveTestDatabase, type TestDatabase } from './database.js';
export { withDatabase, type TransactionClient } from './transaction.js';
