import type { FamilyId, OutboxPort } from '@fp/kernel';
import type { AuditLogPort } from '../../../compliance/application/ports/audit-log.port.js';
import type { TaskAssignmentRepository } from './task-assignment.repository.js';
import type { TaskRepository } from './task.repository.js';

/**
 * One transaction's worth of Tasks repositories, all scoped to a single family
 * BY CONSTRUCTION — `calendar-unit-of-work.port.ts`'s shape, one context over.
 * A separate unit of work from Family's and Calendar's: a context owns its own
 * transaction and cannot reach another's repositories even by accident.
 *
 * `audit` is here because a permitted read of a child's task is audited in the
 * same transaction as the read (Principle VI).
 */
export interface TasksUnitOfWork {
  /** Exposed for event payloads — never as an argument to a repository call. */
  readonly familyId: FamilyId;
  tasks: TaskRepository;
  assignments: TaskAssignmentRepository;
  outbox: OutboxPort;
  audit: AuditLogPort;
}

export interface TasksUnitOfWorkPort {
  /**
   * Opens a transaction, binds `app.family_id` as its first statement, and
   * constructs every Tasks repository against it (ARCHITECTURE.md §9 layers 4
   * and 5, ADR-017).
   */
  withTasksFamilyContext<T>(
    familyId: FamilyId,
    work: (uow: TasksUnitOfWork) => Promise<T>,
  ): Promise<T>;
}
