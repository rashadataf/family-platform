import type { FamilyMemberId } from '@fp/kernel';
import type { Guardianship } from '../../domain/guardianship.js';

/**
 * Scoped by construction (ARCHITECTURE.md §9 layer 4), the same as every
 * other repository in this unit of work — no method here takes a family id.
 */
export interface GuardianshipRepository {
  save(guardianship: Guardianship): Promise<void>;

  /** How many active guardians a child has right now — the input to `assertGuardianCoverage`. */
  countActiveForChild(childMemberId: FamilyMemberId): Promise<number>;

  /** The one active relationship between this pair, or `null`. */
  findActive(
    guardianMemberId: FamilyMemberId,
    childMemberId: FamilyMemberId,
  ): Promise<Guardianship | null>;

  /**
   * Every child this member actively guards. One query for `listMembers`'
   * per-row `dateOfBirth` omission, rather than one lookup per child on the
   * roster.
   */
  listActiveChildIdsGuardedBy(guardianMemberId: FamilyMemberId): Promise<readonly FamilyMemberId[]>;
}
