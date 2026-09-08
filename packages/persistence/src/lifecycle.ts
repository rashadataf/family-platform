import { prisma } from './client.js';

/**
 * Closes the database connection pool. Called by the host application during
 * shutdown (FR-009).
 *
 * Deliberately a plain function, not a NestJS provider. `packages/persistence`
 * holds repository implementations and the Prisma client; ARCHITECTURE.md §8
 * puts DI wiring in `apps/api` ("Thin. Controllers, guards, DI wiring."), and
 * adding @nestjs/common here would make an infrastructure package depend on
 * the HTTP framework in order to expose a two-line lifecycle hook. The Nest
 * adapter lives in apps/api/src/persistence/ instead.
 *
 * `client.ts` never exports the PrismaClient itself (ADR-003, Principle IV),
 * so this is the only way the pool can be closed from outside.
 */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
