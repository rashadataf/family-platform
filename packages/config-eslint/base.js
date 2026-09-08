// @ts-check
import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';

/** Core JS hygiene, shared by every package regardless of TypeScript usage. */
export default [
  js.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ['dist/**', '.turbo/**', 'node_modules/**', 'coverage/**'],
  },
];
