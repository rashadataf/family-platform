import type { FamilyId, OutboxPort } from '@fp/kernel';
import type { AuditLogPort } from '../../../compliance/application/ports/audit-log.port.js';
import type { CalendarEventRepository } from './calendar-event.repository.js';
import type { EventOccurrenceRepository } from './event-occurrence.repository.js';
import type { EventParticipantRepository } from './event-participant.repository.js';

/**
 * One transaction's worth of Calendar repositories, all scoped to a single
 * family BY CONSTRUCTION — `family-unit-of-work.port.ts`'s shape, one context
 * over (ARCHITECTURE.md §9 layer 4). No method on any repository below takes a
 * family identifier, so the unscoped query is not expressible.
 *
 * A separate unit of work from Family's, not a shared one: a context owns its
 * own transaction and its own repositories, and Calendar's must not be able to
 * reach a Family repository even by accident (FR-027).
 *
 * `audit` is here because a permitted read of a child's participation is
 * audited in the same transaction as the read (Principle VI), exactly as
 * Family's unit of work does it.
 */
export interface CalendarUnitOfWork {
  /** Exposed for event payloads — never as an argument to a repository call. */
  readonly familyId: FamilyId;
  events: CalendarEventRepository;
  occurrences: EventOccurrenceRepository;
  participants: EventParticipantRepository;
  outbox: OutboxPort;
  audit: AuditLogPort;
}

export interface CalendarUnitOfWorkPort {
  /**
   * Opens a transaction, binds `app.family_id` as its first statement, and
   * constructs every Calendar repository against that transaction. Layer 4 and
   * layer 5 (row-level security, ADR-017) are established by the same call.
   */
  withCalendarFamilyContext<T>(
    familyId: FamilyId,
    work: (uow: CalendarUnitOfWork) => Promise<T>,
  ): Promise<T>;
}
