// @ts-check
import fpConfig from '@fp/config-eslint';

export default [
  ...fpConfig,
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
