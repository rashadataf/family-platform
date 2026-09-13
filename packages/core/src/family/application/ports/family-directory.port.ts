import type { FamilyId, UserId } from '@fp/kernel';
import type { MemberRole } from '../../domain/capabilities.js';

export interface FamilyMembershipSummary {
  readonly familyId: FamilyId;
  readonly name: string;
  readonly role: MemberRole;
}

/**
 * The one question that cannot be answered inside a family scope: "which
 * families am I in?" (FR-024).
 *
 * A user may belong to several — separated parents, blended households — so
 * the question spans the tenant boundary by definition and there is no single
 * `app.family_id` that could bound it. What bounds it instead is the user, and
 * the `family_member_self` row-level security policy says so in the database:
 * a caller may see their own member rows, in any family, and nothing else.
 *
 * Deliberately a separate port from `FamilyRepository`, which is scoped by
 * construction. Putting a cross-family read on the scoped repository would
 * make "this repository can only see one family" untrue, and that sentence is
 * load-bearing (ARCHITECTURE.md §9 layer 4).
 */
export interface FamilyDirectoryPort {
  listMembershipsFor(userId: UserId): Promise<readonly FamilyMembershipSummary[]>;
}
