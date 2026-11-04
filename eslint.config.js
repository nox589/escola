import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'apps/mobile/**', 'fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // SPEC §13: no console.log in the worker; use the redacting logger.
    files: ['workers/**/*.ts'],
    rules: { 'no-console': 'error' },
  },
);
