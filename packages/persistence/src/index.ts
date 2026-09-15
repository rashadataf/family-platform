import type { IdempotencyPort } from '@fp/kernel';
import type { calendar, family, identity } from '@fp/core';
import { prisma } from './client.js';
import { PrismaIdentityUnitOfWork } from './repositories/identity/identity-unit-of-work.js';
import { PrismaSessionRepository } from './repositories/identity/session.repository.js';
import { PrismaFamilyDirectory } from './repositories/family/family-directory.repository.js';
import { PrismaIdempotencyRepository } from './repositories/idempotency-key.repository.js';
import { eraseForFamily, eraseForMember } from './repositories/family/erasure.js';
import { PrismaMemberVisibility } from './repositories/family/member-visibility.js';
import { eraseCalendarForFamily, eraseCalendarForMember } from './repositories/calendar/erasure.js';

export { checkDatabaseHealth } from './health.js';
export { disconnectDatabase } from './lifecycle.js';
export {
  deleteDeletedAccountsBefore,
  deleteStaleSessionsBefore,
  deleteUnverifiedRegistrationsBefore,
} from './repositories/identity/retention.js';
export { expireOverdueInvitations } from './repositories/family/invitation-sweep.js';
export {
  findChildrenWithoutGuardian,
  type UncoveredChild,
} from './repositories/family/guardian-coverage.js';
export { eraseForFamily, eraseForMember };

/** Constitution Principle XI: the one implementation of `family.ErasurePort`. */
export function createErasurePort(): family.ErasurePort {
  return { eraseForFamily, eraseForMember };
}

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

export {
  createFamilyUnitOfWork,
  createAuditLog,
  createInvitationTokenLookup,
} from './family-context.js';
export { provisionDatabaseRoles } from './provision-roles.js';

/**
 * The cross-family membership list (FR-024). Bound to `app.user_id` rather
 * than to a family, because "which families am I in?" spans the tenant
 * boundary by definition — see the repository's own doc comment and
 * `20260913170000_self_and_token_policies`.
 */
export function createFamilyDirectory(): family.FamilyDirectoryPort {
  return new PrismaFamilyDirectory();
}

/** ADR-006, Principle IX: the one store behind every route's `Idempotency-Key` handling. */
export function createIdempotencyStore(): IdempotencyPort {
  return new PrismaIdempotencyRepository(prisma);
}

/**
 * Spec 009: the adapter behind Family's second published port. A new instance
 * per call site is fine — it holds no state, and must not: FR-016 evaluates
 * guardianship at read time, so nothing here may cache.
 */
export function createMemberVisibility(): family.MemberVisibilityPort {
  return new PrismaMemberVisibility();
}

export { createCalendarUnitOfWork } from './calendar-context.js';
export {
  findEventsDueForMaterialisation,
  findFamiliesWithPrunableOccurrences,
  measureCalendarHorizons,
  type DueEvent,
  type FamilyHorizon,
} from './repositories/calendar/materialisation-sweep.js';
export { eraseCalendarForFamily, eraseCalendarForMember };

/** Constitution Principle XI: the one implementation of `calendar.ErasurePort`. */
export function createCalendarErasurePort(): calendar.ErasurePort {
  return { eraseForFamily: eraseCalendarForFamily, eraseForMember: eraseCalendarForMember };
}
