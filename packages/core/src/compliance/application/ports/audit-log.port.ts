import type { AuditEntry } from '../../domain/audit-entry.js';

/**
 * The audit sink. Append-only by grant, not by convention: the application
 * database role holds `INSERT` on the underlying table and nothing else
 * (ADR-017), so there is no `read` or `delete` on this port because there is
 * no privilege behind one.
 *
 * This is the published port of the Audit and Compliance context
 * (ARCHITECTURE.md §5.12). Other contexts depend on this interface and on
 * nothing else here, which is what §7.1 permits.
 *
 * Writes are direct rather than relayed through the outbox, which is a
 * deliberate departure from §7.3 recorded in spec 008's plan.md: a denial has
 * no domain transaction to attach an outbox row to — nothing was written, that
 * is the point — and the audit log is a sink rather than another context's
 * domain state.
 */
export interface AuditLogPort {
  append(entry: AuditEntry): Promise<void>;
}
