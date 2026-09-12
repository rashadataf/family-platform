import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';

/**
 * ADR-002 scopes this host to queue consumers and scheduled sweeps — no HTTP
 * listener. `createApplicationContext` gives DI without binding a port.
 */
@Module({})
class WorkerModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}

await bootstrap();
