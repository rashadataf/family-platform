import type { FamilyId, FamilyMemberId } from '@fp/kernel';

/**
 * Constitution Principle XI: "Every bounded context MUST implement the erasure
 * ports described in ARCHITECTURE.md §5.12. A new context is not complete
 * without them."
 *
 * The two operations are NOT the same thing, and Principle XI says so
 * explicitly — "deletion of a member and erasure of a family are different
 * operations with different outcomes and MUST NOT be conflated":
 *
 * - `eraseForMember` detaches one person. Their personal fields are removed
 *   and the member row survives as a tombstone, so authorship references held
 *   by contexts that do not exist yet do not dangle. The family carries on.
 * - `eraseForFamily` removes the family and everything under it.
 *
 * The saga that calls these lives in Audit and Compliance and does not exist
 * yet. That is not work deferred silently: what this context owes is the two
 * operations, and they are implemented and tested from the start.
 */
export interface ErasurePort {
  eraseForFamily(familyId: FamilyId): Promise<void>;
  eraseForMember(memberId: FamilyMemberId): Promise<void>;
}
