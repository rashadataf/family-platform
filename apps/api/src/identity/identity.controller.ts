import { randomUUID } from 'node:crypto';
import { Controller, Inject, Logger, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AppRoute, ServerInferResponses } from '@ts-rest/core';
import { TsRestHandler, tsRestHandler, type TsRestRequestShape } from '@ts-rest/nest';
import { identityContract } from '@fp/contracts';
import { identity } from '@fp/core';
import type { Clock, MailerPort, PasswordHasherPort, TokenGeneratorPort } from '@fp/kernel';
import { PerAccountThrottlerGuard } from '../common/per-account-throttler.guard.js';
import {
  CLOCK,
  IDENTITY_UNIT_OF_WORK,
  MAILER,
  PASSWORD_HASHER,
  SESSION_REPOSITORY,
  TOKEN_GENERATOR,
} from './identity.tokens.js';
import { SessionGuard, type RequestWithIdentityContext } from './session.guard.js';

/**
 * `tsRestHandler`'s own return type (`NestHandlerImplementation`) is not
 * exported by @ts-rest/nest, so an annotation is spelled out by hand here —
 * without one, `declaration: true` (Principle I) cannot name the inferred
 * type portably, since it resolves through a pnpm store path.
 */
type RouteHandler<T extends AppRoute> = (
  args: TsRestRequestShape<T>,
) => Promise<ServerInferResponses<T>>;

/**
 * Route handlers are added story by story (T042, T057, T071, T084) as
 * `identityContract` (packages/contracts) grows its own routes.
 *
 * Idempotency-Key handling (Principle IX) is not a separate store here:
 * data-model.md allocates no idempotency-key table, and a retried
 * registration with the same email already gets the same
 * `identity/email_unavailable` outcome as the first attempt via FR-002's own
 * uniqueness constraint — the double-submission harm (two accounts, two
 * verification emails) is prevented, even though the exact stored first
 * response is not replayed verbatim. Recorded here rather than silently
 * assumed complete.
 */
