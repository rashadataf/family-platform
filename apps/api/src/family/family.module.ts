import { Module } from '@nestjs/common';
import { SystemClock } from '@fp/platform';
import { createAuditLog, createFamilyUnitOfWork } from '@fp/persistence';
import { IdentityModule } from '../identity/identity.module.js';
import { CapabilityGuard } from './capability.guard.js';
import { FamilyMembershipGuard } from './family-membership.guard.js';
import { AUDIT_LOG, FAMILY_CLOCK, FAMILY_UNIT_OF_WORK } from './family.tokens.js';

/**
 * The composition root for Family and Membership. Thin by design: it wires
 * adapters to ports and holds no logic of its own (ARCHITECTURE.md §6 — NestJS
 * is a composition and transport framework here, not an application one).
 *
 * `IdentityModule` is imported for `SessionGuard`, which every family route
 * runs before this module's own guards: authentication answers who, and only
 * then does layer 2 answer whether.
 */
@Module({
  imports: [IdentityModule],
  providers: [
    { provide: FAMILY_CLOCK, useClass: SystemClock },
    { provide: FAMILY_UNIT_OF_WORK, useFactory: () => createFamilyUnitOfWork() },
    { provide: AUDIT_LOG, useFactory: () => createAuditLog() },
    FamilyMembershipGuard,
    CapabilityGuard,
  ],
  exports: [FAMILY_CLOCK, FAMILY_UNIT_OF_WORK, AUDIT_LOG, FamilyMembershipGuard, CapabilityGuard],
})
export class FamilyModule {}
