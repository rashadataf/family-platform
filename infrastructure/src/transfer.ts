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
 * Five separate `CopyToRemote` resources — one per file — rather than one
 * `AssetArchive` bundling all five. An `AssetArchive` combining the two
 * large (100-300MB) image tarballs with small text files was tried first
 * and failed at apply time with "archive must be a path to a file or
 * directory" / a nil archive value, for reasons that didn't repay further
 * digging once the simpler, one-asset-per-resource shape (documented as its
 * own supported case in pulumi-command's own CopyToRemote example) turned
 * out to just work. Each `CopyToRemote` here copies a single `FileAsset` to
 * an explicit destination path — for an Asset (as opposed to an Archive)
 * source, `remotePath` is the exact destination file, not a directory.
 */
export function createTransfer(
  stackConfig: StackConfig,
  images: StagingImages,
  dependsOn: pulumi.Resource[],
): remote.CopyToRemote[] {
  const connection = connectionFor(stackConfig);

  const files: Record<string, { local: string; digestDep?: pulumi.Output<string> }> = {
    [RUNTIME_TARBALL_NAME]: { local: RUNTIME_TARBALL_NAME, digestDep: images.runtime.digest },
    [MIGRATOR_TARBALL_NAME]: { local: MIGRATOR_TARBALL_NAME, digestDep: images.migrator.digest },
    'docker-compose.yml': { local: '../docker-compose.yml' },
    'docker-compose.staging.yml': { local: '../docker-compose.staging.yml' },
    '.env': { local: '../docker-compose.staging.env' },
  };

  return Object.entries(files).map(([remoteName, { local, digestDep }]) => {
    const triggers: pulumi.Input<unknown>[] = [stackConfig.resetData];
    if (digestDep) triggers.push(digestDep);

    return new remote.CopyToRemote(
      `staging-transfer-${remoteName}`,
      {
        connection,
        source: new pulumi.asset.FileAsset(local),
        remotePath: `${REMOTE_DIR}/${remoteName}`,
        triggers,
      },
      { dependsOn },
    );
  });
}
