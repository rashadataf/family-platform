import {
  err,
  ok,
  type Clock,
  type DomainError,
  type Result,
  type TokenGeneratorPort,
  type UserId,
} from '@fp/kernel';
import type { IdentityUnitOfWorkPort } from '../ports/identity-unit-of-work.port.js';

export interface VerifyEmailInput {
  token: string;
}

export interface VerifyEmailDeps {
  unitOfWork: IdentityUnitOfWorkPort;
  tokenGenerator: TokenGeneratorPort;
  clock: Clock;
}

export async function verifyEmail(
  input: VerifyEmailInput,
  deps: VerifyEmailDeps,
): Promise<Result<{ userId: UserId }, DomainError>> {
  const tokenHash = deps.tokenGenerator.hash(input.token);

  return deps.unitOfWork.run(async (uow): Promise<Result<{ userId: UserId }, DomainError>> => {
    const verification = await uow.emailVerifications.findByTokenHash(tokenHash);
    if (!verification) {
      return err({ kind: 'VerificationInvalid' });
    }

    const now = deps.clock.now();
    const consumed = verification.consume(now);
    if (!consumed.ok) {
      return consumed;
    }

    const user = await uow.users.findById(verification.userId);
    if (!user) {
      return err({ kind: 'VerificationInvalid' });
    }

    const verified = user.verify(now);
    if (!verified.ok) {
      return verified;
    }

    await uow.emailVerifications.save(verification);
    await uow.users.save(user);
    return ok({ userId: user.id });
  });
}
