/**
 * Playwright config for recording a video of the LIVE deployed demo.
 * No local services — points directly at https://agenticprimitives-demo.pages.dev.
 *
 * Run via:
 *   cd tests/e2e && pnpm exec playwright test --config playwright.live.config.ts
 *
 * Output:
 *   tests/e2e/recordings/   ← .webm video per spec + a summary report
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './live-specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 120_000, // each test can take a while (paymaster broadcast + block confirm)

  use: {
    baseURL: 'https://agenticprimitives-demo.pages.dev',
    // Record video for every step + keep it always. Default frame size 1280x720.
    video: 'on',
    trace: 'on',
    // Capture the full SPA load.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },

  outputDir: './recordings',

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
