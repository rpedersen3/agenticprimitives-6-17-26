import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// W1 packages don't have a built dist/ during dev. Alias them straight to src
// so the e2e test can compose them without a build step.
const repoRoot = resolve(__dirname, '..', '..');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@agenticprimitives/verifiable-credentials': resolve(
        repoRoot,
        'packages/verifiable-credentials/src/index.ts',
      ),
      '@agenticprimitives/attestations': resolve(repoRoot, 'packages/attestations/src/index.ts'),
      '@agenticprimitives/agreements': resolve(repoRoot, 'packages/agreements/src/index.ts'),
      '@agenticprimitives/intent-marketplace': resolve(
        repoRoot,
        'packages/intent-marketplace/src/index.ts',
      ),
      '@agenticprimitives/intent-resolver': resolve(
        repoRoot,
        'packages/intent-resolver/src/index.ts',
      ),
      '@agenticprimitives/payments': resolve(repoRoot, 'packages/payments/src/index.ts'),
      '@agenticprimitives/fulfillment': resolve(repoRoot, 'packages/fulfillment/src/index.ts'),
    },
  },
});
