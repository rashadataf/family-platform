// @ts-check
import fpConfig from '@fp/config-eslint';

export default [
  ...fpConfig,
  {
    files: ['scripts/**/*.ts'],
  },
  {
    // `.claude/worktrees/**` holds throwaway git worktrees — whole copies of
    // this repository, built `dist/` and all. They are excluded from git (via
    // `.git/info/exclude`), which ESLint does not read, so without this a
    // leftover worktree makes `pnpm lint` fail on hundreds of parse errors in
    // files that are not part of this checkout at all.
    ignores: ['apps/**', 'packages/**', '.claude/**'],
  },
];
