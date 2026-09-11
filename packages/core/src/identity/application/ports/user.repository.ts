import type { UserId } from '@fp/kernel';
import type { User } from '../../domain/user.aggregate.js';

export interface UserRepository {
  /**
   * Across every status, including `deletion_requested` — what makes FR-002's
   * "blocked until erasure completes" true (data-model.md's invariant).
   */
  findByEmailAcrossAllStatuses(email: string): Promise<User | null>;
  findById(id: UserId): Promise<User | null>;
  /** Insert-or-update by id. */
  save(user: User): Promise<void>;
}
