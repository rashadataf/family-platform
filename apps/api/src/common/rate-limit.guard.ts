import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Base for every rate-limiting guard in this app. Shapes the 429 response
 * into contracts/identity-api.md's `identity/rate_limited` type instead of
 * @nestjs/throttler's own default `ThrottlerException` body — distinct from
 * FR-008's `identity/throttled`, which is a domain-level per-account lock
 * rather than a route-level rate limit (see the error table's note on why
 * the two are separate types).
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override throwThrottlingException(): Promise<void> {
    throw new HttpException({ type: 'identity/rate_limited' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
