/**
 * Root Vitest configuration. Per-package configs extend this.
 * See specs/110-test-strategy.md §4.
 */
export default {
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    // Vitest 4 pool rework: `poolOptions.forks.singleFork` → top-level
    // `fileParallelism: false` (run all test files sequentially in one fork).
    fileParallelism: false,
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      // H7-E.2 / D8 — coverage floor (ratchet-only baseline). Set
      // conservatively at the wave-close state so existing packages
      // pass today and any regression below these numbers fails CI.
      // Per-package vitest configs may RAISE these (cannot lower).
      // Goal: raise each ceiling after the post-audit fix-up wave.
      thresholds: {
        lines: 50,
        statements: 50,
        functions: 50,
        branches: 60,
      },
    },
  },
};
