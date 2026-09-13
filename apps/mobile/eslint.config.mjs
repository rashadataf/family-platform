// @ts-check
import fpConfig from '@fp/config-eslint';
import designSystem from '@fp/config-eslint/design-system.js';

export default [
  ...fpConfig,
  // T032 found this missing: packages/ui enforces FR-008/FR-009 on itself,
  // but apps/mobile — where a screen actually WRITES a style object using
  // @fp/ui — never had the rule wired in at all. A literal hex or an
  // off-scale spacing value in a screen file passed lint silently until
  // this was added; "prove the enforcement fires" caught its own gap.
  ...designSystem,
  {
    ignores: ['.expo/**', 'dist/**'],
  },
  // metro.config.js is the one CommonJS file in this repository (Metro loads
  // it directly with Node's `require`, and apps/mobile has no
  // "type": "module" for exactly that reason) — every other package here is
  // ESM, so `no-undef` has nothing to know these globals by default.
  {
    files: ['metro.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', __dirname: 'readonly' },
    },
  },
];
