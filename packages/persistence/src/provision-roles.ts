import { PrismaClient } from './generated/prisma/index.js';

/**
 * ADR-017's bootstrap step. Runs as the cluster superuser, exactly once per
 * deploy, immediately before `prisma migrate deploy` — and is the only thing
 * in this repository that uses a superuser connection.
 *
 * It exists because of a property of PostgreSQL that is easy to miss:
 * `FORCE ROW LEVEL SECURITY` lifts the *table owner's* exemption from a
 * policy, but nothing lifts a *superuser's*. If the tables are owned by the
 * cluster superuser — which is what a stock `POSTGRES_USER: postgres` gives
 * you — every policy in the schema is enforced against the application and
 * against nobody else, while `pg_policies` reports them as present. So the
 * tables must be owned by a role that is not a superuser, and creating that
 * role is itself a privileged operation. Hence one bootstrap step, and
 * migrations that run as the owner thereafter.
 */

const OWNER_ROLE = 'family_platform_owner';
const APP_ROLE = 'family_platform_app';

export interface ProvisionRolesInput {
  /** Superuser connection string. Held by this step and by nothing else. */
  bootstrapDatabaseUrl: string;
  ownerPassword: string;
  appPassword: string;
}

/**
 * `ALTER ROLE … PASSWORD` takes a literal, not a bind parameter, so the value
 * has to be quoted into the statement. It is quoted by PostgreSQL's own
 * `format('%L')` rather than by anything written here: hand-rolled escaping of
 * a credential is precisely the kind of code that is wrong in one edge case
 * nobody tests.
 */
async function setRolePassword(client: PrismaClient, role: string, password: string) {
  const rows = await client.$queryRaw<{ statement: string }[]>`
    SELECT format('ALTER ROLE %I WITH PASSWORD %L', ${role}::text, ${password}::text) AS statement
  `;
  const built = rows[0];
  if (built === undefined) {
    // Unreachable: a bare SELECT of a scalar always returns one row. Handled
    // rather than asserted because Principle I bans the non-null assertion
    // that would otherwise appear here.
    throw new Error(`Could not build the password statement for role ${role}.`);
  }
  await client.$executeRawUnsafe(built.statement);
}

export async function provisionDatabaseRoles(input: ProvisionRolesInput): Promise<void> {
  if (input.ownerPassword.length === 0 || input.appPassword.length === 0) {
    throw new Error(
      'provisionDatabaseRoles: both role passwords are required. A blank password would create a ' +
        'role that cannot authenticate, and the failure would surface later as an unexplained ' +
        'connection error from the API rather than here.',
    );
  }

  const client = new PrismaClient({ datasources: { db: { url: input.bootstrapDatabaseUrl } } });

  try {
    // Idempotent, and it re-asserts the properties that matter even if a role
    // was created by hand at some point with weaker ones. NOBYPASSRLS on the
    // owner is the whole point of this step.
    await client.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${OWNER_ROLE}') THEN
          CREATE ROLE ${OWNER_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        ELSE
          ALTER ROLE ${OWNER_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;

        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        ELSE
          ALTER ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END
      $$;
    `);

    await setRolePassword(client, OWNER_ROLE, input.ownerPassword);
    await setRolePassword(client, APP_ROLE, input.appPassword);

    // The owner needs CREATE to run migrations, and the superuser must be able
    // to read what the owner creates without owning it.
    await client.$executeRawUnsafe(`GRANT USAGE, CREATE ON SCHEMA public TO ${OWNER_ROLE}`);
    await client.$executeRawUnsafe(`GRANT ${OWNER_ROLE} TO CURRENT_USER`);

    // Hand over anything that already exists. On a fresh database this loop
    // does nothing; on an existing one it moves identity's tables (spec 006,
    // created before this ADR) and `_prisma_migrations` — which the owner must
    // be able to write, or the very next migration fails.
    //
    // Per-object ALTER rather than REASSIGN OWNED BY: the latter would also
    // move objects outside this schema, including the database itself.
    await client.$executeRawUnsafe(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
          EXECUTE format('ALTER TABLE public.%I OWNER TO ${OWNER_ROLE}', r.tablename);
        END LOOP;
        FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
          EXECUTE format('ALTER SEQUENCE public.%I OWNER TO ${OWNER_ROLE}', r.sequencename);
        END LOOP;
        FOR r IN
          SELECT t.typname
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typtype = 'e'
        LOOP
          EXECUTE format('ALTER TYPE public.%I OWNER TO ${OWNER_ROLE}', r.typname);
        END LOOP;
      END
      $$;
    `);
  } finally {
    await client.$disconnect();
  }
}