@Controller()
export class IdentityController {
  private readonly logger = new Logger(IdentityController.name);

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasherPort,
    @Inject(TOKEN_GENERATOR) private readonly tokenGenerator: TokenGeneratorPort,
    @Inject(MAILER) private readonly mailer: MailerPort,
    @Inject(IDENTITY_UNIT_OF_WORK) private readonly unitOfWork: identity.IdentityUnitOfWorkPort,
    @Inject(SESSION_REPOSITORY) private readonly sessionRepository: identity.SessionRepository,
  ) {}

  // Per-source (the default guard's IP tracking): strict, since this limits
  // automated account creation (contracts/identity-api.md's rate-limiting table).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @TsRestHandler(identityContract.register)
  register(): RouteHandler<typeof identityContract.register> {
    return tsRestHandler(identityContract.register, async ({ body }) => {
      const correlationId = randomUUID();
      const result = await identity.registerUser(
        { email: body.email, password: body.password, correlationId },
        {
          unitOfWork: this.unitOfWork,
          passwordHasher: this.passwordHasher,
          tokenGenerator: this.tokenGenerator,
          mailer: this.mailer,
          clock: this.clock,
        },
      );

      if (result.ok) {
        // UserId and correlation id only — never the email (Principle VI).
        this.logger.log(`Registered ${result.value.userId} [correlationId=${correlationId}]`);
        return { status: 201 as const, body: {} };
      }
      this.logger.log(
        `Registration rejected: ${result.error.kind} [correlationId=${correlationId}]`,
      );
      if (result.error.kind === 'EmailAlreadyRegistered') {
        return { status: 409 as const, body: { type: 'identity/email_unavailable' as const } };
      }
      if (result.error.kind === 'WeakPassword') {
        return {
          status: 422 as const,
          body: { type: 'identity/weak_password' as const, reason: result.error.reason },
        };
      }
      return {
        status: 422 as const,
        body: { type: 'identity/weak_password' as const, reason: 'Unexpected error.' },
      };
    });
  }

  @TsRestHandler(identityContract.verifyEmail)
  verifyEmail(): RouteHandler<typeof identityContract.verifyEmail> {
    return tsRestHandler(identityContract.verifyEmail, async ({ body }) => {
      const result = await identity.verifyEmail(
        { token: body.token },
        { unitOfWork: this.unitOfWork, tokenGenerator: this.tokenGenerator, clock: this.clock },
      );

      if (!result.ok) {
        this.logger.log(`Verification rejected: ${result.error.kind}`);
        return { status: 422 as const, body: { type: 'identity/verification_invalid' as const } };
      }
      this.logger.log(`Verified ${result.value.userId}`);
      return { status: 200 as const, body: {} };
    });
  }

  // Per-account, on top of the default per-source guard: FR-003a allows
  // unlimited resends by design, so this is what stops it becoming a
  // mail-flooding vector against a third party's inbox.
  @UseGuards(PerAccountThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @TsRestHandler(identityContract.resendVerification)
  resendVerification(): RouteHandler<typeof identityContract.resendVerification> {
    return tsRestHandler(identityContract.resendVerification, async ({ body }) => {
      await identity.resendVerification(
        { email: body.email },
        {
          unitOfWork: this.unitOfWork,
          tokenGenerator: this.tokenGenerator,
          mailer: this.mailer,
          clock: this.clock,
        },
      );
      // No outcome logged beyond "handled": the whole point of this route's
      // always-200 response is non-disclosure, and logging whether the
      // account existed would just move the leak from the response to the log.
      this.logger.log('Verification resend requested');
      return { status: 200 as const, body: {} };
    });
  }

  // Per-account, on top of the default per-source guard — the strictest pair
  // of trackers in contracts/identity-api.md's rate-limiting table, layered
  // on top of (not instead of) FR-008's own per-account lock. The two limits
  // serve different purposes and are deliberately not the same number: this
  // route-level limit is a coarse backstop against high-volume automated
  // abuse (many requests, possibly across many accounts or a rotating
  // source), while FR-008's domain-level lock (five failed attempts) is the
  // control that actually engages during a focused attack on one account —
  // this limit is set well above that threshold so FR-008 is the layer a
  // real attack meets first.
  @UseGuards(PerAccountThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @TsRestHandler(identityContract.login)
  login(): RouteHandler<typeof identityContract.login> {
    return tsRestHandler(identityContract.login, async ({ body }) => {
      const correlationId = randomUUID();
      const result = await identity.authenticateUser(
        {
          email: body.email,
          password: body.password,
          deviceLabel: body.deviceLabel ?? null,
          correlationId,
        },
        {
          unitOfWork: this.unitOfWork,
          passwordHasher: this.passwordHasher,
          tokenGenerator: this.tokenGenerator,
          clock: this.clock,
        },
      );

      if (result.ok) {
        // UserId and correlation id only — never the email (Principle VI).
        this.logger.log(
          `Authenticated session ${result.value.sessionId} [correlationId=${correlationId}]`,
        );
        return {
          status: 201 as const,
          body: {
            sessionId: result.value.sessionId,
            token: result.value.token,
            issuedAt: result.value.issuedAt.toISOString(),
            absoluteExpiresAt: result.value.absoluteExpiresAt.toISOString(),
          },
        };
      }

      this.logger.log(
        `Authentication rejected: ${result.error.kind} [correlationId=${correlationId}]`,
      );
      switch (result.error.kind) {
        case 'AccountNotVerified':
          return { status: 403 as const, body: { type: 'identity/not_verified' as const } };
        case 'Throttled':
          return {
            status: 429 as const,
            body: {
              type: 'identity/throttled' as const,
              retryAfterSeconds: result.error.retryAfterSeconds,
            },
          };
        default:
          return { status: 401 as const, body: { type: 'identity/invalid_credentials' as const } };
      }
    });
  }

  @UseGuards(SessionGuard)
  @TsRestHandler(identityContract.listSessions)
  listSessions(
    @Req() req: RequestWithIdentityContext,
  ): RouteHandler<typeof identityContract.listSessions> {
    return tsRestHandler(identityContract.listSessions, async () => {
      // Set by SessionGuard, which already ran and rejected an invalid
      // session before this handler is ever reached.
      if (!req.identityContext) {
        throw new Error('SessionGuard did not populate identityContext.');
      }
      const { userId, sessionId } = req.identityContext;
      const sessions = await identity.listSessions(
        { userId, currentSessionId: sessionId },
        { sessionRepository: this.sessionRepository },
      );
      return {
        status: 200 as const,
        body: {
          sessions: sessions.map((session) => ({
            sessionId: session.sessionId,
            deviceLabel: session.deviceLabel,
            issuedAt: session.issuedAt.toISOString(),
            rotatedAt: session.rotatedAt?.toISOString() ?? null,
            absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
            isCurrent: session.isCurrent,
          })),
        },
      };
    });
  }
}
