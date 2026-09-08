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

  // Registers Nest's SIGTERM/SIGINT handlers, which in turn drive every
  // OnModuleDestroy hook — including the Prisma disconnect in @fp/persistence.
  //
  // This is not optional in a container. A process running as PID 1 does not
  // receive the kernel's default signal dispositions: a SIGTERM with no
  // registered handler is *ignored*, so `docker stop` would wait its full
  // timeout and then SIGKILL, dropping in-flight requests. Spec 003 redeploys
  // on every merge to main, so that would be every deploy (FR-009,
  // research.md §6). Compose additionally sets `init: true` so tini is PID 1.
  app.enableShutdownHooks();

  // Bind explicitly rather than relying on the default. Inside a container the
  // only useful interface is all of them, and stating it removes any question
  // about why a published port appears unreachable.
  await app.listen(env.PORT, '0.0.0.0');
}

await bootstrap();
