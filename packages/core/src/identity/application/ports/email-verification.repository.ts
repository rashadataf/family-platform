import type { UserId } from '@fp/kernel';
import type { EmailVerification } from '../../domain/email-verification.entity.js';

export interface EmailVerificationRepository {
  findByTokenHash(tokenHash: string): Promise<EmailVerification | null>;
  /** The one currently-usable link for a user, if any — what a resend supersedes (FR-003a). */
  findActiveByUserId(userId: UserId): Promise<EmailVerification | null>;
  save(verification: EmailVerification): Promise<void>;
}
