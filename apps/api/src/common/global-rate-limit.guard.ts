import { Injectable, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard.js';

const SKIP_GLOBAL_RATE_LIMIT = 'skipGlobalRateLimit';

/**
 * Opts a route (or every route on a controller) out of `GlobalRateLimitGuard`
 * below. For a route that already carries its own scoped throttler (e.g.
 * `PerUserThrottlerGuard`), the global guard would otherwise enforce the
 * *same* `@Throttle()` limit a second time, keyed by source IP rather than
 * by user — which throttles a whole household sharing one NAT on behalf of
 * whichever member happened to use the route first (spec 010 quickstart
 * Scenario 7). The scoped guard is the one actually named in the contract;
 * this decorator makes that the only one enforced.
 */
export const SkipGlobalRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_GLOBAL_RATE_LIMIT, true);

/**
 * The `APP_GUARD` instance (rate-limit.module.ts): a blanket per-source rate
 * limit on every route, except those that declare `@SkipGlobalRateLimit()`
 * because a route-scoped guard already covers them.
 */
@Injectable()
export class GlobalRateLimitGuard extends RateLimitGuard {
  protected override shouldSkip(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_GLOBAL_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    return Promise.resolve(skip ?? false);
  }
}
