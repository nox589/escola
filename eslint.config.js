import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'apps/mobile/**', 'fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { URL: 'readonly', process: 'readonly' } },
  },
  {
    // SPEC §13: no console.log in the worker; use the redacting logger.
    files: ['workers/**/*.ts'],
    rules: { 'no-console': 'error' },
  },
);
