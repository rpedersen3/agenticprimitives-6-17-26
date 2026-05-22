import { defineConfig, devices } from '@playwright/test';

const REPO_ROOT = new URL('../..', import.meta.url).pathname;

export default defineConfig({
  testDir: './pro-specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5273',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm --filter @agenticprimitives-demo/web-pro dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5273',
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      VITE_CHAIN_ID: '84532',
    },
    cwd: REPO_ROOT,
  },
});
