/**
 * Playwright config for agenticprimitives demo E2E tests.
 *
 * Each spec file under specs/ is an isolated feature test, runnable on its own:
 *   pnpm test -- 01-demo-user
 *   pnpm test:ui -- 02-siwe-login
 *
 * webServer chains the demo stack: anvil → contract deploy → demo-a2a → demo-mcp → demo-web.
 * Specs that only need the browser side (no chain, no a2a) opt out by setting
 * `test.use({ networkOnly: false })` — see helpers/boot-stack.ts.
 */
import { defineConfig, devices } from '@playwright/test';

const REPO_ROOT = new URL('../..', import.meta.url).pathname;

// Dev-only secrets — never use these in production. They make the e2e stack
// reproducible without exposing real key material in CI logs.
const E2E_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '8787',
  RPC_URL: 'http://127.0.0.1:8545',
  CHAIN_ID: '31337',
  ALLOWED_ORIGINS: 'http://127.0.0.1:5173,http://localhost:5173',
  SESSION_JWT_SECRETS: 'e2e-kid:' + 'aa'.repeat(32),
  CSRF_SECRET: '0x' + 'bb'.repeat(32),
  A2A_SESSION_SECRET: '0x' + 'cc'.repeat(32),
  A2A_MASTER_PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  A2A_KMS_BACKEND: 'local-aes',
  DEPLOYMENTS_DIR: `${REPO_ROOT}apps/contracts`,
};

const VITE_ENV: Record<string, string> = {
  VITE_CHAIN_ID: '31337',
};

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    // Anvil. --silent suppresses block logs; --host binds to all interfaces
    // so the spawned process can be reached from other webServer entries.
    {
      command: 'anvil --port 8545 --silent',
      url: 'http://127.0.0.1:8545',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    // demo-a2a — env injected here so identity-auth + key-custody find what
    // they need without touching the developer's shell env.
    //
    // reuseExistingServer: false even locally. A previous test run's a2a
    // server may be running from before a code change; reusing it serves
    // stale routes (e.g., /deployments missing after we added it). Cost
    // is ~3s per test run; correctness wins.
    {
      command: 'pnpm --filter @agenticprimitives-demo/a2a dev',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: E2E_ENV,
      cwd: REPO_ROOT,
    },
    // demo-mcp — needed for steps 3+; harmless to boot now.
    {
      command: 'pnpm --filter @agenticprimitives-demo/mcp dev',
      url: 'http://127.0.0.1:8788/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: '8788',
        MCP_DB_PATH: `${REPO_ROOT}apps/demo-mcp/demo-mcp.e2e.db`,
      },
      cwd: REPO_ROOT,
    },
    // demo-web (Vite) — Vite supports HMR so reuse is safer here.
    {
      command: 'pnpm --filter @agenticprimitives-demo/web dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: VITE_ENV,
      cwd: REPO_ROOT,
    },
  ],

  globalSetup: './helpers/global-setup.ts',
});
