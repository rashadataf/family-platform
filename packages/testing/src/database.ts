import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { provisionDatabaseRoles } from '@fp/persistence';

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
  /** Connection string for the test database, as the APPLICATION role. What the tests use. */
  url: string;
  /** The same database, as the OWNER role. Used to apply migrations and nothing else. */
  ownerUrl: string;
  /** The `postgres` maintenance database, as the cluster superuser. Used to CREATE DATABASE. */
  maintenanceUrl: string;
  /** The test database itself, as the cluster superuser. Used once, to hand its objects to the owner. */
  bootstrapUrl: string;
  name: string;
}

/**
 * ADR-017 gave the platform three database roles, and the harness needs all
 * three for the same reasons a deployment does: only a superuser can create a
 * database and a role, only the owner can run a migration, and only the
 * application role is subject to the row-level security policies the tests are
 * there to verify.
 *
 * Running the suite as the owner would be much simpler and would quietly make
 * every isolation assertion vacuous — the owner is not filtered by its own
 * tables' policies unless FORCE applies, and a test that passes by seeing
 * everything looks exactly like a test that passes by being filtered.
 */
function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. ${hint}`);
  }
  return value;
}

/**
 * Derives the test database from `DATABASE_URL` by suffixing its name, so the
 * harness works unchanged on both local paths and in CI (FR-020): each already
 * points `DATABASE_URL` at its own PostgreSQL, and none of them needs a flag.
 */
export function resolveTestDatabase(
  databaseUrl: string,
  ownerDatabaseUrl: string,
  bootstrapDatabaseUrl: string,
): TestDatabase {
  const url = new URL(databaseUrl);
  const name = `${url.pathname.replace(/^\//, '')}${TEST_DATABASE_SUFFIX}`;

  const withDatabase = (from: string, database: string): string => {
    const next = new URL(from);
    next.pathname = `/${database}`;
    return next.toString();
  };

  return {
    url: withDatabase(databaseUrl, name),
    ownerUrl: withDatabase(ownerDatabaseUrl, name),
    // `postgres` rather than the test database: CREATE DATABASE cannot run
    // from inside the database it is creating.
    maintenanceUrl: withDatabase(bootstrapDatabaseUrl, 'postgres'),
    bootstrapUrl: withDatabase(bootstrapDatabaseUrl, name),
    name,
  };
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
  // Owned by `family_platform_owner`, not by the superuser that creates it.
  // From PostgreSQL 15 the `public` schema is writable only by the database's
  // owner, so a database owned by anyone else leaves the migrator unable to
  // create a table in it — and, more importantly, tables created by a
  // superuser owner are exempt from their own policies even under FORCE
  // (ADR-017), which would make the isolation tests pass while proving
  // nothing.
  const result = await runPrisma(['db', 'execute', '--url', target.maintenanceUrl, '--stdin'], {
    stdin: `CREATE DATABASE "${target.name}" OWNER family_platform_owner`,
  });

  if (result.code !== 0 && !/already exists/i.test(result.output)) {
    throw new Error(
      `Could not create the test database "${target.name}":\n${result.output}\n\nIs PostgreSQL running? \`docker compose up -d postgres\``,
    );
  }

  // Unconditionally, because a test database created before ADR-017 is owned
  // by the superuser that created it, and a database owned by a superuser
  // cannot have its `public` schema written by the migrator — nor would tables
  // created in it be subject to their own policies. Idempotent when it is
  // already right.
  const owned = await runPrisma(['db', 'execute', '--url', target.maintenanceUrl, '--stdin'], {
    stdin: `ALTER DATABASE "${target.name}" OWNER TO family_platform_owner`,
  });
  if (owned.code !== 0) {
    throw new Error(
      `Could not hand the test database "${target.name}" to family_platform_owner:\n${owned.output}`,
    );
  }
}

let prepared: Promise<TestDatabase> | undefined;

/**
 * Idempotent and shared across every test file in a run: the promise is cached,
 * so migrations are applied once however many suites ask for the database.
 */
export function prepareTestDatabase(): Promise<TestDatabase> {
  prepared ??= (async () => {
    const bootstrapUrl = requireEnv(
      'BOOTSTRAP_DATABASE_URL',
      'The integration tier needs a superuser connection to create the test database and the two ' +
        'application roles (ADR-017). See .env.example.',
    );
    const ownerUrl = requireEnv(
      'MIGRATOR_DATABASE_URL',
      'The integration tier applies migrations as `family_platform_owner` (ADR-017). See .env.example.',
    );
    const target = resolveTestDatabase(requireDatabaseUrl(), ownerUrl, bootstrapUrl);

    // Roles are cluster-wide, so this is idempotent across runs and across
    // databases. It reuses the one implementation the migrate service runs,
    // rather than a second copy that could drift from it.
    await provisionDatabaseRoles({
      bootstrapDatabaseUrl: bootstrapUrl,
      ownerPassword: requireEnv('DB_OWNER_PASSWORD', 'Needed to provision the owner role.'),
      appPassword: requireEnv('DB_APP_PASSWORD', 'Needed to provision the application role.'),
    });

    await createDatabaseIfAbsent(target);

    // Again, this time inside the test database: the first call created the
    // roles (which are cluster-wide), and this one hands over the objects that
    // already exist there — `_prisma_migrations` above all, which the migrator
    // must be able to write, and which a pre-ADR-017 run left owned by the
    // superuser.
    await provisionDatabaseRoles({
      bootstrapDatabaseUrl: target.bootstrapUrl,
      ownerPassword: requireEnv('DB_OWNER_PASSWORD', 'Needed to provision the owner role.'),
      appPassword: requireEnv('DB_APP_PASSWORD', 'Needed to provision the application role.'),
    });

    // `migrate deploy`, never `db push`: the test database is built from the
    // same committed migrations every other environment runs (ADR-003). A
    // schema pushed straight from the model would pass tests that a real
    // deployment fails, which is the one thing a migration test must not do.
    const migrated = await runPrisma(['migrate', 'deploy'], {
      // As the OWNER, never as the application role: the application role
      // holds no DDL rights, which is the point of ADR-017.
      env: { ...process.env, DATABASE_URL: target.ownerUrl },
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
