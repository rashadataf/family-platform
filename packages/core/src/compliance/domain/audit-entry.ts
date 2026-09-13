import type { FamilyId, FamilyMemberId, UserId } from '@fp/kernel';

/**
 * One row of the append-only audit log (ARCHITECTURE.md §5.12).
 *
 * Principle VI names the fields: actor, subject, purpose and result. All four
 * are required here rather than optional, because an audit entry missing its
 * purpose answers "who touched this" and not "why", and the second question is
 * the one a subject access request actually asks.
 *
 * IDENTIFIERS ONLY. No name, no date of birth, no email address ever appears
 * on this type — an audit trail that leaks what it protects is worse than
 * none, and the same rule that keeps personal data out of log lines applies
 * here (Principle VI).
 */
export type AuditResult = 'granted' | 'denied';

export type AuditSubjectType = 'family' | 'family_member' | 'invitation' | 'guardianship';

export interface AuditEntry {
  /** Null for a system actor, such as a scheduled sweep. */
  readonly actorUserId: UserId | null;
  /**
   * Null when the actor held no standing in the family — which is the finding
   * itself, not missing data.
   */
  readonly actorMemberId: FamilyMemberId | null;
  readonly familyId: FamilyId | null;
  readonly subjectType: AuditSubjectType;
  readonly subjectId: string;
  /** A stable, machine-readable verb: `child_record.read`, `access.denied`, … */
  readonly action: string;
  readonly purpose: string;
  readonly result: AuditResult;
  /**
   * The REAL reason, including the one the caller was not told. FR-021 makes a
   * cross-family access indistinguishable from a missing resource on the wire;
   * this is where the difference is recorded.
   */
  readonly reason: string | null;
  readonly correlationId: string;
}
