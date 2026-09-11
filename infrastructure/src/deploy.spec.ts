import { beforeAll, describe, expect, it } from 'vitest';
import * as pulumi from '@pulumi/pulumi';

/**
 * `Output<T>` has no `.promise()` in this SDK version — only `.apply()`
 * (deployment-time) and `.get()` (cloud-runtime-only, throws under mocks).
 * This is the standard bridge between the two, used the same way Pulumi's
 * own testing docs use `.apply(...).then(done)` for a mocha `done` callback,
 * adapted to vitest's async/await style.
 */
function resolveOutput<T>(output: pulumi.Output<T>): Promise<T> {
  return new Promise((resolve) => {
    output.apply(resolve);
  });
}

/**
 * research.md §5: the one real assertion behind this package's "Unit tests"
 * gate, not a speculative suite. Pulumi's mock testing harness
 * (`pulumi.runtime.setMocks`) intercepts every resource registration —
 * nothing here reaches Docker, SSH, or Pulumi Cloud — so this needs no VPS
 * and no network, and is what "verified myself" means for a package whose
 * real behaviour otherwise only a founder-run deploy can prove.
 *
 * Mocks must be set BEFORE the modules under test are imported (Pulumi's own
 * testing docs), which is why every import below is dynamic and happens in
 * `beforeAll`, after `setMocks` — both at module scope would race, since
 * `setMocks` itself returns a Promise.
 */
async function installMocks(): Promise<void> {
  await pulumi.runtime.setMocks(
    {
      newResource(args: pulumi.runtime.MockResourceArgs): pulumi.runtime.MockResourceResult {
        const inputs = args.inputs as Record<string, unknown>;
        if (args.type === 'docker-build:index:Image') {
          return { id: `${args.name}-id`, state: { ...inputs, digest: 'sha256:fake-digest' } };
        }
        return { id: `${args.name}-id`, state: inputs };
      },
      call(args: pulumi.runtime.MockCallArgs): pulumi.runtime.MockCallResult {
        return args.inputs as Record<string, unknown>;
      },
    },
    'infrastructure',
    'test-stack',
    false,
  );
}

const VALID_RAW = {
  vpsHost: '203.0.113.10',
  vpsSshUser: 'deploy',
  vpsSshPrivateKey: `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIMKN9gLVY833sHBscKsZE+SdwV5sJw5yFgnoRgm4VN5l
-----END PRIVATE KEY-----`,
  postgresPassword: 'a-real-secret-would-go-here',
};

