/**
 * Playwright global setup. Runs ONCE before any spec.
 *
 * Responsibilities:
 *   1. Wait briefly for Anvil to be reachable (Playwright's webServer.url
 *      check happens BEFORE we get here, so Anvil is already up).
 *   2. Deploy the demo contracts via forge script and write
 *      apps/contracts/deployments-anvil.json — which demo-a2a then reads
 *      on startup.
 *
 * Deploy is one-shot, idempotent on Anvil's deterministic addresses: as
 * long as Anvil's state is fresh, redeploying produces the same addresses.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../..', import.meta.url).pathname;
const CONTRACTS_DIR = join(REPO_ROOT, 'apps', 'contracts');
const DEPLOYMENTS_FILE = join(CONTRACTS_DIR, 'deployments-anvil.json');

export default async function globalSetup() {
  // ALWAYS redeploy. The webServer config may reuse an existing Anvil
  // instance, but if Anvil was restarted between test runs the addresses
  // in deployments-anvil.json from a previous session are stale — calling
  // them reverts. Cheap to redeploy (<5s on Anvil) and avoids the trap.
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
  console.log('[e2e] contracts deployed');
}
