import type { FamilyId, FamilyMemberId } from '@fp/kernel';

/**
 * Constitution Principle XI: "a new context is not complete without them."
 * Mirrors `family/application/ports/erasure.port.ts`, and the two operations
 * are not the same thing here either:
 *
 * - `eraseForFamily` removes every event, occurrence, participation and
 *   attachment reference the family has. Trivially complete: every Calendar
 *   row carries `family_id`, so there is no row the saga cannot reach.
 * - `eraseForMember` removes that member's participations, and nothing else.
 *   Events they authored stay, as the family's own record, with authorship
 *   pointing at Family's tombstone. Free-text titles are NOT scrubbed — the
 *   one honest limitation, stated in spec.md and data-model.md rather than
 *   implied away.
 *
 * The saga that calls these belongs to Audit and Compliance and does not exist
 * yet.
 */
export interface ErasurePort {
  eraseForFamily(familyId: FamilyId): Promise<void>;
  eraseForMember(memberId: FamilyMemberId): Promise<void>;
}
