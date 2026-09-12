import type { OutboxPort } from '@fp/kernel';
import type { DeviceRepository } from './device.repository.js';
import type { EmailVerificationRepository } from './email-verification.repository.js';
import type { SessionRepository } from './session.repository.js';
import type { UserRepository } from './user.repository.js';

/**
 * One database transaction's worth of identity repositories. A command that
 * writes to more than one of these (e.g. `RegisterUser` writes a `User`, an
 * `EmailVerification`, and an outbox row) gets atomicity by doing all of it
 * inside one `run()` call — every repository below is constructed against
 * the SAME transaction client by the persistence-layer implementation.
 *
 * `sessions` and `devices` were added in US2 (`AuthenticateUser` writes
 * both alongside the outbox row); later stories add repositories the same
 * way rather than declaring all of identity's repositories upfront.
 */
export interface IdentityUnitOfWork {
  users: UserRepository;
  emailVerifications: EmailVerificationRepository;
  sessions: SessionRepository;
  devices: DeviceRepository;
  outbox: OutboxPort;
}

export interface IdentityUnitOfWorkPort {
  run<T>(work: (uow: IdentityUnitOfWork) => Promise<T>): Promise<T>;
}
