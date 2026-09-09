import { prisma } from './client.js';
import type { Prisma } from './generated/prisma/index.js';

/**
 * Test support. Deliberately a separate entry point (`@fp/persistence/testing`)
 * rather than part of the package's main surface.
 *
 * `client.ts` never exports the PrismaClient (ADR-003, Principle IV), which
 * means nothing outside this package can open a transaction — including the
 * test harness, which needs to. Putting the mechanism here rather than
 * exporting the client keeps the single-instantiation rule intact: the package
 * that owns the client owns the only way to roll it back.
 *
 * `packages/testing` wraps this. The boundary rule `harness-is-test-only`
 * keeps the wrapper out of production modules.
 */

/** The client Prisma hands to a `$transaction` callback. */
export type TransactionClient = Prisma.TransactionClient;

/**
 * Thrown to force a rollback, and swallowed again by `withRollback`. Prisma
 * rolls back an interactive transaction when its callback throws, and there is
 * no supported way to ask for a rollback without throwing.
 */
class Rollback extends Error {
  constructor() {
    super('rollback');
    this.name = 'Rollback';
  }
}

/**
 * Runs `work` inside a transaction that is always rolled back (FR-018).
 *
 * Every test therefore starts from the committed migration state and leaves
 * nothing behind, at the cost of one transaction rather than a truncate or a
 * database rebuild. It also makes parallel tests safe by construction: no test
 * can observe another's uncommitted rows.
 *
 * The one thing it cannot isolate is code that commits its own transaction.
 * A repository that opens `$transaction` itself will nest, and Prisma does not
 * support nested interactive transactions — such a test needs the truncating
 * variant instead, which does not exist yet because nothing needs it.
 */
export async function withRollback<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
  // A box rather than a `T | undefined`, so that a body legitimately returning
  // undefined is not mistaken for one that never ran.
  let outcome: { value: T } | undefined;

  try {
    await prisma.$transaction(async (tx) => {
      outcome = { value: await work(tx) };
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  if (outcome === undefined) {
    throw new Error('withRollback: the transaction ended without the work completing.');
  }
  return outcome.value;
}

/** Proves the connection is live and the schema is present. */
export async function assertMigrated(): Promise<void> {
  await prisma.$queryRaw`SELECT 1 FROM "_prisma_migrations" LIMIT 1`;
}
