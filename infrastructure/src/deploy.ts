import * as pulumi from '@pulumi/pulumi';
import { remote } from '@pulumi/command';
import type { StackConfig } from './config.js';
import { connectionFor, REMOTE_DIR } from './transfer.js';
import { MIGRATOR_TARBALL_NAME, RUNTIME_TARBALL_NAME, type StagingImages } from './image.js';

/**
 * Migrate-before-swap (research.md §2, corrects issue #9): load both new
 * images without touching running containers, run migrations — or, with
 * `resetData`, a full wipe-and-reseed — against the still-running Postgres,
 * and only recreate `api` if that step exits zero. `set -euo pipefail`
 * means a failed migration exits the whole script non-zero before `up -d`
 * ever runs: the previous deployment (if any) is left exactly as it was
 * (FR-009), and Pulumi reports this resource — and therefore the deploy —
 * as failed.
 *
 * `resetData` picks which script text to generate at synth time rather than
 * branching in shell on a runtime variable — there is no runtime variable
 * for it any more (see `createDeployCommand`'s comment on why `environment`
 * is unusable here at all), and the value is already known before the
 * script is built, so a shell `if` would just be indirection.
 *
 * The two branches are genuinely different operations, not one command with
 * a flag: `prisma migrate reset --force` drops the database and, since
 * `packages/persistence/package.json` configures `prisma.seed`, runs the
 * seed script itself as part of the reset (FR-012's "wipe and reseed" in a
 * single Prisma operation). The ordinary path runs `migrate deploy` (the
 * migrator image's default CMD, applying only new migrations) and then
 * `prisma db seed` explicitly — safe to repeat because the seed script
 * upserts on a fixed id (packages/persistence/prisma/seed.ts), so a repeat
 * deploy neither loses founder-generated data (FR-012) nor accumulates
 * duplicate fixture rows.
 */
function deployScript(stackConfig: StackConfig): string {
  const migrateStep = stackConfig.resetData
    ? `$COMPOSE run --rm migrate pnpm --filter @fp/persistence exec prisma migrate reset --force --skip-generate`
    : `$COMPOSE run --rm migrate
$COMPOSE run --rm migrate pnpm --filter @fp/persistence exec prisma db seed`;

  return `set -euo pipefail
IFS= read -r POSTGRES_PASSWORD
export POSTGRES_PASSWORD
export API_PUBLISHED_PORT='${String(stackConfig.apiPublishedPort)}'
export STAGING_NETWORK_NAME='${stackConfig.stagingNetworkName}'
cd '${REMOTE_DIR}'
docker load -i '${RUNTIME_TARBALL_NAME}'
docker load -i '${MIGRATOR_TARBALL_NAME}'
COMPOSE='docker compose -p family-platform-staging -f docker-compose.yml -f docker-compose.staging.yml'
${migrateStep}
$COMPOSE up -d
`;
}

export function createDeployCommand(
  stackConfig: StackConfig,
  images: StagingImages,
  dependsOn: pulumi.Resource[],
): remote.Command {
  return new remote.Command(
    'staging-migrate-and-deploy',
    {
      connection: connectionFor(stackConfig),
      create: deployScript(stackConfig),
      // `remote.Command`'s own `environment` option needs the SSH server to
      // list every one of those keys in `AcceptEnv` (OpenSSH denies
      // client-supplied environment variables by default, RFC 4254) — and it
      // fails atomically: reproduced against the real VPS, where a single
      // rejected key (RESET_DATA) failed the whole command with "ssh: setenv
      // failed" before the script ever ran, taking POSTGRES_PASSWORD down
      // with it even though sshd never objected to that one specifically.
      // Reconfiguring sshd_config would fix it, but that's a shared,
      // VPS-wide resource this deploy doesn't own (ADR-013's isolation from
      // the portfolio site's own containers doesn't extend to isolating a
      // system-level sshd_config edit). Every value the script needs is
      // instead either inlined directly above (synth-time-known, non-secret)
      // or delivered over the session's stdin below (the one secret) — both
      // work with zero server-side configuration.
      stdin: pulumi.secret(`${stackConfig.postgresPassword}\n`),
      // Content-addressed, not a timestamp: an unchanged deploy (US2
      // acceptance scenario 1 — "runs again with no changes") is then a
      // genuine no-op rather than an unconditional re-run, while a new image
      // or a flipped resetData reliably re-executes the script.
      triggers: [images.runtime.digest, images.migrator.digest, stackConfig.resetData],
    },
    { dependsOn },
  );
}
