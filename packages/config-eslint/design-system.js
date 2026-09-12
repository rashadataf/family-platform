// @ts-check
import noLiteralDesignValues from './rules/no-literal-design-values.js';

/**
 * Opt-in configuration for packages that render interface (spec 007).
 *
 * Not part of the default export: the rule reads a style object's shape, and
 * applying it to the API or the worker would produce noise rather than signal.
 * `packages/ui` and `apps/mobile` opt in; nothing else needs to.
 *
 * The token layer itself is exempt — it is where the literals are supposed to
 * be — and so are tests, which legitimately construct off-scale values to prove
 * the rule and the guards reject them.
 */
export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/tokens/**', '**/*.spec.ts', '**/*.spec.tsx'],
    plugins: {
      'fp-design': { rules: { 'no-literal-design-values': noLiteralDesignValues } },
    },
    rules: {
      'fp-design/no-literal-design-values': 'error',
    },
  },
];
