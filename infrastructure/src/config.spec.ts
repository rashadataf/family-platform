import { describe, expect, it } from 'vitest';
import { loadStackConfig, type RawStackConfig } from './config.js';

/**
 * A throwaway, locally-generated Ed25519 key with no relation to any real
 * host — present only so `isWellFormedPrivateKey` has something well-formed
 * to accept. Generated with `openssl genpkey -algorithm ed25519`.
 */
const WELL_FORMED_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIMKN9gLVY833sHBscKsZE+SdwV5sJw5yFgnoRgm4VN5l
-----END PRIVATE KEY-----`;

/**
 * A throwaway, locally-generated Ed25519 key in OpenSSH's own private-key
 * format — `ssh-keygen -t ed25519`'s DEFAULT output, and what the real
 * vps-staging deploy key turned out to be. Node's `crypto.createPrivateKey`
 * cannot parse this format at all, which is exactly the gap
 * `isWellFormedOpenSshPrivateKey` (config.ts) exists to cover.
 */
const WELL_FORMED_OPENSSH_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDqr8NqswYlNe5h+oMWYGv59j3P+rREwPejto4iIBu3+wAAAKhcFBP/XBQT
/wAAAAtzc2gtZWQyNTUxOQAAACDqr8NqswYlNe5h+oMWYGv59j3P+rREwPejto4iIBu3+w
AAAECVJy6bhTf5GaCocZGQvDv31IR0+Zp/F54bnk8V24Y3hOqvw2qzBiU17mH6gxZga/n2
Pc/6tETA96O2jiIgG7f7AAAAH3Rocm93YXdheS10ZXN0LWtleS1uby1yZWFsLWhvc3QBAg
MEBQY=
-----END OPENSSH PRIVATE KEY-----`;

const VALID_RAW: RawStackConfig = {
  vpsHost: '203.0.113.10',
  vpsSshUser: 'deploy',
  vpsSshPrivateKey: WELL_FORMED_PEM,
  postgresPassword: 'a-real-secret-would-go-here',
};

/**
 * Constitution Principle II, applied to a Pulumi program rather than a
 * server: a misconfigured stack must fail immediately and by name, before
 * anything reaches the VPS. These tests pin that every validation rule in
 * data-model.md's `StackConfig` table actually fires, and that the defaults
 * documented there are the ones applied.
 */
describe('loadStackConfig', () => {
  it('parses a valid configuration and applies documented defaults', () => {
    const config = loadStackConfig(VALID_RAW);

    expect(config.vpsHost).toBe('203.0.113.10');
    expect(config.vpsSshUser).toBe('deploy');
    expect(config.vpsSshPort).toBe(22);
    expect(config.apiPublishedPort).toBe(8080);
    expect(config.stagingNetworkName).toBe('family-platform-staging');
    expect(config.resetData).toBe(false);
  });

  it('coerces numeric and boolean string config values', () => {
    const config = loadStackConfig({
      ...VALID_RAW,
      vpsSshPort: '2222',
      apiPublishedPort: '9000',
      resetData: 'true',
    });

    expect(config.vpsSshPort).toBe(2222);
    expect(config.apiPublishedPort).toBe(9000);
    expect(config.resetData).toBe(true);
  });

  it('rejects an empty vpsHost', () => {
    expect(() => loadStackConfig({ ...VALID_RAW, vpsHost: '' })).toThrow(/vpsHost/);
  });

  it('rejects an empty vpsSshUser', () => {
    expect(() => loadStackConfig({ ...VALID_RAW, vpsSshUser: '' })).toThrow(/vpsSshUser/);
  });

  it('rejects a malformed vpsSshPrivateKey before any resource is constructed', () => {
    expect(() => loadStackConfig({ ...VALID_RAW, vpsSshPrivateKey: 'not a pem key' })).toThrow(
      /vpsSshPrivateKey/,
    );
  });

  it("accepts an OpenSSH-format vpsSshPrivateKey (ssh-keygen -t ed25519's default output)", () => {
    expect(() =>
      loadStackConfig({ ...VALID_RAW, vpsSshPrivateKey: WELL_FORMED_OPENSSH_KEY }),
    ).not.toThrow();
  });

  it('rejects an empty postgresPassword', () => {
    expect(() => loadStackConfig({ ...VALID_RAW, postgresPassword: '' })).toThrow(
      /postgresPassword/,
    );
  });

  it('rejects an apiPublishedPort below the unprivileged range', () => {
    expect(() => loadStackConfig({ ...VALID_RAW, apiPublishedPort: '80' })).toThrow(
      /apiPublishedPort/,
    );
  });

  it('rejects an apiPublishedPort above the valid port range', () => {
    expect(() => loadStackConfig({ ...VALID_RAW, apiPublishedPort: '70000' })).toThrow(
      /apiPublishedPort/,
    );
  });

  it.each(['bridge', 'host', 'none'])(
    'rejects %s as stagingNetworkName — one of Docker reserved network names',
    (reserved) => {
      expect(() => loadStackConfig({ ...VALID_RAW, stagingNetworkName: reserved })).toThrow(
        /stagingNetworkName/,
      );
    },
  );

  it('names every invalid field in a single error, not just the first', () => {
    expect(() => loadStackConfig({ vpsHost: '', vpsSshUser: '', postgresPassword: '' })).toThrow(
      /vpsHost[\s\S]*vpsSshUser|vpsSshUser[\s\S]*vpsHost/,
    );
  });
});
