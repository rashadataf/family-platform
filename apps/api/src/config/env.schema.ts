import { z } from 'zod';

/**
 * Single source of truth for every environment variable this process needs.
 * Every key here must also appear in the root `.env.example`
 * (scripts/verify-env-example.ts checks this).
 */
/**
 * Zod 3 still runs a `.refine` after `.url()` has already failed, so this has
 * to tolerate a value that is not a URL at all and leave that complaint to
 * `.url()` — otherwise a plainly malformed DATABASE_URL surfaces as a
 * `TypeError` from the parser instead of the actionable message it has.
 */
function connectsAsApplicationRole(value: string): boolean {
  try {
    return new URL(value).username === 'family_platform_app';
  } catch {
    return true;
  }
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  POSTGRES_PORT: z.coerce.number().int().positive(),
  POSTGRES_DB: z.string().min(1),
  /**
   * The APPLICATION role's connection string (ADR-017), never the owner's and
   * never a superuser's. `apps/api` and `apps/worker` hold only this one.
   *
   * A process that boots with the owner's URL would work — and would silently
   * bypass every row-level security policy in the schema, because `FORCE ROW
   * LEVEL SECURITY` exempts nothing from a role that owns the table. So the
   * user is asserted here rather than assumed: a wrong value fails at boot,
   * which is the only point at which it is cheap to notice (Principle II).
   */
  DATABASE_URL: z
    .string()
    .url()
    .refine(connectsAsApplicationRole, {
      message:
        'DATABASE_URL must connect as `family_platform_app` (ADR-017). Connecting as the table ' +
        'owner or as a superuser bypasses row-level security, which is ARCHITECTURE.md §9 layer 5 ' +
        'and Constitution Principle V. The owner\'s URL belongs in MIGRATOR_DATABASE_URL, which ' +
        'only the migrate task holds.',
    }),
  MAIL_HOST: z.string().min(1),
  MAIL_PORT: z.coerce.number().int().positive(),
});

export type AppEnv = z.infer<typeof envSchema>;
