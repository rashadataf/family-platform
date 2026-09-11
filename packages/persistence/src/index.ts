import type { identity } from '@fp/core';
import { prisma } from './client.js';
import { PrismaIdentityUnitOfWork } from './repositories/identity/identity-unit-of-work.js';
import { PrismaSessionRepository } from './repositories/identity/session.repository.js';

export { checkDatabaseHealth } from './health.js';
export { disconnectDatabase } from './lifecycle.js';
export {
  deleteDeletedAccountsBefore,
  deleteStaleSessionsBefore,
  deleteUnverifiedRegistrationsBefore,
} from './repositories/identity/retention.js';

/**
 * The one place a composition root reaches for identity's unit of work. The
 * real `PrismaClient` never leaves this package (ADR-003, Principle IV) —
 * this factory closes over it instead of handing it out.
 */
export function createIdentityUnitOfWork(): identity.IdentityUnitOfWorkPort {
  return new PrismaIdentityUnitOfWork(prisma);
}

/**
 * A standalone (non-transactional) session repository for the FR-023 guard,
 * which only ever reads — opening a transaction for a single lookup on
 * every authenticated request would cost more than it protects.
 */
export function createSessionRepository(): identity.SessionRepository {
  return new PrismaSessionRepository(prisma);
}
