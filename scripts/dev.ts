import { existsSync } from 'node:fs';
import { run, runForeground, runQuiet } from './lib/exec.js';
import { recoverStaleContainerIfNeeded, waitForPostgresReady } from './lib/postgres.js';
import { findMissingKeys } from './verify-env-example.js';
import { loadEnv } from '../apps/api/src/config/load-env.js';

const POSTGRES_DB = process.env.POSTGRES_DB ?? 'family_platform';
const POSTGRES_PORT = process.env.POSTGRES_PORT ?? '5432';

async function preflight(): Promise<void> {
  if (!existsSync('.env')) {
    console.error(
      'No .env file found. Run `cp .env.example .env`, edit the values, and re-run `pnpm dev`.',
    );
    process.exit(1);
  }

  const missingKeys = findMissingKeys();
  if (missingKeys.length > 0) {
    console.warn(
      `Warning: .env.example is missing keys the API requires: ${missingKeys.join(', ')}. Run \`pnpm verify:env\` for details.`,
    );
  }

  // Validate the real .env values against the same schema apps/api uses,
  // before touching Docker at all. This must happen here rather than
  // relying solely on the API's own main.ts: `tsx watch` (used for FR-002's
  // auto-restart) deliberately survives a crashed child process and waits
  // for a file change rather than propagating the exit code, so a boot-time
  // config error inside the watched process would otherwise hang `pnpm dev`
  // instead of failing fast (FR-008, SC-003). loadEnv() prints the specific
  // invalid variable and calls process.exit(1) itself on failure.
  loadEnv();

  // `docker compose version` only checks that the CLI plugin is installed —
  // it succeeds even when the daemon itself is unreachable. `docker info`
  // actually round-trips to the daemon, so this is the real reachability
  // check the error message below promises.
  const dockerCheck = await runQuiet('docker', ['info']);
  if (dockerCheck.code !== 0) {
    console.error(
      'Docker (or a compatible container runtime) is required but was not found/reachable. Install it and re-run `pnpm dev`. See docs/local-development.md#prerequisites.',
    );
    process.exit(1);
  }
}

async function startPostgres(): Promise<void> {
  await recoverStaleContainerIfNeeded();

  const up = await run('docker', ['compose', 'up', '-d', 'postgres']);
  if (up.code !== 0) {
    if (/address already in use|port is already allocated/i.test(up.stderr)) {
      console.error(
        `Port ${POSTGRES_PORT} is already in use by another process. Stop it, or set a different POSTGRES_PORT in .env, and re-run \`pnpm dev\`.`,
      );
    } else {
      console.error('Failed to start the Postgres container. See the error above.');
    }
    process.exit(1);
  }

  try {
    await waitForPostgresReady(POSTGRES_DB);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function migrate(): Promise<void> {
  const result = await run('pnpm', [
    '--filter',
    '@fp/persistence',
    'exec',
    'prisma',
    'migrate',
    'deploy',
  ]);
  if (result.code !== 0) {
    console.error('Database migration failed. The environment is NOT ready.');
    process.exit(1);
  }
}

async function startApi(): Promise<void> {
  const code = await runForeground('pnpm', ['--filter', '@fp/api', 'run', 'dev']);
  process.exit(code);
}

await preflight();
await startPostgres();
await migrate();
await startApi();
