import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@escola/shared': r('./packages/shared/src/index.ts'),
      '@escola/crypto': r('./packages/crypto/src/index.ts'),
      '@escola/db': r('./packages/db/src/index.ts'),
      '@escola/storage': r('./packages/storage/src/index.ts'),
      '@escola/llm': r('./packages/llm/src/index.ts'),
    },
  },
  test: {
    include: ['**/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 20000,
  },
});
