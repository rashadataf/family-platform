import { run } from './exec.js';

const POLL_INTERVAL_MS = 500;
const READY_TIMEOUT_MS = 60_000;

export type ContainerState = 'running' | 'stale' | 'absent';

async function getContainerState(): Promise<ContainerState> {
  const result = await run('docker', [
    'compose',
    'ps',
    '--status',
    'running',
    '--format',
    '{{.Name}}',
    'postgres',
  ]);
  if (result.code === 0 && result.stdout.trim().length > 0) {
    return 'running';
  }

  const all = await run('docker', ['compose', 'ps', '--all', '--format', '{{.Name}}', 'postgres']);
  return all.stdout.trim().length > 0 ? 'stale' : 'absent';
}

/**
 * `docker compose up -d` returns as soon as the container is *created*, well
 * before Postgres accepts connections — this polls pg_isready with a bounded
 * timeout, dumping recent container logs if it never becomes ready.
 */
export async function waitForPostgresReady(database: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await run('docker', [
      'compose',
      'exec',
      '-T',
      'postgres',
      'pg_isready',
      '-U',
      'postgres',
      '-d',
      database,
    ]);
    if (result.code === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  console.error('Postgres did not become ready within the timeout. Recent container logs:');
  await run('docker', ['compose', 'logs', '--tail', '50', 'postgres']);
  throw new Error(
    'Postgres did not become ready. If this persists, try `pnpm db:reset` to rebuild the container from nothing.',
  );
}

/**
 * If the container is stale (Exited/Restarting from a previous run), attempt
 * exactly one bounded recovery cycle before giving up — never an unbounded
 * retry loop.
 */
export async function recoverStaleContainerIfNeeded(): Promise<void> {
  const state = await getContainerState();
  if (state !== 'stale') {
    return;
  }

  console.warn('Postgres container is in a stale state from a previous run. Recovering...');
  await run('docker', ['compose', 'down']);
  await run('docker', ['compose', 'up', '-d', 'postgres']);
}
