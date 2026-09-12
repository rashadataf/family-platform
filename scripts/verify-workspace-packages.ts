import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Every workspace package must be declared in the three places that do not
 * discover it automatically.
 *
 * ADR-014 requires a duplication to be guarded by a check rather than a
 * comment, "because a convention only a comment protects is one that drifts
 * silently". Both files below carry exactly such a comment today, and both
 * were missed while adding `packages/testing` — the compose volume was
 * remembered, the Dockerfile COPY was not.
 *
 * The failure has no good symptom. `docker compose run --rm api pnpm test`
 * dies with "Cannot find package '@fp/…'", which reads like a broken install
 * rather than a missing line in a Dockerfile, and it only appears on the
 * containerized path — so the host-based contributor who added the package
 * never sees it, and ADR-014's promise that Docker is the supported path is
 * quietly broken for everyone else.
 */

const root = new URL('../', import.meta.url);

/**
 * Both images built from this repository, not just the API's. `apps/worker`
 * has its own Dockerfile with its own deps stage and its own copy of the
 * manifest list, and checking only the API's is how `packages/ui` came to be
 * declared in one image and missing from the other — the exact drift this
 * check exists to catch, reproduced by the check itself.
 */
const DOCKERFILES = ['apps/api/Dockerfile', 'apps/worker/Dockerfile'] as const;
const COMPOSE = 'docker-compose.yml';
const CRUISER = '.dependency-cruiser.cjs';

export interface WorkspaceReport {
  ok: boolean;
  packages: string[];
  message: string;
}

/** `apps/*` and `packages/*` directories holding a package.json. */
function discoverPackages(baseUrl: URL): string[] {
  const found: string[] = [];
  for (const group of ['apps', 'packages']) {
    const groupUrl = new URL(`${group}/`, baseUrl);
    if (!existsSync(groupUrl)) continue;
    for (const entry of readdirSync(groupUrl, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (existsSync(new URL(`${entry.name}/package.json`, groupUrl))) {
        found.push(`${group}/${entry.name}`);
      }
    }
  }
  return found.sort();
}

export function checkDeclarations(
  packages: readonly string[],
  files: { dockerfiles: Readonly<Record<string, string>>; compose: string; cruiser: string },
): WorkspaceReport {
  const problems: string[] = [];

  for (const pkg of packages) {
    const name = pkg.split('/')[1] ?? '';

    for (const [dockerfile, contents] of Object.entries(files.dockerfiles)) {
      if (!contents.includes(`COPY ${pkg}/package.json`)) {
        problems.push(
          `  ${pkg}\n    missing from ${dockerfile}: add \`COPY ${pkg}/package.json ${pkg}/\` to the deps stage.\n` +
            `    Without it the image installs no dependencies for this package and the containerized path fails at import.`,
        );
      }
    }

    // Only workspace packages the API container mounts need a volume; every
    // package under apps/ or packages/ currently does.
    if (!files.compose.includes(`:/app/${pkg}/node_modules`)) {
      problems.push(
        `  ${pkg}\n    missing from ${COMPOSE}: add a named volume mounted at /app/${pkg}/node_modules.\n` +
          `    The bind mount of the repository at /app otherwise shadows it, leaving dangling pnpm symlinks.`,
      );
    }

    if (!files.cruiser.includes(`'${pkg}'`)) {
      problems.push(
        `  ${pkg}\n    missing from ${CRUISER}: add it to WORKSPACE_GRAPH.\n` +
          `    The boundary gate fails closed, so this is caught there too — but it is cheaper to read it here.`,
      );
    }

    if (name === '') problems.push(`  ${pkg}\n    unexpected package path.`);
  }

  if (problems.length > 0) {
    return {
      ok: false,
      packages: [...packages],
      message: `${String(problems.length)} workspace declaration(s) missing:\n${problems.join('\n')}`,
    };
  }

  return {
    ok: true,
    packages: [...packages],
    message: `All ${String(packages.length)} workspace packages are declared in ${DOCKERFILES.join(', ')}, ${COMPOSE} and ${CRUISER}.`,
  };
}

export function checkWorkspacePackages(): WorkspaceReport {
  const read = (path: string) => readFileSync(new URL(path, root), 'utf-8');
  return checkDeclarations(discoverPackages(root), {
    dockerfiles: Object.fromEntries(DOCKERFILES.map((path) => [path, read(path)])),
    compose: read(COMPOSE),
    cruiser: read(CRUISER),
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const result = checkWorkspacePackages();
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}
