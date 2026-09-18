import type { FamilyId, FamilyMemberId } from '@fp/kernel';

/**
 * Constitution Principle XI, mirroring Calendar's. Two different operations:
 *
 * - `eraseForFamily` removes every task and assignment the family has.
 *   Trivially complete: every Tasks row carries `family_id`.
 * - `eraseForMember` removes that member's assignments and nothing else. Tasks
 *   they created, completed or cancelled stay as the family's own record, their
 *   actor references pointing at Family's tombstone. Titles and notes are NOT
 *   scrubbed — the stated limitation in spec.md and data-model.md.
 */
export interface ErasurePort {
  eraseForFamily(familyId: FamilyId): Promise<void>;
  eraseForMember(memberId: FamilyMemberId): Promise<void>;
}
