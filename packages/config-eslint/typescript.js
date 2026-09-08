// @ts-check
import tseslint from 'typescript-eslint';
import base from './base.js';

/**
 * Typed linting for every TypeScript package. `projectService: true` lets
 * typescript-eslint discover each consumer's tsconfig automatically, so no
 * package has to wire its own `parserOptions.project` path.
 */
export default tseslint.config(...base, {
  files: ['**/*.ts', '**/*.tsx'],
  extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: process.cwd(),
    },
  },
  rules: {
    // Constitution Principle I: `any` must never silently disable the
    // compile-time half of this codebase's type-safety contract.
    '@typescript-eslint/no-explicit-any': 'error',
    // NestJS modules are conventionally decorator-only classes with no
    // instance members; their behavior comes from metadata, not statics.
    '@typescript-eslint/no-extraneous-class': 'off',
  },
});
