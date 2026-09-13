import type { FamilyId, OutboxPort } from '@fp/kernel';
import type { AuditLogPort } from '../../../compliance/application/ports/audit-log.port.js';

/**
 * One database transaction's worth of family repositories, all of them scoped
 * to a single family BY CONSTRUCTION.
 *
 * This is ARCHITECTURE.md §9 layer 4, and the shape is the point: no method on
 * any repository below takes a family identifier. There is no way to express
 * the unscoped query, so there is no way to forget the scope — which matters
 * because §9's whole argument is that "the realistic failure is a single
 * forgotten `where` clause in one of several hundred queries."
 *
 * `audit` is here rather than alongside it because a *granted* read of a
 * child's record must be recorded in the same transaction as the read itself
 * (Principle VI). A denial has no transaction, and is written through the
 * standalone port instead.
 */
export interface FamilyUnitOfWork {
  /**
   * The family every repository in this unit of work is scoped to. Exposed so
   * a command can put it in an event payload without threading it separately —
   * NOT so a repository call can take it as an argument.
   */
  readonly familyId: FamilyId;
  outbox: OutboxPort;
  audit: AuditLogPort;
}

export interface FamilyUnitOfWorkPort {
  /**
   * Opens a transaction, binds `app.family_id` to it as its first statement,
   * and constructs every repository against that transaction client. The
   * row-level security policies on all four family-scoped tables read that
   * setting, so layer 4 and layer 5 are established by the same call
   * (ADR-017).
   */
  withFamilyContext<T>(familyId: FamilyId, work: (uow: FamilyUnitOfWork) => Promise<T>): Promise<T>;
}
