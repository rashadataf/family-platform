import { mkdtempSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runQuiet } from './lib/exec.js';

/**
 * FR-006: `@fp/ui/tokens` imports nothing — not React, not React Native, not
 * `@fp/kernel` — so a future web client can consume it directly.
 * `token-layer-imports-nothing` in `.dependency-cruiser.cjs` already proves
 * this in the *source* import graph; this proves it at *runtime*, against
 * the built package a consumer actually installs.
 *
 * The proof is structural, not a string search: `packages/ui/dist/tokens`
 * is copied to a scratch directory with no `node_modules` anywhere in its
 * ancestry, then imported there in a fresh Node process. If that import
 * touched `react`, `react-native`, or anything else outside the directory
 * itself, Node would fail to resolve it and this would fail loudly — the
 * same way a genuinely portable module cannot fail this check by accident.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOKENS_DIST = join(REPO_ROOT, 'packages/ui/dist/tokens');

const PROBE_SCRIPT = `
import { colour, typography, space, radius, elevation, layout } from './index.js';

const modules = { colour, typography, space, radius, elevation, layout };
for (const [name, value] of Object.entries(modules)) {
  if (typeof value !== 'object' || value === null) {
    throw new Error(\`\${name} did not resolve to an object\`);
  }
}
console.log('PORTABLE');
`;

async function main(): Promise<void> {
  const build = await runQuiet('pnpm', ['--filter', '@fp/ui', 'build']);
  if (build.code !== 0) {
    console.error('Building @fp/ui failed:\n' + build.stderr);
    process.exit(1);
  }

  const scratchDir = mkdtempSync(join(tmpdir(), 'fp-ui-token-portability-'));
  try {
    cpSync(TOKENS_DIST, scratchDir, { recursive: true });
    writeFileSync(join(scratchDir, 'probe.mjs'), PROBE_SCRIPT);

    const probe = await runQuiet('node', [join(scratchDir, 'probe.mjs')]);
    if (probe.code !== 0 || !probe.stdout.includes('PORTABLE')) {
      console.error(
        '@fp/ui/tokens is not portable: importing it in an environment with no ' +
          'node_modules failed, which means something in it reaches outside the ' +
          'token layer.\n\n' +
          probe.stderr,
      );
      process.exit(1);
    }
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }

  console.log(
    '@fp/ui/tokens imports from plain Node with no react, no react-native, and no ' +
      'node_modules reachable at all (FR-006, verified at runtime).',
  );
}

await main();
