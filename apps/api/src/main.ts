import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from './config/load-env.js';
import { buildAppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  // First executable statement: fail to boot on invalid configuration
  // rather than fail later on the first request that needs it
  // (Constitution Principle II, FR-008), before NestFactory.create runs.
  const env = loadEnv();

  const app = await NestFactory.create(buildAppModule(env), {
    logger:
      env.NODE_ENV === 'development' ? ['log', 'error', 'warn', 'debug'] : ['log', 'error', 'warn'],
  });

  await app.listen(env.PORT);
}

await bootstrap();
