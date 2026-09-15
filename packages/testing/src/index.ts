/**
 * The integration-test harness (FR-017 - FR-021).
 *
 * Deliberately does NOT export a Prisma client. `packages/persistence` owns
 * the single instantiation and never exposes it (ADR-003, Principle IV); a
 * harness that handed one out would be a second door into the database with
 * none of the family-scoping the first one will carry.
 */
export {
  prepareTestDatabase,
  resolveTestDatabase,
  resolvedTestDatabaseOwnerUrl,
  type TestDatabase,
} from './database.js';
export { withDatabase, withDatabaseCommitted, type TransactionClient } from './transaction.js';
export {
  scopeTo,
  seedChild,
  seedFamily,
  seedMember,
  type SeededFamily,
} from './family-factories.js';
export { readAuditLogRows, type RawAuditRow } from './audit-log.js';
export {
  fixedClock,
  seedAllDayEvent,
  seedTimedEvent,
  seedWeeklyEvent,
  UK_FALL_BACK_2026,
  UK_SPRING_FORWARD_2026,
  type FixedClock,
  type SeededEvent,
} from './calendar-factories.js';
