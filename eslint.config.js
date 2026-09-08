// @ts-check
import fpConfig from '@fp/config-eslint';

export default [
  ...fpConfig,
  {
    files: ['scripts/**/*.ts'],
  },
  {
    ignores: ['apps/**', 'packages/**'],
  },
];
