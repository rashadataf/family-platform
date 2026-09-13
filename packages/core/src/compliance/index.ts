// Audit and Compliance bounded context (ARCHITECTURE.md §5.12), established
// at the minimum spec 008's own obligations require and no further: the
// append-only audit log that Principle VI's "every read of a child's record
// MUST be written to the audit log" depends on.
//
// It lives here rather than under `family/` deliberately — §5.12 assigns the
// audit log to this context, and moving a table between contexts later would
// need its own ADR (spec 008 research.md §7).

export { type AuditEntry, type AuditResult, type AuditSubjectType } from './domain/audit-entry.js';
export { type AuditLogPort } from './application/ports/audit-log.port.js';
