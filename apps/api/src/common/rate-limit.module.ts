import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

/**
 * Story-agnostic rate-limiting infrastructure (contracts/identity-api.md's
 * Rate limiting table). Each identity route applies its own `@Throttle()`
 * override and, where the basis is "per account" or "per session" rather
 * than the default per-source (IP) tracking, one of the guards in this
 * directory.
 *
 * In-memory storage, appropriate for ADR-013's single Stage 0 VPS — a
 * shared store (e.g. Redis) is a storage provider change here, not a change
 * to any route, if a future multi-instance deployment needs one.
 */
@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }])],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
