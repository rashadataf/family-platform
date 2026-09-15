import { Logger, Module } from '@nestjs/common';
import type { family } from '@fp/core';
import { SystemClock } from '@fp/platform';
import {
  createCalendarUnitOfWork,
  createIdempotencyStore,
  createMemberVisibility,
} from '@fp/persistence';
import { FamilyModule } from '../family/family.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { CalendarController } from './calendar.controller.js';
import {
  CALENDAR_CLOCK,
  CALENDAR_IDEMPOTENCY_STORE,
  CALENDAR_UNIT_OF_WORK,
  MEMBER_VISIBILITY,
} from './calendar.tokens.js';

/**
 * `member_visibility_resolve_duration` (contracts/calendar-api.md) — against
 * research.md §11's 2 ms budget. A structured log line, the convention spec 008
 * set for a platform with no metrics pipeline yet. Identifiers only.
 */
function timedMemberVisibility(port: family.MemberVisibilityPort): family.MemberVisibilityPort {
  const logger = new Logger('MemberVisibility');
  return {
    async resolveVisibleMemberIds(viewerMemberId, familyId) {
      const startedAt = performance.now();
      try {
        return await port.resolveVisibleMemberIds(viewerMemberId, familyId);
      } finally {
        logger.log(
          `member_visibility_resolve_duration_ms=${(performance.now() - startedAt).toFixed(1)}`,
        );
      }
    },
  };
}

/**
 * The composition root for Calendar. Thin: it wires adapters to ports and
 * holds no logic (ARCHITECTURE.md §6).
 *
 * It adds NO guard. `SessionGuard` comes from `IdentityModule`, and
 * `FamilyMembershipGuard` and `CapabilityGuard` come from `FamilyModule`
 * unchanged — layers 2 and 3 are the tenant root's, and a second context
 * consuming them is the point of having built them once (tasks.md T018).
 */
@Module({
  imports: [IdentityModule, FamilyModule],
  controllers: [CalendarController],
  providers: [
    { provide: CALENDAR_CLOCK, useClass: SystemClock },
    { provide: CALENDAR_UNIT_OF_WORK, useFactory: () => createCalendarUnitOfWork() },
    {
      provide: MEMBER_VISIBILITY,
      useFactory: () => timedMemberVisibility(createMemberVisibility()),
    },
    { provide: CALENDAR_IDEMPOTENCY_STORE, useFactory: () => createIdempotencyStore() },
  ],
})
export class CalendarModule {}
