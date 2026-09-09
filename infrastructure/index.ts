import * as pulumi from '@pulumi/pulumi';
import { loadStackConfig } from './src/config.js';
import { buildStagingImages } from './src/image.js';
import { createTransfer } from './src/transfer.js';
import { createDeployCommand } from './src/deploy.js';

const cfg = new pulumi.Config();

/**
 * Read once, validated before any resource below is constructed
 * (Constitution Principle II) — see src/config.ts's loadStackConfig for why
 * this reads plain `cfg.get()` values rather than `requireSecret` Outputs.
 */
const stackConfig = loadStackConfig({
  vpsHost: cfg.get('vpsHost'),
  vpsSshUser: cfg.get('vpsSshUser'),
  vpsSshPort: cfg.get('vpsSshPort'),
  vpsSshPrivateKey: cfg.get('vpsSshPrivateKey'),
  postgresPassword: cfg.get('postgresPassword'),
  apiPublishedPort: cfg.get('apiPublishedPort'),
  stagingNetworkName: cfg.get('stagingNetworkName'),
  resetData: cfg.get('resetData'),
});

// config -> image -> transfer -> deploy (T012's wiring order).
const images = buildStagingImages();

/**
 * `transfer`/`deploy` are skipped entirely during a dry run (`pulumi
 * preview`, and the preview phase every `pulumi up` runs first).
 *
 * Both images set `buildOnPreview: false` (image.ts) so preview never
 * builds them at all — partly for CI speed, partly because doing so isn't
 * even meaningful here: the tarballs `transfer.ts`'s `pulumi.asset.FileAsset`
 * reads come from a `docker save` step (image.ts's `local.Command`) that
 * itself only runs once a build has actually happened, and a `FileAsset`
 * must read real bytes to compute its content hash even during preview.
 * Constructing `CopyToRemote` or the deploy `Command` at all during a
 * preview where none of that has happened would fail the same way, just
 * later in the chain.
 *
 * `pulumi.runtime.isDryRun()` — the SDK's own documented hook for exactly
 * this — skips both. `infra-preview`'s actual job (contracts/cli-and-config.md:
 * prove the program evaluates and shows a plan without mutating anything)
 * is still satisfied: the stack, its config, and both image resources are
 * still evaluated and diffed.
 */
let deployOutput: pulumi.Output<string> = pulumi.output('(no deploy: preview only)');
if (!pulumi.runtime.isDryRun()) {
  const transfer = createTransfer(stackConfig, images, [images.runtimeSaved, images.migratorSaved]);
  const deploy = createDeployCommand(stackConfig, images, transfer);
  deployOutput = deploy.stdout;
}

export const stagingUrl = pulumi.interpolate`http://${stackConfig.vpsHost}:${stackConfig.apiPublishedPort}`;
export { deployOutput };
