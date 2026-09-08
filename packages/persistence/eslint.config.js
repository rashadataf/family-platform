// @ts-check
import fpConfig from '@fp/config-eslint';

export default [
  ...fpConfig,
  {
    ignores: ['dist/**', 'src/generated/**'],
  },
];
