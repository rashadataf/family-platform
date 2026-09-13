import type { FamilyMemberId, UserId } from '@fp/kernel';
import type { MemberRole } from '../../domain/capabilities.js';

/** What resolving a user's standing needs, and nothing more. */
export interface MemberStanding {
  readonly memberId: FamilyMemberId;
  readonly role: MemberRole;
}

/**
 * Scoped by construction (ARCHITECTURE.md §9 layer 4). No method here takes a
 * family identifier, because the repository was built from a transaction that
 * already carries one — there is no way to express the unscoped query, so
 * there is no way to forget the scope.
 */
export interface FamilyMemberRepository {
  /**
   * The caller's standing in the family this unit of work is scoped to, or
   * `null`. A removed member (tombstoned) resolves to `null`: FR-017 requires
   * removal to be reflected in the very next resolution, with no cache to
   * invalidate and nothing to expire.
   */
  findStandingByUserId(userId: UserId): Promise<MemberStanding | null>;
}
