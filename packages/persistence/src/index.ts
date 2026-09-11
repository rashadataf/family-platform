import type { identity } from '@fp/core';
import { prisma } from './client.js';
import { PrismaIdentityUnitOfWork } from './repositories/identity/identity-unit-of-work.js';

export { checkDatabaseHealth } from './health.js';
export { disconnectDatabase } from './lifecycle.js';
export { deleteUnverifiedRegistrationsBefore } from './repositories/identity/retention.js';

/**
 * The one place a composition root reaches for identity's unit of work. The
 * real `PrismaClient` never leaves this package (ADR-003, Principle IV) —
 * this factory closes over it instead of handing it out.
 */
export function createIdentityUnitOfWork(): identity.IdentityUnitOfWorkPort {
  return new PrismaIdentityUnitOfWork(prisma);
}
