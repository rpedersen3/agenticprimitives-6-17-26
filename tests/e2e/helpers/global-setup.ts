/**
 * Playwright global setup. Runs ONCE before any spec.
 *
 * Responsibilities:
 *   1. Deploy demo contracts to Anvil (one-shot per test session).
 *   2. Generate .dev.vars files for demo-a2a + demo-mcp from
 *      deployments-anvil.json so wrangler dev picks up the right
 *      contract addresses + secrets.
 *   3. Apply D1 migrations locally so demo-mcp's Worker can read/write
 *      profiles + token_usage.
 *
 * Order matters: deploy → dev-vars → d1 migrate → webServer starts wrangler dev.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../..', import.meta.url).pathname;
const CONTRACTS_DIR = join(REPO_ROOT, 'apps', 'contracts');
const DEMO_MCP_DIR = join(REPO_ROOT, 'apps', 'demo-mcp');
const DEPLOYMENTS_FILE = join(CONTRACTS_DIR, 'deployments-anvil.json');

export default async function globalSetup() {
  // 1. Deploy contracts.
  console.log('[e2e] deploying contracts to anvil…');
  execSync(
    [
      'forge script script/Deploy.s.sol',
      '--rpc-url http://127.0.0.1:8545',
      '--broadcast',
      '--private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    ].join(' '),
    {
      cwd: CONTRACTS_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        DEPLOYER_ADDRESS: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        DEPLOY_NETWORK: 'anvil',
      },
    },
  );

  if (!existsSync(DEPLOYMENTS_FILE)) {
    throw new Error('[e2e] deploy completed but deployments-anvil.json missing');
  }

  // 2. Generate .dev.vars files for the Workers.
  console.log('[e2e] generating .dev.vars for demo Workers…');
  execSync('pnpm tsx scripts/gen-dev-vars.ts', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, DEPLOY_NETWORK: 'anvil' },
  });

  // 3. Apply D1 migrations to the local SQLite that wrangler dev will use.
  //    In non-TTY mode wrangler skips the confirmation prompt automatically.
  console.log('[e2e] applying D1 migrations to local demo-mcp database…');
  execSync('pnpm d1:migrate:local', {
    cwd: DEMO_MCP_DIR,
    stdio: 'inherit',
    env: { ...process.env, CI: '1' }, // hint non-interactive
  });

  console.log('[e2e] setup complete');
}
