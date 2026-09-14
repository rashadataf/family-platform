/**
 * The bootstrap entry point the `migrate` service runs before
 * `prisma migrate deploy` (ADR-017). Kept as its own binary rather than folded
 * into the migration because creating a role needs a superuser connection, and
 * the whole point of the decision is that migrations do not run with one.
 */
import { provisionDatabaseRoles } from '../provision-roles.js';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is required to provision database roles (ADR-017). Refusing to continue: a missing ` +
        'value here produces a role that cannot authenticate, and the error surfaces much later, ' +
        'as an unexplained connection failure from the API.',
    );
  }
  return value;
}

await provisionDatabaseRoles({
  bootstrapDatabaseUrl: required('BOOTSTRAP_DATABASE_URL'),
  ownerPassword: required('DB_OWNER_PASSWORD'),
  appPassword: required('DB_APP_PASSWORD'),
});

// Identifiers only — never the connection string, never a password.
console.log('Database roles provisioned: family_platform_owner, family_platform_app');
