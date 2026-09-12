// @ts-check
import fpConfig from '@fp/config-eslint';
import designSystem from '@fp/config-eslint/design-system.js';

export default [
  ...fpConfig,
  // Spec 007 FR-008 and FR-009: no literal design value outside src/tokens.
  ...designSystem,
  {
    ignores: ['dist/**'],
  },
];
