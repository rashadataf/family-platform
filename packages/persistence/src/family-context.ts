import type { family } from '@fp/core';
import type { FamilyId } from '@fp/kernel';
import { prisma } from './client.js';
import { PrismaAuditLogRepository } from './repositories/compliance/audit-log.repository.js';
import { PrismaOutboxRepository } from './repositories/outbox.repository.js';

/**
 * ARCHITECTURE.md §9 layers 4 and 5, established by one call (ADR-017).
 *
 * Opens a transaction, binds `app.family_id` to it as its FIRST statement, and
 * constructs every family repository against that same transaction client. The
 * row-level security policies on all four family-scoped tables read that
 * setting, so a repository built here is scoped twice over: once because its
 * methods take no family parameter, and once because the database will not
 * return another family's rows to this transaction whatever it is asked.
 *
 * ## Why `set_config(..., true)` and not `SET LOCAL`
 *
 * `SET LOCAL app.family_id = '…'` takes a literal, not a bind parameter, so it
 * would mean interpolating a value into SQL. `set_config(name, value, true)`
 * has identical transaction-local semantics and takes the family id as a bound
 * parameter.
 *
 * The third argument is what makes it local. Without it the setting outlives
 * the transaction and leaks one request's scope onto the next transaction that
 * reuses the pooled connection — one family reading another's rows, with no
 * error anywhere. That is the single worst failure this mechanism can have,
 * and it has its own integration test (`family-context.integration.spec.ts`)
 * because no functional test would ever notice it.
 *
 * ## Why not the Prisma client extension the old TODO described
 *
 * A `$extends({ query: { $allOperations } })` hook wraps ONE operation. For the
 * setting to cover the query it protects, the two must share a transaction, so
 * the extension would have to open a transaction per operation — silently
 * making a two-statement command non-atomic and defeating the unit of work.
 * The setting is per transaction, so the thing that establishes it has to be
 * per transaction too.
 */
class PrismaFamilyUnitOfWork implements family.FamilyUnitOfWorkPort {
  async withFamilyContext<T>(
    familyId: FamilyId,
    work: (uow: family.FamilyUnitOfWork) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      // First statement in the transaction, before anything can read a row.
      await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;

      return work({
        familyId,
        outbox: new PrismaOutboxRepository(tx),
        audit: new PrismaAuditLogRepository(tx),
      });
    });
  }
}

const familyUnitOfWork = new PrismaFamilyUnitOfWork();

/**
 * The one door to family-scoped data. Exported as a narrow factory rather than
 * as the class, and the repositories behind it are private to this package —
 * `family-repositories-are-private` in `.dependency-cruiser.cjs` enforces that,
 * because FR-020 makes this context the only means by which any part of the
 * platform reads family data.
 */
export function createFamilyUnitOfWork(): family.FamilyUnitOfWorkPort {
  return familyUnitOfWork;
}

/**
 * The audit sink for the paths that have no transaction to join — a denial,
 * where nothing was written and there is nothing to be atomic with.
 */
export function createAuditLog(): import('@fp/core').compliance.AuditLogPort {
  return new PrismaAuditLogRepository(prisma);
}
