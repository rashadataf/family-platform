import type { FamilyId } from '@fp/kernel';

export interface FamilyRecord {
  readonly id: FamilyId;
  readonly name: string;
  readonly deletionRequestedAt: Date | null;
}

export interface FamilyRepository {
  /**
   * The family this unit of work is scoped to, or `null` if it does not exist.
   *
   * Under the row-level security policies (ADR-017) this returns `null` for a
   * family that exists but is not the scoped one, which means a mis-scoped
   * caller gets the same answer as one asking about nothing at all — the
   * database enforcing FR-021's non-disclosure rather than the application
   * remembering to.
   */
  findCurrent(): Promise<FamilyRecord | null>;
}
