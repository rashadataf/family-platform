// Identity and Access bounded context (spec 006, ARCHITECTURE.md §5.1).
// Public surface re-exported here as it is built out story by story.

export { Device, type DeviceProps } from './domain/device.js';
export { EmailAddress } from './domain/email-address.vo.js';
export {
  EmailVerification,
  type EmailVerificationProps,
} from './domain/email-verification.entity.js';
export {
  IDENTITY_EVENT_TYPES,
  userAuthenticatedEvent,
  userRegisteredEvent,
} from './domain/events.js';
export {
  Session,
  type SessionProps,
  type SessionRevokedReason,
} from './domain/session.aggregate.js';
export { User, type UserProps, type UserStatus } from './domain/user.aggregate.js';

export type { DeviceRepository } from './application/ports/device.repository.js';
export type { EmailVerificationRepository } from './application/ports/email-verification.repository.js';
export type {
  IdentityUnitOfWork,
  IdentityUnitOfWorkPort,
} from './application/ports/identity-unit-of-work.port.js';
export type {
  SessionAuthContext,
  SessionRepository,
  SessionSummary,
} from './application/ports/session.repository.js';
export type { UserRepository } from './application/ports/user.repository.js';

export {
  authenticateUser,
  type AuthenticatedSession,
  type AuthenticateUserDeps,
  type AuthenticateUserInput,
} from './application/commands/authenticate-user.command.js';
export {
  registerUser,
  type RegisterUserDeps,
  type RegisterUserInput,
} from './application/commands/register-user.command.js';
export {
  resendVerification,
  type ResendVerificationDeps,
  type ResendVerificationInput,
} from './application/commands/resend-verification.command.js';
export {
  verifyEmail,
  type VerifyEmailDeps,
  type VerifyEmailInput,
} from './application/commands/verify-email.command.js';

export {
  authenticateSession,
  type AuthenticateSessionDeps,
  type AuthenticateSessionInput,
  type SessionContext,
} from './application/queries/authenticate-session.query.js';
export {
  listSessions,
  type ListSessionsDeps,
  type ListSessionsInput,
  type SessionListItem,
} from './application/queries/list-sessions.query.js';
