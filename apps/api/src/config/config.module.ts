import { Module, type DynamicModule } from '@nestjs/common';
import type { AppEnv } from './env.schema.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Exposes the already-parsed, already-validated config via DI so nothing
 * downstream reads process.env directly.
 */
@Module({})
export class ConfigModule {
  static forRoot(config: AppEnv): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
