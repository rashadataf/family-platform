import { randomUUID } from 'node:crypto';
import {
  err,
  ok,
  asDeviceId,
  asSessionId,
  type Clock,
  type DomainError,
  type PasswordHasherPort,
  type Result,
  type SessionId,
  type TokenGeneratorPort,
} from '@fp/kernel';
import { Device } from '../../domain/device.js';
import { EmailAddress } from '../../domain/email-address.vo.js';
import { userAuthenticatedEvent } from '../../domain/events.js';
import { Session } from '../../domain/session.aggregate.js';
import type { IdentityUnitOfWorkPort } from '../ports/identity-unit-of-work.port.js';

/**
 * A precomputed argon2id hash of an arbitrary fixed string (never a real
 * account's password), generated once via `Argon2PasswordHasher` in
 * packages/platform. Verifying the presented password against this when no
 * account matches the email keeps that path's cost — and therefore its
 * timing — indistinguishable from the wrong-password path (FR-007, SC-003):
 * both run one real argon2id verification, never zero.
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$qKswyulgLnJ0YhrlT+N6sA$WDPTgEmGUuOS1GDjTMz/0zKuO5/zfsj/U34QjiCPaoE';

/** FR-008: "a short time window" — five failures locks the account for fifteen minutes. */
const MAX_FAILED_ATTEMPTS = 5;
const THROTTLE_LOCKOUT_MS = 15 * 60 * 1000;

/** FR-013's hard ceiling. Renewal (US3) refuses to extend a session past this point. */
const ABSOLUTE_SESSION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

const UNKNOWN_DEVICE_LABEL = 'Unknown device';

export interface AuthenticateUserInput {
  email: string;
  password: string;
  /** FR-009: client-supplied, best-effort — issuance proceeds even when absent. */
  deviceLabel: string | null;
  correlationId: string;
}

export interface AuthenticateUserDeps {
  unitOfWork: IdentityUnitOfWorkPort;
  passwordHasher: PasswordHasherPort;
  tokenGenerator: TokenGeneratorPort;
  clock: Clock;
}

export interface AuthenticatedSession {
  sessionId: SessionId;
  token: string;
  issuedAt: Date;
  absoluteExpiresAt: Date;
}

export async function authenticateUser(
  input: AuthenticateUserInput,
  deps: AuthenticateUserDeps,
): Promise<Result<AuthenticatedSession, DomainError>> {
  const email = EmailAddress.from(input.email);

  return deps.unitOfWork.run(async (uow): Promise<Result<AuthenticatedSession, DomainError>> => {
    const now = deps.clock.now();
    const user = await uow.users.findByEmailAcrossAllStatuses(email.value);

    // FR-008: checked before any credential comparison (data-model.md), so
    // throttling costs no argon2id work.
    if (user?.throttledUntil && user.throttledUntil > now) {
      return err({
        kind: 'Throttled',
        retryAfterSeconds: Math.ceil((user.throttledUntil.getTime() - now.getTime()) / 1000),
      });
    }

    // Runs even when `user` is null — see DUMMY_PASSWORD_HASH's comment.
    const passwordMatches = await deps.passwordHasher.verify(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches) {
      if (user) {
        user.recordFailedAttempt(now, {
          maxAttempts: MAX_FAILED_ATTEMPTS,
          lockoutMs: THROTTLE_LOCKOUT_MS,
        });
        await uow.users.save(user);
      }
      return err({ kind: 'InvalidCredentials' });
    }

    // Only reachable with the correct password, so this is a verification
    // gate, not a credential mismatch — a distinct, disclosed error type
    // per contracts/identity-api.md.
    if (user.status !== 'active') {
      return err({ kind: 'AccountNotVerified' });
    }

    user.clearFailedAttempts(now);
    await uow.users.save(user);

    const trimmedDeviceLabel = input.deviceLabel?.trim();
    let deviceLabel = UNKNOWN_DEVICE_LABEL;
    if (trimmedDeviceLabel) {
      deviceLabel = trimmedDeviceLabel;
    }
    const device = Device.register({
      id: asDeviceId(randomUUID()),
      userId: user.id,
      label: deviceLabel,
      now,
    });
    const rawToken = deps.tokenGenerator.generate();
    const tokenHash = deps.tokenGenerator.hash(rawToken);
    const session = Session.issue({
      id: asSessionId(randomUUID()),
      userId: user.id,
      deviceId: device.id,
      tokenHash,
      now,
      absoluteLifetimeMs: ABSOLUTE_SESSION_LIFETIME_MS,
    });

    await uow.devices.save(device);
    await uow.sessions.save(session);
    await uow.outbox.append(
      userAuthenticatedEvent({
        userId: user.id,
        sessionId: session.id,
        correlationId: input.correlationId,
      }),
    );

    return ok({
      sessionId: session.id,
      token: rawToken,
      issuedAt: session.issuedAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
    });
  });
}
