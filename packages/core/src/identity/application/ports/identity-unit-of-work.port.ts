import type { OutboxPort } from '@fp/kernel';
import type { EmailVerificationRepository } from './email-verification.repository.js';
import type { UserRepository } from './user.repository.js';

/**
 * One database transaction's worth of identity repositories. A command that
 * writes to more than one of these (e.g. `RegisterUser` writes a `User`, an
 * `EmailVerification`, and an outbox row) gets atomicity by doing all of it
 * inside one `run()` call — every repository below is constructed against
 * the SAME transaction client by the persistence-layer implementation.
 *
 * Grows as later stories add repositories (`sessions`, `devices` in US2)
 * rather than declaring all of identity's repositories upfront, so this
 * doesn't force Session/Device repository implementations to exist before
 * anything needs them.
 */
export interface IdentityUnitOfWork {
  users: UserRepository;
  emailVerifications: EmailVerificationRepository;
  outbox: OutboxPort;
}

export interface IdentityUnitOfWorkPort {
  run<T>(work: (uow: IdentityUnitOfWork) => Promise<T>): Promise<T>;
}
