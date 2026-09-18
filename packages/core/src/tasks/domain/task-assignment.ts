import type { FamilyMemberId } from '@fp/kernel';

/**
 * The link between a task and the family member whose job it is (FR-013).
 *
 * A member id and a timestamp — deliberately nothing else. No `kind`, no date
 * of birth, no guardian: whether a task concerns a child is answered at read
 * time by asking the Family context which members a reader may see
 * (research.md §1, §7), so revoking a guardianship changes the very next read
 * and there is no cached classification to go stale.
 */
export interface TaskAssignment {
  readonly memberId: FamilyMemberId;
  readonly assignedAt: Date;
}
