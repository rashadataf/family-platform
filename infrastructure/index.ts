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
const transfer = createTransfer(stackConfig, images, [images.runtime, images.migrator]);
const deploy = createDeployCommand(stackConfig, images, [transfer]);

export const stagingUrl = pulumi.interpolate`http://${stackConfig.vpsHost}:${stackConfig.apiPublishedPort}`;
export const deployOutput = deploy.stdout;
