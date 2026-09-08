import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import type { AppEnv } from './config/env.schema.js';

export function buildAppModule(env: AppEnv) {
  @Module({
    imports: [ConfigModule.forRoot(env), HealthModule],
  })
  class AppModule {}

  return AppModule;
}
