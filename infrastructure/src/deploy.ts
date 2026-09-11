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
# docker-compose.staging.yml's DATABASE_URL needs the password safe to sit
# inside a postgresql:// URL. A real, randomly-generated password can
# contain characters ('@', ':', '/', '%', ...) that are meaningful in URL
# syntax; substituted in raw, they silently corrupt the connection string
# instead of failing loudly (hit for real: Prisma's own "P1013 invalid port
# number", from a password containing a character that shifted where it
# thought the host:port segment started). Postgres's own POSTGRES_PASSWORD
# (set from the unencoded value above, via docker-compose.yml) takes it as a
# literal string, not a URL component, so only the URL-consuming variable
# needs encoding.
POSTGRES_PASSWORD_URLENCODED=''
for ((i = 0; i < \${#POSTGRES_PASSWORD}; i++)); do
  c="\${POSTGRES_PASSWORD:i:1}"
  case "$c" in
    [a-zA-Z0-9.~_-]) POSTGRES_PASSWORD_URLENCODED+="$c" ;;
    *) printf -v hex '%%%02X' "'$c"; POSTGRES_PASSWORD_URLENCODED+="$hex" ;;
  esac
done
export POSTGRES_PASSWORD_URLENCODED
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

/**
 * `pulumi destroy` without this: verified against the real VPS that neither
 * `remote.Command` nor `CopyToRemote` runs anything on delete unless a
 * `delete` script is given (this one's own `create` was defined, `delete`
 * never was) — the stack would just stop being tracked while `postgres` and
 * `api` kept running and `${REMOTE_DIR}` kept every transferred file,
 * completely undetected by Pulumi's own state.
 *
 * Guarded by `[ -d ... ]` rather than assuming the directory exists: a
 * destroy must succeed even against a stack that never finished deploying
 * (or was already torn down by hand) — a `cd` into a missing directory
 * under `set -e` would fail the whole delete and leave Pulumi's state
 * stuck expecting a resource that failed to go away, which is a much worse
 * state than "nothing to clean up."
 *
 * `--volumes`: a destroy is expected to leave nothing behind, including the
 * database's own data — `docker compose down` alone keeps the named
 * `postgres_data` volume. Scoped safely to only this stack's own volume by
 * the same `-p family-platform-staging` project name `deployScript` already
 * uses (data-model.md / T028's isolation guarantee), not by any special
 * handling here.
 *
 * Empties `REMOTE_DIR` rather than removing it — verified against the real
 * VPS that `rm -rf` on the directory itself fails with "Permission denied":
 * deleting a directory needs write access to its *parent* (`/opt`, root-
 * owned), not the directory being deleted, so `deploy` can remove
 * everything it owns inside `REMOTE_DIR` but not the now-empty shell.
 * `find -mindepth 1 -delete` (rather than a `rm -rf .[!.]* *` glob pair)
 * catches dotfiles like the transferred `.env` without needing two
 * patterns, and leaves a directory `deploy` already owns in place for the
 * next deploy to write straight back into.
 *
 * Guarded again by `[ -f docker-compose.yml ]` before running `compose
 * down` — hit for real: the `rm -rf` bug above deletes a directory's
 * *contents* before failing on the directory itself (`rm -rf` removes
 * children first), so a destroy that failed on that old bug leaves
 * `REMOTE_DIR` existing but empty. A retried destroy then satisfies the
 * `[ -d ... ]` check, `cd`s in, and fails immediately trying to read a
 * `docker-compose.yml` that's already gone. There's nothing left to bring
 * down via Compose at that point anyway (the earlier failed run's own
 * `compose down` step already completed before the `rm -rf` line ran), so
 * skipping straight to emptying the directory is correct, not just
 * convenient.
 */
function teardownScript(): string {
  return `set -euo pipefail
if [ -d '${REMOTE_DIR}' ]; then
  cd '${REMOTE_DIR}'
  if [ -f docker-compose.yml ]; then
    COMPOSE='docker compose -p family-platform-staging -f docker-compose.yml -f docker-compose.staging.yml'
    $COMPOSE down --volumes --remove-orphans
  fi
  cd /
  find '${REMOTE_DIR}' -mindepth 1 -delete
fi
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
      delete: teardownScript(),
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
