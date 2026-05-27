/**
 * fund-paymaster.ts
 *
 * Top up the SmartAgentPaymaster's EntryPoint deposit so gasless deploys /
 * UserOps keep working. When the deposit runs out, deploys fail with
 *   FailedOp(0, "AA31 paymaster deposit too low").
 *
 * `EntryPoint.depositTo(paymaster)` is PERMISSIONLESS — the top-up can come
 * from ANY funded Base Sepolia wallet, not just a project key. This script
 * reads the EntryPoint + paymaster addresses from the deployments JSON (single
 * source of truth), reports the current deposit, and either prints a ready-to-run
 * command (status mode) or sends the top-up when a funder key is provided.
 *
 * Usage:
 *   pnpm fund:paymaster                       # status: deposit + the command to run
 *   pnpm fund:paymaster 0.03                  # status for a 0.03 ETH top-up
 *   PAYMASTER_FUNDER_KEY=0x… pnpm fund:paymaster 0.03   # actually send 0.03 ETH
 *
 * Env:
 *   PAYMASTER_FUNDER_KEY   funded EOA private key — REQUIRED to send (never hardcode).
 *   RPC_URL                Base Sepolia RPC (default https://sepolia.base.org).
 *   DEPLOY_NETWORK         deployments file suffix (default base-sepolia).
 *   LOW_THRESHOLD_ETH      warn below this (default 0.005).
 *
 * Requires `cast` (foundry) on PATH.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const NETWORK = process.env.DEPLOY_NETWORK ?? 'base-sepolia';
const RPC = process.env.RPC_URL ?? 'https://sepolia.base.org';
const LOW_THRESHOLD_ETH = process.env.LOW_THRESHOLD_ETH ?? '0.005';
const DEPLOYMENTS = join(REPO_ROOT, 'apps', 'contracts', `deployments-${NETWORK}.json`);

function fail(msg: string): never {
  console.error(`fund-paymaster: ${msg}`);
  process.exit(1);
}

/** Format wei (bigint) as a trimmed ETH decimal string. */
function toEth(wei: bigint): string {
  const neg = wei < 0n;
  const v = neg ? -wei : wei;
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

const ethToWei = (eth: string): bigint => {
  if (!/^\d+(\.\d+)?$/.test(eth)) fail(`amount "${eth}" is not a positive decimal`);
  const [w, f = ''] = eth.split('.');
  return BigInt(w) * 10n ** 18n + BigInt((f + '0'.repeat(18)).slice(0, 18));
};

let d: Record<string, string>;
try {
  d = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8')) as Record<string, string>;
} catch {
  fail(`could not read ${DEPLOYMENTS}`);
}
const entryPoint = d.entryPoint;
const paymaster = d.smartAgentPaymaster;
if (!entryPoint || !paymaster) fail(`entryPoint / smartAgentPaymaster missing from ${DEPLOYMENTS}`);

// Read the current deposit. `cast call` prints e.g. "271995115000000 [2.719e14]".
let depositWei = 0n;
try {
  const out = execSync(`cast call ${entryPoint} "balanceOf(address)(uint256)" ${paymaster} --rpc-url ${RPC}`, {
    encoding: 'utf8',
  }).trim();
  depositWei = BigInt(out.split(/\s+/)[0]);
} catch (e) {
  fail(`deposit read failed (is cast installed + RPC reachable?): ${e instanceof Error ? e.message : String(e)}`);
}

const low = depositWei < ethToWei(LOW_THRESHOLD_ETH);
console.log(`network:    ${NETWORK}`);
console.log(`entryPoint: ${entryPoint}`);
console.log(`paymaster:  ${paymaster}`);
console.log(`deposit:    ${toEth(depositWei)} ETH  ${low ? `⚠️  below ${LOW_THRESHOLD_ETH} ETH — top up` : '✓'}`);

const amount = process.argv[2];
if (!amount) {
  console.log(`\nTo top up, run with an amount (and a funded key to actually send):`);
  console.log(`  PAYMASTER_FUNDER_KEY=0x… pnpm fund:paymaster 0.03`);
  process.exit(low ? 1 : 0); // non-zero when low, so CI / pre-deploy checks can gate on it
}

const key = process.env.PAYMASTER_FUNDER_KEY;
const sendCmd = `cast send ${entryPoint} "depositTo(address)" ${paymaster} --value ${amount}ether --rpc-url ${RPC} --private-key <PAYMASTER_FUNDER_KEY>`;
if (!key) {
  console.log(`\nPAYMASTER_FUNDER_KEY not set — not sending. Ready-to-run command:`);
  console.log(`  ${sendCmd}`);
  console.log(`(depositTo is permissionless — any funded Base Sepolia wallet works.)`);
  process.exit(0);
}

console.log(`\nDepositing ${amount} ETH to the paymaster…`);
try {
  execSync(`cast send ${entryPoint} "depositTo(address)" ${paymaster} --value ${amount}ether --rpc-url ${RPC} --private-key ${key}`, {
    stdio: 'inherit',
  });
} catch (e) {
  fail(`top-up tx failed: ${e instanceof Error ? e.message : String(e)}`);
}
const after = BigInt(
  execSync(`cast call ${entryPoint} "balanceOf(address)(uint256)" ${paymaster} --rpc-url ${RPC}`, { encoding: 'utf8' })
    .trim()
    .split(/\s+/)[0],
);
console.log(`✓ deposit now ${toEth(after)} ETH`);
