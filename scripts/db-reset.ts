import { run } from './lib/exec.js';
import { waitForPostgresReady } from './lib/postgres.js';

const POSTGRES_DB = process.env.POSTGRES_DB ?? 'family_platform';

console.warn('Resetting local database: all local data will be destroyed.');

const down = await run('docker', ['compose', 'down', '-v']);
if (down.code !== 0) {
  console.error('Failed to tear down the Postgres container/volume. See the error above.');
  process.exit(1);
}

const up = await run('docker', ['compose', 'up', '-d', 'postgres']);
if (up.code !== 0) {
  console.error('Failed to start a fresh Postgres container. See the error above.');
  process.exit(1);
}

try {
  await waitForPostgresReady(POSTGRES_DB);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const migrate = await run('pnpm', [
  '--filter',
  '@fp/persistence',
  'exec',
  'prisma',
  'migrate',
  'deploy',
]);
if (migrate.code !== 0) {
  console.error('Database migration failed. The environment is NOT ready.');
  process.exit(1);
}

console.log('Database reset complete: rebuilt from nothing, every committed migration reapplied.');
