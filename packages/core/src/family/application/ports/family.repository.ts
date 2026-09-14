import type { Family } from '../../domain/family.aggregate.js';

export interface FamilyRepository {
  /** Insert or update the family this unit of work is scoped to. */
  save(family: Family): Promise<void>;

  /**
   * The family this unit of work is scoped to, or `null` if it does not exist.
   *
   * Returns the full aggregate, not a flattened record — the same choice
   * `FamilyMemberRepository.findById` makes, and for the same reason:
   * `update-family.command.ts` needs to mutate the actual profile through
   * `rename`/`updateProfile` rather than reconstructing one from scratch and
   * silently discarding whatever it didn't repeat.
   *
   * Under the row-level security policies (ADR-017) this returns `null` for a
   * family that exists but is not the scoped one, which means a mis-scoped
   * caller gets the same answer as one asking about nothing at all — the
   * database enforcing FR-021's non-disclosure rather than the application
   * remembering to.
   */
  findCurrent(): Promise<Family | null>;
}
