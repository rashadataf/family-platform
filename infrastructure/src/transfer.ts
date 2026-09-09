import * as pulumi from '@pulumi/pulumi';
import { remote, types } from '@pulumi/command';
import type { StackConfig } from './config.js';
import { MIGRATOR_TARBALL_NAME, RUNTIME_TARBALL_NAME, type StagingImages } from './image.js';

/**
 * Where the bundle lands on the VPS, and where `deploy.ts`'s script `cd`s to
 * run `docker compose`. A fixed, documented path rather than the SSH user's
 * home directory, so a deploy behaves the same regardless of which user
 * account the connection uses.
 */
export const REMOTE_DIR = '/opt/family-platform-staging';

export function connectionFor(stackConfig: StackConfig): types.input.remote.ConnectionArgs {
  return {
    host: stackConfig.vpsHost,
    user: stackConfig.vpsSshUser,
    port: stackConfig.vpsSshPort,
    privateKey: stackConfig.vpsSshPrivateKey,
  };
}

/**
 * One `CopyToRemote`, one archive: the two built image tarballs, the two
 * compose files, and the fixed non-secret `.env` template `docker-compose.staging.yml`
 * requires (docker-compose.staging.env, landing as `.env` — see that file's
 * own comment for why POSTGRES_PASSWORD is never here). An Archive source is
 * extracted into `remotePath` as a directory tree, not copied as a single
 * compressed file (confirmed against pulumi-command's own CopyToRemote
 * example), so `deploy.ts` finds these five files directly under REMOTE_DIR.
 *
 * `triggers` are the two images' content digests plus `resetData`: without
 * an explicit trigger, an unchanged build could be treated as no-op and
 * skip re-transferring, which is fine when nothing changed but wrong the
 * moment resetData flips with an otherwise-identical image.
 */
export function createTransfer(
  stackConfig: StackConfig,
  images: StagingImages,
  dependsOn: pulumi.Resource[],
): remote.CopyToRemote {
  const bundle = new pulumi.asset.AssetArchive({
    [RUNTIME_TARBALL_NAME]: new pulumi.asset.FileAsset(RUNTIME_TARBALL_NAME),
    [MIGRATOR_TARBALL_NAME]: new pulumi.asset.FileAsset(MIGRATOR_TARBALL_NAME),
    'docker-compose.yml': new pulumi.asset.FileAsset('../docker-compose.yml'),
    'docker-compose.staging.yml': new pulumi.asset.FileAsset('../docker-compose.staging.yml'),
    '.env': new pulumi.asset.FileAsset('../docker-compose.staging.env'),
  });

  return new remote.CopyToRemote(
    'staging-bundle-transfer',
    {
      connection: connectionFor(stackConfig),
      source: bundle,
      remotePath: REMOTE_DIR,
      triggers: [images.runtime.digest, images.migrator.digest, stackConfig.resetData],
    },
    { dependsOn },
  );
}
