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

module.exports = config;
