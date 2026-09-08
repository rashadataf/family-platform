import { z } from 'zod';

/**
 * Single source of truth for every environment variable this process needs.
 * Every key here must also appear in the root `.env.example`
 * (scripts/verify-env-example.ts checks this).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  POSTGRES_PORT: z.coerce.number().int().positive(),
  POSTGRES_DB: z.string().min(1),
  DATABASE_URL: z.string().url(),
});

export type AppEnv = z.infer<typeof envSchema>;
