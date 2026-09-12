import { Injectable } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard.js';

/**
 * Tracks by the presented bearer credential rather than by source IP — for
 * routes whose limit is meant to bound one session's own request rate (the
 * renewal route), as distinct from a per-account or per-source basis.
 */
@Injectable()
export class PerSessionThrottlerGuard extends RateLimitGuard {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see PerAccountThrottlerGuard's identical note.
  protected override getTracker(req: Record<string, any>): Promise<string> {
    const headers: unknown = req.headers;
    const authorization =
      typeof headers === 'object' &&
      headers !== null &&
      'authorization' in headers &&
      typeof headers.authorization === 'string'
        ? headers.authorization
        : '';
    return Promise.resolve(authorization ? `session:${authorization}` : 'session:unknown');
  }
}
