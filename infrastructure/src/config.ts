import { createPrivateKey } from 'node:crypto';
import { z } from 'zod';

/**
 * Docker's own reserved network names. A `stagingNetworkName` matching one
 * of these would attach staging's containers to a shared or special-purpose
 * network instead of a fresh, isolated one — the opposite of what FR-005
 * requires and what data-model.md's "plain, non-external network" decision
 * depends on.
 */
const DOCKER_RESERVED_NETWORK_NAMES = new Set(['bridge', 'host', 'none']);

/**
 * OpenSSH's own private-key container format (RFC-less, documented only in
 * OpenSSH's PROTOCOL.key source file) — the DEFAULT output of `ssh-keygen -t
 * ed25519` on every current OpenSSH version, standard or PKCS8 PEM never
 * enters the picture unless the user knows to ask for it. Node's own
 * `crypto.createPrivateKey` cannot parse this format at all (confirmed:
 * throws "DECODER routines::unsupported" regardless of Node version), so
 * `isWellFormedPrivateKey` needs a second path for it or it rejects the
 * single most common way anyone generates this exact kind of key — as
 * happened with the real vps-staging deploy key. `remote.Command`'s actual
 * SSH connection is implemented in `@pulumi/command`'s Go provider (there is
 * no `ssh2` or other JS SSH library in this dependency tree at all), whose
 * `golang.org/x/crypto/ssh` parser has always supported this format, so
 * accepting it here does not risk accepting something the real connection
 * would then reject.
 */
const OPENSSH_PRIVATE_KEY_HEADER =
  /^-----BEGIN OPENSSH PRIVATE KEY-----\r?\n([\s\S]+?)\r?\n-----END OPENSSH PRIVATE KEY-----$/;
const OPENSSH_PRIVATE_KEY_MAGIC = 'openssh-key-v1\0';

function isWellFormedOpenSshPrivateKey(pem: string): boolean {
  const match = OPENSSH_PRIVATE_KEY_HEADER.exec(pem.trim());
  if (!match?.[1]) {
    return false;
  }

  try {
    const body = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
    return (
      body.toString('binary', 0, OPENSSH_PRIVATE_KEY_MAGIC.length) === OPENSSH_PRIVATE_KEY_MAGIC
    );
  } catch {
    return false;
  }
}

function isWellFormedPrivateKey(pem: string): boolean {
  try {
    createPrivateKey({ key: pem, format: 'pem' });
    return true;
  } catch {
    return isWellFormedOpenSshPrivateKey(pem);
  }
}

/**
 * The typed shape of the `vps-staging` stack's configuration (data-model.md).
 * Every field is read once, before any Pulumi resource is constructed
 * (Constitution Principle II) — see `loadStackConfig` below.
 */
export const stackConfigSchema = z.object({
  vpsHost: z.string().min(1, 'vpsHost must not be empty'),
  vpsSshUser: z.string().min(1, 'vpsSshUser must not be empty'),
  vpsSshPort: z.coerce.number().int().positive().default(22),
  vpsSshPrivateKey: z
    .string()
    .min(1, 'vpsSshPrivateKey must not be empty')
    .refine(isWellFormedPrivateKey, {
      message:
        'vpsSshPrivateKey must be a well-formed PEM private key — a malformed key must fail before any container ever touches the VPS, not partway through a deploy',
    }),
  postgresPassword: z.string().min(1, 'postgresPassword must not be empty'),
  apiPublishedPort: z.coerce
    .number()
    .int()
    .min(1024, 'apiPublishedPort must be unprivileged (>= 1024)')
    .max(65535, 'apiPublishedPort must be a valid port (<= 65535)')
    .default(8080),
  stagingNetworkName: z
    .string()
    .min(1, 'stagingNetworkName must not be empty')
    .default('family-platform-staging')
    .refine((name) => !DOCKER_RESERVED_NETWORK_NAMES.has(name), {
      message: `stagingNetworkName must not be one of Docker's reserved network names (${Array.from(DOCKER_RESERVED_NETWORK_NAMES).join(', ')})`,
    }),
  // NOT `z.coerce.boolean()` — reproduced for real: `z.coerce.boolean()`
  // just calls JS's `Boolean(value)`, and `Boolean('false')` is `true` (only
  // an empty string is falsy). Since Pulumi config values are always
  // strings, `pulumi config set resetData false` produces the literal
  // string `'false'`, which `z.coerce.boolean()` would silently parse as
  // `true` — meaning every deploy with `resetData` explicitly set, however
  // it was set, ran the destructive wipe-and-reseed path, defeating
  // FR-012/SC-002's "ordinary redeploys preserve data" guarantee entirely.
  // Explicitly enumerating the two accepted strings and rejecting anything
  // else means a typo here fails loudly instead of silently either wiping
  // data that should have been kept or skipping a reset that was intended.
  resetData: z
    .enum(['true', 'false'], {
      message: "resetData must be the literal string 'true' or 'false'",
    })
    .optional()
    .transform((value) => value === 'true'),
});

export type StackConfig = z.infer<typeof stackConfigSchema>;

/**
 * The plain, string-valued shape `loadStackConfig` reads from — mirroring
 * `apps/api/src/config/load-env.ts`'s `NodeJS.ProcessEnv` parameter rather
 * than taking a `pulumi.Config` directly. Pulumi's `Config.get()` already
 * returns a value decrypted and available synchronously (secret-ness is a
 * property `requireSecret` attaches to the `Output` wrapper for propagation
 * through the resource graph, not a reason the raw value is unavailable
 * before then), so nothing about validating these fields needs the Pulumi
 * runtime — which is what keeps this module unit-testable with no VPS and no
 * Pulumi program running at all (research.md's testing discipline, applied
 * to config as much as to `deploy.spec.ts`'s resource assertions).
 */
export interface RawStackConfig {
  vpsHost?: string;
  vpsSshUser?: string;
  vpsSshPort?: string;
  vpsSshPrivateKey?: string;
  postgresPassword?: string;
  apiPublishedPort?: string;
  stagingNetworkName?: string;
  resetData?: string;
}

/**
 * Parses and validates the stack configuration eagerly. Throws — rather than
 * `process.exit`, `apps/api`'s choice for a long-running server — because a
 * Pulumi program is a single synchronous run that Pulumi itself reports the
 * failure of; an uncaught throw here reaches Pulumi before any resource is
 * registered, satisfying the same "fail by name, before anything is touched"
 * requirement env.schema.ts's pattern established.
 */
export function loadStackConfig(raw: RawStackConfig): StackConfig {
  const result = stackConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid vps-staging stack configuration:\n${issues}`);
  }

  return result.data;
}
