import { Injectable } from '@nestjs/common';
import { RateLimitGuard } from '../common/rate-limit.guard.js';

/**
 * `contracts/family-api.md`'s rate-limiting table: 10 invitations per family
 * per hour, the strictest limit in this feature and the reason — sending an
 * invitation is this context's outbound-abuse surface (an email leaves the
 * platform). Tracked by the `:familyId` path parameter rather than by
 * account or source: the same owner inviting into two different families
 * must not share one bucket, and two different accounts hammering the same
 * family must.
 */
@Injectable()
export class PerFamilyThrottlerGuard extends RateLimitGuard {
  // Same justification as `PerAccountThrottlerGuard`'s identical suppression:
  // @nestjs/throttler types the request `Record<string, any>`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override getTracker(req: Record<string, any>): Promise<string> {
    const params: unknown = req.params;
    const familyId =
      typeof params === 'object' &&
      params !== null &&
      'familyId' in params &&
      typeof params.familyId === 'string'
        ? params.familyId
        : 'unknown';
    return Promise.resolve(`family:${familyId}`);
  }
}
