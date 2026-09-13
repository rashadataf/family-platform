const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

/**
 * Metro configured for pnpm's strict, non-hoisted symlinked workspace
 * (research R1). `node-linker=hoisted` is the conventional fix for "Metro
 * cannot resolve in a pnpm monorepo" and it is deliberately NOT used: it
 * would delete Constitution Principle III's dependency-absence enforcement
 * layer for the whole repository, not just this app, to solve a bundler
 * inconvenience.
 */
const workspaceRoot = path.resolve(__dirname, '../..');
const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// Metro must watch the whole workspace, not just apps/mobile: a real
// dependency, `@fp/ui`, lives outside this directory and pnpm links to it by
// a symlink Metro needs to follow.
config.watchFolders = [workspaceRoot];

// Resolve node_modules from both this app and the workspace root — pnpm's
// strict layout means most packages a dependency needs are NOT hoisted into
// apps/mobile/node_modules, only into the root or the dependency's own
// directory.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Left at Metro's default (true): pnpm's node_modules IS a symlink farm, and
// Metro must follow those links rather than treat them as opaque files.
config.resolver.unstable_enableSymlinks = true;

// Source in this repo imports its own TypeScript siblings with an explicit
// `.js` extension (the NodeNext/ESM convention `tsc` expects, used
// throughout packages/ui and carried into this app) — but that file never
// exists on disk before a build; only `foo.tsx`/`foo.ts` does. Metro has no
// built-in notion of this convention and fails to resolve it (found by
// actually running `expo export`, not by typecheck or lint, neither of
// which model Metro's resolver at all). Stripping a *relative* import's
// trailing `.js` before Metro's own extension search runs lets it find the
// real source file; a bare specifier (`@fp/ui`, `react-native`, ...) is left
// untouched; so is a package's own built `dist/*.js`, which really is `.js`.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    return context.resolveRequest(context, moduleName.slice(0, -'.js'.length), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