describe('infrastructure resource wiring', () => {
  let stackConfig: import('./config.js').StackConfig;
  let transfers: import('@pulumi/command').remote.CopyToRemote[];
  let deploy: import('@pulumi/command').remote.Command;
  let teardown: import('@pulumi/command').remote.Command;

  beforeAll(async () => {
    await installMocks();

    const { loadStackConfig } = await import('./config.js');
    const { buildStagingImages } = await import('./image.js');
    const { createTransfer } = await import('./transfer.js');
    const { createDeployCommand, createTeardownCommand } = await import('./deploy.js');

    stackConfig = loadStackConfig(VALID_RAW);
    const images = buildStagingImages();
    transfers = createTransfer(stackConfig, images, [images.runtimeSaved, images.migratorSaved]);
    deploy = createDeployCommand(stackConfig, images, transfers);
    teardown = createTeardownCommand(stackConfig, transfers);
  });

  /**
   * Every `command.remote.*` resource's connection host must be sourced from
   * the same `StackConfig.vpsHost` value, never a second, possibly-drifted
   * literal — the concrete form "the staging environment must never share a
   * host with something else" takes for several SSH-connected resources.
   */
  it('sources every remote connection from the same StackConfig.vpsHost', async () => {
    const transferHosts = await Promise.all(transfers.map((t) => resolveOutput(t.connection.host)));
    const deployHost = await resolveOutput(deploy.connection.host);
    const teardownHost = await resolveOutput(teardown.connection.host);

    expect(transferHosts.length).toBeGreaterThan(0);
    for (const host of transferHosts) {
      expect(host).toBe(stackConfig.vpsHost);
    }
    expect(deployHost).toBe(stackConfig.vpsHost);
    expect(teardownHost).toBe(stackConfig.vpsHost);
  });

  /**
   * The deploy command's staging network name must be the one StackConfig
   * validated (config.spec.ts already proves Docker's reserved names —
   * bridge/host/none — are rejected there), not a literal repeated in
   * deploy.ts that could drift from it and silently defeat FR-005's
   * isolation from the portfolio site's containers.
   */
  it('propagates the validated stagingNetworkName into the deploy script', async () => {
    const script = await resolveOutput(deploy.create);
    expect(script).toContain(`STAGING_NETWORK_NAME='${stackConfig.stagingNetworkName}'`);
  });

  it('never puts the postgres password in the deploy script text itself', async () => {
    const script = await resolveOutput(deploy.create);
    expect(script).not.toContain(stackConfig.postgresPassword);
  });

  /**
   * `remote.Command`'s `environment` option is unusable against the real
   * VPS (deploy.ts's comment on `createDeployCommand`: OpenSSH rejects
   * client-supplied environment variables by default, and fails the whole
   * command — not just the rejected key). `stdin` is the replacement path
   * for the one value that must not appear in the script text itself.
   */
  it('delivers the postgres password to the remote shell via stdin, not environment', async () => {
    const stdin = await resolveOutput(deploy.stdin);
    expect(stdin).toContain(stackConfig.postgresPassword);
  });

  it('sets no SSH-level environment variables (unsupported by the real VPS sshd)', async () => {
    const environment = await resolveOutput(deploy.environment);
    expect(environment).toBeUndefined();
  });

  /**
   * The self-destruct bug, reproduced for real against the VPS: `deploy`'s
   * `triggers` change on every single deploy (image.ts's cache-busting
   * label), so `remote.Command`'s always-replace-on-change behaviour means
   * `deploy` is replaced on every deploy — create the new instance, then
   * delete the superseded old one. A real teardown script on THIS resource
   * therefore ran on every ordinary deploy too, immediately tearing down
   * what the create step had just brought up: a deploy reported success,
   * and the very next one failed with `docker-compose.yml` missing —
   * silently deleted by its own predecessor's delete step. `deploy` must
   * never carry a `delete` again; the real teardown script belongs only on
   * `createTeardownCommand`'s resource, whose inputs don't vary deploy to
   * deploy.
   */
  it('never puts a delete script on the resource that replaces every deploy', async () => {
    const deleteScript = await resolveOutput(deploy.delete);
    expect(deleteScript).toBeUndefined();
  });

  /**
   * The other half of the self-destruct fix: `teardown`'s inputs must be
   * stable across ordinary deploys (no image digests, no `resetData`) so it
   * is never replaced by a normal `pnpm staging:deploy` — only a genuine
   * `pulumi destroy` should ever invoke its `delete`.
   */
  it('gives the teardown-owning resource no triggers that vary across ordinary deploys', async () => {
    const triggers = await resolveOutput(teardown.triggers);
    expect(triggers).toBeUndefined();
  });

  /**
   * Without a `delete` script, `pulumi destroy` leaves everything running on
   * the VPS untouched while Pulumi's own state reports a clean teardown —
   * verified against the real VPS before this test existed. `--volumes` is
   * asserted specifically because `docker compose down` alone keeps the
   * named Postgres volume, which would silently defeat a destroy meant to
   * leave nothing behind.
   */
  it('tears the deployment down on destroy, including its data volume', async () => {
    const script = await resolveOutput(teardown.delete);
    expect(script).toContain('docker compose');
    expect(script).toContain('down');
    expect(script).toContain('--volumes');
  });

  it('guards the teardown script against a missing remote directory', async () => {
    const script = await resolveOutput(teardown.delete);
    expect(script).toMatch(/if \[ -d .* \]; then/);
  });

  /**
   * `rm -rf` on REMOTE_DIR itself was the first version of this script —
   * verified against the real VPS that it fails with "Permission denied":
   * removing a directory needs write access to its *parent* (`/opt`,
   * root-owned), not the directory being removed. Asserting the replacement
   * (`find ... -delete`) rather than just "not rm -rf" pins the actual fix,
   * not just the absence of the broken one.
   */
  it('empties the remote directory rather than removing it (avoids a parent-permission failure)', async () => {
    const script = await resolveOutput(teardown.delete);
    expect(script).toContain('-mindepth 1 -delete');
  });

  /**
   * Verified against the real VPS: a destroy that already failed once on the
   * old `rm -rf` bug leaves REMOTE_DIR existing but with its contents
   * (including docker-compose.yml) already removed — `rm -rf` deletes
   * children before the parent. A retried destroy must not assume the
   * compose file is still there just because the directory is.
   */
  it('guards the compose-down step against an already-emptied remote directory', async () => {
    const script = await resolveOutput(teardown.delete);
    expect(script).toMatch(/if \[ -f docker-compose\.yml \]; then/);
  });
});
