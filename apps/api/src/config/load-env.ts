import { envSchema, type AppEnv } from './env.schema.js';

/**
 * Parses and validates process.env eagerly. Constitution Principle II: a
 * process MUST fail to boot on invalid configuration rather than fail later
 * on the first request that needs it. Called as the first statement of
 * main.ts, before NestFactory.create runs.
 */
export function loadEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    console.error('Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}
