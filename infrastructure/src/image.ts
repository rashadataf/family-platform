import * as dockerBuild from '@pulumi/docker-build';
import { local } from '@pulumi/command';

/**
 * Tags baked into each image and the tag `docker-compose.staging.yml`'s
 * `image:` fields must match exactly — the two files share no automated
 * source of truth for this string, so a rename in one and not the other
 * fails at `docker compose up` with "image not found", not at review time.
 */
export const RUNTIME_IMAGE_TAG = 'fp-api:staging-runtime';
export const MIGRATOR_IMAGE_TAG = 'fp-api:staging-migrator';

export const RUNTIME_TARBALL_NAME = 'fp-api-runtime.tar';
export const MIGRATOR_TARBALL_NAME = 'fp-api-migrator.tar';

export interface StagingImages {
  runtime: dockerBuild.Image;
  migrator: dockerBuild.Image;
  /** The `docker save` step each image's tarball depends on (transfer.ts). */
  runtimeSaved: local.Command;
  migratorSaved: local.Command;
}

/**
 * Loads a just-built image into the local Docker daemon and immediately
 * saves it to a tarball on disk.
 *
 * Not `docker-build.Image`'s own `exports: [{ docker: { dest, tar } }]` —
 * verified empirically (built and reproduced outside Pulumi with a plain
 * `docker buildx build`, which worked fine, then traced the difference into
 * the provider's own Go source): `@pulumi/docker-build` 0.0.22 unconditionally
 * routes every export's `dest` into buildkit's `OutputDir` (client.go),
 * which is correct for its `tar`/`local` export types but wrong for
 * `docker`/`oci` types, which need a file-stream target instead. The result
 * is buildkit's own "both file and store output is not supported by oci
 * exporter" — during `pulumi preview` *and* during a real `pulumi up`. This
 * is a real limitation in a resource its own docs already call "pre-1.0 and
 * in public preview," not a mistake in this configuration.
 *
 * `load: true` is docker-build's primary, well-tested path (equivalent to
 * `docker buildx build --load`), so it sidesteps that code path entirely.
 * `docker save` afterward is a plain, ordinary local.Command — nothing about
 * it depends on docker-build at all.
 */
function loadAndSave(
  name: string,
  tag: string,
  tarballPath: string,
  image: dockerBuild.Image,
): local.Command {
  return new local.Command(
    `${name}-save`,
    {
      create: `docker save '${tag}' -o '${tarballPath}'`,
      // Re-runs whenever the built image's content changes; skipped
      // entirely during preview the same way remote.Command's create is
      // (verified: no attempt to run this against a not-yet-built image).
      triggers: [image.digest],
    },
    { dependsOn: [image] },
  );
}

/**
 * Builds the same two Dockerfile targets CI's `image` job already builds and
 * health-checks on every pull request (FR-018) — this feature defines no
 * Dockerfile of its own. Built locally, on whichever machine runs
 * `pulumi up` (the founder's laptop or the CI runner, research.md §1), then
 * saved to a local tarball rather than pushed anywhere (research.md §1's
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
    load: true,
    // infra-preview's whole job is proving the program still evaluates and
    // shows a plan without mutating anything (contracts/cli-and-config.md) —
    // it never needed to actually build a multi-hundred-MB image on every
    // pull request, so skipping the build on preview loses nothing.
    buildOnPreview: false,
  };

  const runtime = new dockerBuild.Image('staging-runtime-image', {
    ...common,
    target: 'runtime',
    tags: [RUNTIME_IMAGE_TAG],
  });
  const runtimeSaved = loadAndSave(
    'staging-runtime-image',
    RUNTIME_IMAGE_TAG,
    RUNTIME_TARBALL_NAME,
    runtime,
  );

  const migrator = new dockerBuild.Image('staging-migrator-image', {
    ...common,
    target: 'migrator',
    tags: [MIGRATOR_IMAGE_TAG],
  });
  const migratorSaved = loadAndSave(
    'staging-migrator-image',
    MIGRATOR_IMAGE_TAG,
    MIGRATOR_TARBALL_NAME,
    migrator,
  );

  return { runtime, migrator, runtimeSaved, migratorSaved };
}
