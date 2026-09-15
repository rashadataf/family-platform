import type { calendar } from '@fp/core';
import type { FamilyId } from '@fp/kernel';
import { prisma } from './client.js';
import { PrismaAuditLogRepository } from './repositories/compliance/audit-log.repository.js';
import { PrismaCalendarEventRepository } from './repositories/calendar/calendar-event.repository.js';
import { PrismaEventOccurrenceRepository } from './repositories/calendar/event-occurrence.repository.js';
import { PrismaEventParticipantRepository } from './repositories/calendar/event-participant.repository.js';
import { PrismaOutboxRepository } from './repositories/outbox.repository.js';

/**
 * ARCHITECTURE.md §9 layers 4 and 5 for the Calendar context, established by
 * one call (ADR-017) — `family-context.ts`'s pattern applied to a second
 * context, deliberately NOT a shared function: `withFamilyContext` constructs
 * Family's repositories, and a Calendar transaction must construct Calendar's
 * and be unable to reach Family's at all (FR-027).
 *
 * Everything `family-context.ts` says about `set_config(..., true)` applies
 * unchanged: the third argument is what makes the setting die with the
 * transaction instead of leaking onto the next request that reuses the pooled
 * connection, and `calendar-context.integration.spec.ts` asserts it again for
 * these tables.
 */
class PrismaCalendarUnitOfWork implements calendar.CalendarUnitOfWorkPort {
  async withCalendarFamilyContext<T>(
    familyId: FamilyId,
    work: (uow: calendar.CalendarUnitOfWork) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(
      async (tx) => {
        // First statement in the transaction, before anything can read a row.
        await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;

        return work({
          familyId,
          events: new PrismaCalendarEventRepository(tx, familyId),
          occurrences: new PrismaEventOccurrenceRepository(tx, familyId),
          participants: new PrismaEventParticipantRepository(tx, familyId),
          outbox: new PrismaOutboxRepository(tx),
          audit: new PrismaAuditLogRepository(tx),
        });
      },
      // A first materialisation writes up to ~800 rows for a daily series; the
      // default 5 s interactive-transaction timeout is tight on a cold pool.
      { timeout: 15_000 },
    );
  }
}

const calendarUnitOfWork = new PrismaCalendarUnitOfWork();

/**
 * The one door to Calendar's tables. A narrow factory rather than the class;
 * the repositories behind it are private to this package
 * (`calendar-repositories-are-private` in `.dependency-cruiser.cjs`).
 */
export function createCalendarUnitOfWork(): calendar.CalendarUnitOfWorkPort {
  return calendarUnitOfWork;
}
