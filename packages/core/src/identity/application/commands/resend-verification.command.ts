import { randomUUID } from 'node:crypto';
import {
  ok,
  type Clock,
  type DomainError,
  type MailerPort,
  type Result,
  type TokenGeneratorPort,
} from '@fp/kernel';
import { EmailAddress } from '../../domain/email-address.vo.js';
import { EmailVerification } from '../../domain/email-verification.entity.js';
import type { IdentityUnitOfWorkPort } from '../ports/identity-unit-of-work.port.js';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface ResendVerificationInput {
  email: string;
}

export interface ResendVerificationDeps {
  unitOfWork: IdentityUnitOfWorkPort;
  tokenGenerator: TokenGeneratorPort;
  mailer: MailerPort;
  clock: Clock;
}

/**
 * Always reports success (`ok`), whether or not the email belongs to a real,
 * unverified account. Not an explicit FR, but the same non-disclosure
 * reasoning FR-007 applies to login: telling an anonymous caller "no such
 * account" or "already verified" via this endpoint is an enumeration oracle
 * this feature can close for free.
 */
export async function resendVerification(
  input: ResendVerificationInput,
  deps: ResendVerificationDeps,
): Promise<Result<void, DomainError>> {
  const email = EmailAddress.from(input.email);
  const rawToken = deps.tokenGenerator.generate();
  const tokenHash = deps.tokenGenerator.hash(rawToken);

  const toSend = await deps.unitOfWork.run(async (uow) => {
    const user = await uow.users.findByEmailAcrossAllStatuses(email.value);
    if (!user || user.isVerified) {
      return null;
    }

    const now = deps.clock.now();
    const previous = await uow.emailVerifications.findActiveByUserId(user.id);
    if (previous) {
      previous.supersede(now);
      await uow.emailVerifications.save(previous);
    }

    const verification = EmailVerification.issue({
      id: randomUUID(),
      userId: user.id,
      tokenHash,
      now,
      ttlMs: VERIFICATION_TTL_MS,
    });
    await uow.emailVerifications.save(verification);

    return { to: email.value };
  });

  if (toSend) {
    await deps.mailer.send({
      to: toSend.to,
      subject: 'Verify your email',
      text: `Verification token: ${rawToken}`,
    });
  }

  return ok(undefined);
}
