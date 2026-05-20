/**
 * merge-paymaster-deployment.ts
 *
 * The incremental paymaster deploy script writes a sidecar JSON at
 *   apps/contracts/deployments-paymaster-<network>.json
 * with the paymaster address + stake + deposit. This helper reads it
 * and merges the address into the main deployments-<network>.json so
 * downstream code (gen-dev-vars.ts, deploy-cloudflare.ts) sees a
 * single source of truth.
 *
 * Usage:
 *   pnpm tsx scripts/merge-paymaster-deployment.ts                   # network=anvil
 *   DEPLOY_NETWORK=base-sepolia pnpm tsx scripts/merge-paymaster-deployment.ts
 *
 * Idempotent: re-running with the same sidecar overwrites the field
 * with the same address. If you re-deploy the paymaster to a new
 * address, that new address replaces the old one in the main file.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const NETWORK = process.env.DEPLOY_NETWORK ?? 'anvil';
const CONTRACTS_DIR = join(REPO_ROOT, 'apps', 'contracts');
const SIDECAR = join(CONTRACTS_DIR, `deployments-paymaster-${NETWORK}.json`);
const MAIN = join(CONTRACTS_DIR, `deployments-${NETWORK}.json`);

if (!existsSync(SIDECAR)) {
  console.error(`merge-paymaster-deployment: ${SIDECAR} not found.`);
  console.error('  Run `pnpm --filter @agenticprimitives-demo/contracts deploy:paymaster:<network>` first.');
  process.exit(1);
}
if (!existsSync(MAIN)) {
  console.error(`merge-paymaster-deployment: ${MAIN} not found.`);
  console.error('  Run the full deploy first (deploy:anvil or deploy:base-sepolia).');
  process.exit(1);
}

interface Sidecar {
  smartAgentPaymaster: string;
  stake: string;
  deposit: string;
}

const sidecar = JSON.parse(readFileSync(SIDECAR, 'utf8')) as Sidecar;
const main = JSON.parse(readFileSync(MAIN, 'utf8')) as Record<string, unknown>;

main.smartAgentPaymaster = sidecar.smartAgentPaymaster;
writeFileSync(MAIN, JSON.stringify(main) + '\n', 'utf8');

// Clean up the sidecar — main file is now authoritative.
unlinkSync(SIDECAR);

console.log(`merge-paymaster-deployment: merged into ${MAIN}`);
console.log(`  smartAgentPaymaster: ${sidecar.smartAgentPaymaster}`);
console.log(`  stake: ${sidecar.stake} wei`);
console.log(`  deposit: ${sidecar.deposit} wei`);
