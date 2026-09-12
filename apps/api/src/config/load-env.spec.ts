import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from './load-env.js';

/**
 * Constitution Principle II: "A process MUST fail to boot on invalid
 * configuration rather than fail later on the first request that needs it."
 * These tests pin that behaviour, and pin that the failure names the specific
 * variable — an operator staring at a crashed container needs to know which
 * value is wrong, not merely that one is.
 */

const VALID_ENV = {
  NODE_ENV: 'test',
  PORT: '3000',
  LOG_LEVEL: 'info',
  POSTGRES_PORT: '5432',
  POSTGRES_DB: 'family_platform',
  DATABASE_URL: 'postgresql://postgres:localdev@localhost:5432/family_platform',
  MAIL_HOST: 'localhost',
  MAIL_PORT: '1025',
} as const;

class ProcessExitError extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${String(code)})`);
  }
}

/**
 * loadEnv terminates the process rather than throwing, which is correct for
 * production and untestable in-process. This replaces the exit with a throw
 * for the duration of one call and returns whatever was written to stderr,
 * so a test can assert on the diagnostics an operator would actually see.
 */
function captureBootFailure(raw: NodeJS.ProcessEnv): { code: number; stderr: string } {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code): never => {
    throw new ProcessExitError(typeof code === 'number' ? code : 1);
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  try {
    loadEnv(raw);
    throw new Error('Expected loadEnv to reject this environment, but it returned.');
  } catch (error) {
    if (!(error instanceof ProcessExitError)) {
      throw error;
    }
    return {
      code: error.code,
      stderr: errorSpy.mock.calls.map((call) => call.join(' ')).join('\n'),
    };
  } finally {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

describe('loadEnv', () => {
  it('parses a valid environment and coerces numeric variables to numbers', () => {
    const env = loadEnv({ ...VALID_ENV });

    expect(env.PORT).toBe(3000);
    expect(env.POSTGRES_PORT).toBe(5432);
    expect(env.NODE_ENV).toBe('test');
    expect(env.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
  });

  it('applies documented defaults when optional variables are absent', () => {
    const env = loadEnv({
      POSTGRES_PORT: VALID_ENV.POSTGRES_PORT,
      POSTGRES_DB: VALID_ENV.POSTGRES_DB,
      DATABASE_URL: VALID_ENV.DATABASE_URL,
      MAIL_HOST: VALID_ENV.MAIL_HOST,
      MAIL_PORT: VALID_ENV.MAIL_PORT,
    });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('refuses to boot when a required variable is missing, and names it', () => {
    const { code, stderr } = captureBootFailure({
      NODE_ENV: VALID_ENV.NODE_ENV,
      PORT: VALID_ENV.PORT,
      LOG_LEVEL: VALID_ENV.LOG_LEVEL,
      POSTGRES_PORT: VALID_ENV.POSTGRES_PORT,
      POSTGRES_DB: VALID_ENV.POSTGRES_DB,
    });

    expect(code).toBe(1);
    expect(stderr).toContain('DATABASE_URL');
  });

  it('refuses to boot on a malformed DATABASE_URL rather than failing on first query', () => {
    const { code, stderr } = captureBootFailure({ ...VALID_ENV, DATABASE_URL: 'not-a-url' });

    expect(code).toBe(1);
    expect(stderr).toContain('DATABASE_URL');
  });

  it('refuses to boot on an unrecognised NODE_ENV', () => {
    const { stderr } = captureBootFailure({ ...VALID_ENV, NODE_ENV: 'staging' });

    expect(stderr).toContain('NODE_ENV');
  });

  it('refuses to boot on a non-numeric PORT', () => {
    const { stderr } = captureBootFailure({ ...VALID_ENV, PORT: 'eighty' });

    expect(stderr).toContain('PORT');
  });
});
