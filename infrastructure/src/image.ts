import * as dockerBuild from '@pulumi/docker-build';

/**
 * Tags baked into each exported tarball (`docker save`-equivalent) and the
 * tag `docker-compose.staging.yml`'s `image:` fields must match exactly —
 * the two files share no automated source of truth for this string, so a
 * rename in one and not the other fails at `docker compose up` with "image
 * not found", not at review time.
 */
export const RUNTIME_IMAGE_TAG = 'fp-api:staging-runtime';
export const MIGRATOR_IMAGE_TAG = 'fp-api:staging-migrator';

export const RUNTIME_TARBALL_NAME = 'fp-api-runtime.tar';
export const MIGRATOR_TARBALL_NAME = 'fp-api-migrator.tar';

export interface StagingImages {
  runtime: dockerBuild.Image;
  migrator: dockerBuild.Image;
}

/**
 * Builds the same two Dockerfile targets CI's `image` job already builds and
 * health-checks on every pull request (FR-018) — this feature defines no
 * Dockerfile of its own. Built locally, on whichever machine runs
 * `pulumi up` (the founder's laptop or the CI runner, research.md §1), then
 * exported to a local tarball rather than pushed anywhere (research.md §1's
 * "no registry" decision) — `transfer.ts` hands the tarball to the VPS over
 * SSH, where `deploy.ts` loads it with `docker load`.
 */
export function buildStagingImages(): StagingImages {
  const common = {
    // Resolved relative to the Pulumi program's CWD (`--cwd infrastructure`,
    // contracts/cli-and-config.md) — one level up is the repository root,
    // which the Dockerfile requires as its build context (apps/api/Dockerfile's
    // own comment: "Build context is the REPOSITORY ROOT, not apps/api").
    context: { location: '..' },
    dockerfile: { location: '../apps/api/Dockerfile' },
    platforms: [dockerBuild.Platform.Linux_amd64],
    push: false,
  };

  const runtime = new dockerBuild.Image('staging-runtime-image', {
    ...common,
    target: 'runtime',
    exports: [{ docker: { tar: true, dest: RUNTIME_TARBALL_NAME, names: [RUNTIME_IMAGE_TAG] } }],
  });

  const migrator = new dockerBuild.Image('staging-migrator-image', {
    ...common,
    target: 'migrator',
    exports: [{ docker: { tar: true, dest: MIGRATOR_TARBALL_NAME, names: [MIGRATOR_IMAGE_TAG] } }],
  });

  return { runtime, migrator };
}
