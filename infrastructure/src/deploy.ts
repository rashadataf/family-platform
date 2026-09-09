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
 * Two branches, not one command with a flag, because they are genuinely
 * different operations: `prisma migrate reset --force` drops the database
 * and, since `packages/persistence/package.json` configures `prisma.seed`,
 * runs the seed script itself as part of the reset (FR-012's "wipe and
 * reseed" in a single Prisma operation). The ordinary path runs
 * `migrate deploy` (the migrator image's default CMD, applying only new
 * migrations) and then `prisma db seed` explicitly — safe to repeat because
 * the seed script upserts on a fixed id (packages/persistence/prisma/seed.ts),
 * so a repeat deploy neither loses founder-generated data (FR-012) nor
 * accumulates duplicate fixture rows.
 */
function deployScript(): string {
  return `set -euo pipefail
cd '${REMOTE_DIR}'
docker load -i '${RUNTIME_TARBALL_NAME}'
docker load -i '${MIGRATOR_TARBALL_NAME}'
COMPOSE='docker compose -p family-platform-staging -f docker-compose.yml -f docker-compose.staging.yml'
if [ "\${RESET_DATA}" = "true" ]; then
  $COMPOSE run --rm migrate pnpm --filter @fp/persistence exec prisma migrate reset --force --skip-generate
else
  $COMPOSE run --rm migrate
  $COMPOSE run --rm migrate pnpm --filter @fp/persistence exec prisma db seed
fi
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
      create: deployScript(),
      environment: {
        RESET_DATA: stackConfig.resetData ? 'true' : 'false',
        POSTGRES_PASSWORD: stackConfig.postgresPassword,
        API_PUBLISHED_PORT: String(stackConfig.apiPublishedPort),
        STAGING_NETWORK_NAME: stackConfig.stagingNetworkName,
      },
      // Content-addressed, not a timestamp: an unchanged deploy (US2
      // acceptance scenario 1 — "runs again with no changes") is then a
      // genuine no-op rather than an unconditional re-run, while a new image
      // or a flipped resetData reliably re-executes the script.
      triggers: [images.runtime.digest, images.migrator.digest, stackConfig.resetData],
    },
    { dependsOn },
  );
}
