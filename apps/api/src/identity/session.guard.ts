import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { identity } from '@fp/core';
import type { Clock, SessionId, TokenGeneratorPort, UserId } from '@fp/kernel';
import { CLOCK, SESSION_REPOSITORY, TOKEN_GENERATOR } from './identity.tokens.js';

/**
 * Deliberately structural rather than importing Express's own `Request`
 * type: this guard only ever reads one header and attaches one field, and
 * declaring just that keeps it framework-agnostic and avoids adding a direct
 * `express`/`express-serve-static-core` dependency to this app for a single
 * type import (pnpm's strict linking requires directly-imported packages to
 * be declared dependencies — see identity.controller.ts's `@ts-rest/core` fix).
 */
export interface RequestWithIdentityContext {
  headers: { authorization?: string };
  identityContext?: { userId: UserId; sessionId: SessionId };
}

const BEARER_PREFIX = 'Bearer ';

/** Shared by `SessionGuard` and `renewSession` — the latter authenticates the credential itself. */
export function extractBearerToken(header: string | undefined): string | null {
  return header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : null;
}

/**
 * FR-023: revalidates the presented session credential's revocation state
 * and its owning account's status on **every** authenticated request, not
 * merely at issuance — `identity.authenticateSession` does the actual work
 * via one indexed repository lookup (research.md §8's <5ms budget). On
 * success, the resolved identity is attached to the request for the route
 * handler to read via `@Req()`, since a `@TsRestHandler` implementation's own
 * arguments carry only the validated body/query/params (see
 * `identity.controller.ts`'s `RouteHandler` comment).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessionRepository: identity.SessionRepository,
    @Inject(TOKEN_GENERATOR) private readonly tokenGenerator: TokenGeneratorPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithIdentityContext>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException({ type: 'identity/session_invalid' });
    }

    const result = await identity.authenticateSession(
      { token },
      {
        sessionRepository: this.sessionRepository,
        tokenGenerator: this.tokenGenerator,
        clock: this.clock,
      },
    );

    if (!result.ok) {
      throw new UnauthorizedException({ type: 'identity/session_invalid' });
    }

    request.identityContext = result.value;
    return true;
  }
}
