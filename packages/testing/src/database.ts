import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Ensures the test database exists and carries every committed migration,
 * once per run (FR-017).
 *
 * A SEPARATE database from development, not a separate schema and not the
 * development database with a truncate on top (FR-018). A suite that empties
 * the database you were just working in is a suite people learn not to run,
 * and then the tests stop being run at all — which costs more than the
 * isolation was worth.
 *
 * No Testcontainers. It would need the host Docker socket mounted into the
 * development container from spec 004 — effectively host root — or the
 * integration suite would not run on the path this project just made the
 * supported one (FR-020, research §7). PostgreSQL is already present on both
 * local paths and as a CI service container, so the harness uses it.
 */

/**
 * Commands run from the persistence package, which is where the Prisma CLI and
 * the schema live. Referring to it by directory rather than importing anything
 * from it keeps this out of the dependency graph as a code edge.
 */
const PERSISTENCE_DIR = fileURLToPath(new URL('../../persistence/', import.meta.url));

const TEST_DATABASE_SUFFIX = '_test';

export interface TestDatabase {
  /** Connection string for the test database. */
  url: string;
  /** Connection string for the `postgres` maintenance database. */
  maintenanceUrl: string;
  name: string;
}

/**
 * Derives the test database from `DATABASE_URL` by suffixing its name, so the
 * harness works unchanged on both local paths and in CI (FR-020): each already
 * points `DATABASE_URL` at its own PostgreSQL, and none of them needs a flag.
 */
export function resolveTestDatabase(databaseUrl: string): TestDatabase {
  const url = new URL(databaseUrl);
  const name = `${url.pathname.replace(/^\//, '')}${TEST_DATABASE_SUFFIX}`;

  const testUrl = new URL(url.toString());
  testUrl.pathname = `/${name}`;

  const maintenanceUrl = new URL(url.toString());
  maintenanceUrl.pathname = '/postgres';

  return { url: testUrl.toString(), maintenanceUrl: maintenanceUrl.toString(), name };
}

interface CommandResult {
  code: number;
  output: string;
}

function runPrisma(args: string[], options: { env?: NodeJS.ProcessEnv; stdin?: string }) {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'prisma', ...args], {
      cwd: PERSISTENCE_DIR,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, output });
    });

    child.stdin.end(options.stdin ?? '');
  });
}

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (value === undefined || value === '') {
    throw new Error(
      'DATABASE_URL is not set. The integration tier needs a real database: start one with `docker compose up -d postgres`, or run the suite on the containerized path with `docker compose run --rm api pnpm test:integration`.',
    );
  }
  return value;
}

/**
 * Attempts the CREATE and treats "already exists" as success, rather than
 * checking first. The check-then-create version has a race that two test
 * workers starting together will lose, and losing it is not an error — the
 * database being there is the outcome either way.
 *
 * CREATE DATABASE cannot run inside a transaction block, which is why this is
 * a single statement through `db execute` rather than a migration.
 */
async function createDatabaseIfAbsent(target: TestDatabase): Promise<void> {
  const result = await runPrisma(['db', 'execute', '--url', target.maintenanceUrl, '--stdin'], {
    stdin: `CREATE DATABASE "${target.name}"`,
  });

  if (result.code === 0 || /already exists/i.test(result.output)) return;

  throw new Error(
    `Could not create the test database "${target.name}":\n${result.output}\n\nIs PostgreSQL running? \`docker compose up -d postgres\``,
  );
}

let prepared: Promise<TestDatabase> | undefined;

/**
 * Idempotent and shared across every test file in a run: the promise is cached,
 * so migrations are applied once however many suites ask for the database.
 */
export function prepareTestDatabase(): Promise<TestDatabase> {
  prepared ??= (async () => {
    const target = resolveTestDatabase(requireDatabaseUrl());
    await createDatabaseIfAbsent(target);

    // `migrate deploy`, never `db push`: the test database is built from the
    // same committed migrations every other environment runs (ADR-003). A
    // schema pushed straight from the model would pass tests that a real
    // deployment fails, which is the one thing a migration test must not do.
    const migrated = await runPrisma(['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: target.url },
    });
    if (migrated.code !== 0) {
      throw new Error(`Migrations failed against the test database:\n${migrated.output}`);
    }

    // Point the process at the test database so the client in
    // @fp/persistence — which reads DATABASE_URL when it first connects —
    // never touches the development one.
    process.env.DATABASE_URL = target.url;
    return target;
  })();
  return prepared;
}
