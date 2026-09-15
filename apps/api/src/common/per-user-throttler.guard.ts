import { Injectable } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard.js';

/**
 * Tracks by the authenticated user, for limits written "per user"
 * (spec 009 contracts/calendar-api.md's rate-limiting table). Must run AFTER
 * `SessionGuard`, which is what attaches the identity it reads; before it, or
 * on an unauthenticated request, every caller shares one `user:unknown`
 * bucket, which fails towards throttling rather than towards none.
 */
@Injectable()
export class PerUserThrottlerGuard extends RateLimitGuard {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see PerAccountThrottlerGuard's identical note.
  protected override getTracker(req: Record<string, any>): Promise<string> {
    const identity: unknown = req.identityContext;
    const userId =
      typeof identity === 'object' &&
      identity !== null &&
      'userId' in identity &&
      typeof identity.userId === 'string'
        ? identity.userId
        : 'unknown';
    return Promise.resolve(`user:${userId}`);
  }
}
