import { randomUUID } from 'node:crypto';
import {
  err,
  ok,
  asUserId,
  type Clock,
  type DomainError,
  type MailerPort,
  type PasswordHasherPort,
  type Result,
  type TokenGeneratorPort,
  type UserId,
} from '@fp/kernel';
import { EmailAddress } from '../../domain/email-address.vo.js';
import { EmailVerification } from '../../domain/email-verification.entity.js';
import { userRegisteredEvent } from '../../domain/events.js';
import { User } from '../../domain/user.aggregate.js';
import type { IdentityUnitOfWorkPort } from '../ports/identity-unit-of-work.port.js';

/** FR-003a: "a set window" — 24 hours is the chosen value; resend replaces it as many times as needed. */
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * FR-004's actual rule, enforced here rather than at the wire boundary — see
 * `passwordSchema`'s comment in packages/contracts for why. NIST SP 800-63B
 * favours length over composition rules (no forced mix of symbols, numbers,
 * casing).
 */
const MIN_PASSWORD_LENGTH = 12;

export interface RegisterUserInput {
  email: string;
  password: string;
  correlationId: string;
}

export interface RegisterUserDeps {
  unitOfWork: IdentityUnitOfWorkPort;
  passwordHasher: PasswordHasherPort;
  tokenGenerator: TokenGeneratorPort;
  mailer: MailerPort;
  clock: Clock;
}

export async function registerUser(
  input: RegisterUserInput,
  deps: RegisterUserDeps,
): Promise<Result<{ userId: UserId }, DomainError>> {
  const email = EmailAddress.from(input.email);

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return err({
      kind: 'WeakPassword',
      reason: `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters long.`,
    });
  }

  const passwordHash = await deps.passwordHasher.hash(input.password);
  const rawToken = deps.tokenGenerator.generate();
  const tokenHash = deps.tokenGenerator.hash(rawToken);

  const outcome = await deps.unitOfWork.run(
    async (uow): Promise<Result<{ userId: UserId }, DomainError>> => {
      // FR-002: unique across every status, including deletion_requested still inside its retention window.
      const existing = await uow.users.findByEmailAcrossAllStatuses(email.value);
      if (existing) {
        return err({ kind: 'EmailAlreadyRegistered' });
      }

      const now = deps.clock.now();
      const user = User.register({ id: asUserId(randomUUID()), email, passwordHash, now });
      const verification = EmailVerification.issue({
        id: randomUUID(),
        userId: user.id,
        tokenHash,
        now,
        ttlMs: VERIFICATION_TTL_MS,
      });

      await uow.users.save(user);
      await uow.emailVerifications.save(verification);
      await uow.outbox.append(
        userRegisteredEvent({ userId: user.id, correlationId: input.correlationId }),
      );

      return ok({ userId: user.id });
    },
  );

  if (!outcome.ok) {
    return outcome;
  }

  // Sent after the transaction commits, deliberately: email delivery is not
  // transactional, and a failure here must not roll back a successful
  // registration — FR-003a's resend path exists for exactly this case.
  await deps.mailer.send({
    to: email.value,
    subject: 'Verify your email',
    text: `Verification token: ${rawToken}`,
  });

  return outcome;
}
