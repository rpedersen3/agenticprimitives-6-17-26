/**
 * Root Vitest configuration. Per-package configs extend this.
 * See specs/110-test-strategy.md §4.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
});
