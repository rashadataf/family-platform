import { Module } from '@nestjs/common';
import { RateLimitModule } from './common/rate-limit.module.js';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { PersistenceLifecycle } from './persistence/persistence-lifecycle.js';
import type { AppEnv } from './config/env.schema.js';

export function buildAppModule(env: AppEnv) {
  @Module({
    imports: [ConfigModule.forRoot(env), RateLimitModule, HealthModule, IdentityModule],
    // Registered at the root: the connection pool belongs to the process,
    // not to any one feature module (FR-009).
    providers: [PersistenceLifecycle],
  })
  class AppModule {}

  return AppModule;
}
