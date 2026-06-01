/**
 * verify-governance-shape.ts
 *
 * R10 P1.2 / R11.4 — post-deploy live-chain governance-shape verifier.
 *
 * The deploy script (`packages/contracts/script/Deploy.s.sol`) enforces
 * `_resolveAuthority(governance)` constraints AT DEPLOY TIME — for
 * mainnet/Base-mainnet networks, the `GOVERNANCE_MULTISIG` env var
 * must point at a deployed contract; an EOA fails the require.
 *
 * This script verifies the LIVE-CHAIN state still matches those
 * constraints. Run it:
 *   - After every deploy (manual or scripted)
 *   - Nightly against the live deployments-<network>.json
 *   - As a pre-publish gate in the release workflow
 *
 * What it checks (per contract that has a `governance()` getter):
 *   - `<contract>.governance()` resolves
 *   - The resolved address has nonzero code (contract, not EOA)
 *   - On production-network deploys, the address matches the env-var
 *     `GOVERNANCE_MULTISIG` if set
 *
 * Usage:
 *   pnpm verify:governance-shape                          # base-sepolia (default)
 *   DEPLOY_NETWORK=base-mainnet pnpm verify:governance-shape
 *
 * Required env (auto-loaded from `.env.deploy.local` if present):
 *   BASE_SEPOLIA_RPC      — RPC URL for the target network
 *   GOVERNANCE_MULTISIG   — optional; if set, on-chain governance() must equal this
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, http, type Address } from 'viem';

// Best-effort .env.deploy.local loader (no extra dependency).
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (!process.env[k!]) process.env[k!] = v!.replace(/^['"]|['"]$/g, '');
  }
}

const REPO = join(import.meta.dirname ?? __dirname, '..');
loadEnvFile(join(REPO, '.env.deploy.local'));

const NETWORK = process.env.DEPLOY_NETWORK ?? 'base-sepolia';
const RPC_URL =
  NETWORK === 'base-sepolia'
    ? process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org'
    : process.env[`${NETWORK.toUpperCase().replace(/-/g, '_')}_RPC`];

if (!RPC_URL) {
  console.error(`[verify:governance-shape] no RPC for network "${NETWORK}". Set BASE_SEPOLIA_RPC or the network-specific env var.`);
  process.exit(2);
}

const DEPLOYMENTS_PATH = join(REPO, 'packages/contracts', `deployments-${NETWORK}.json`);
if (!existsSync(DEPLOYMENTS_PATH)) {
  console.error(`[verify:governance-shape] no deployments file at ${DEPLOYMENTS_PATH}`);
  process.exit(2);
}

interface Deployments {
  [name: string]: string | number;
  chainId: number;
}
const deployments = JSON.parse(readFileSync(DEPLOYMENTS_PATH, 'utf8')) as Deployments;

const client = createPublicClient({ transport: http(RPC_URL) });

// Contracts that expose a `governance()` getter. Each entry: (contract-key
// in deployments JSON, label for error messages).
const GOVERNANCE_HOLDERS: Array<{ key: keyof Deployments | string; label: string }> = [
  { key: 'agentAccountFactory', label: 'AgentAccountFactory' },
  { key: 'smartAgentPaymaster', label: 'SmartAgentPaymaster' },
  { key: 'agentNameRegistry', label: 'AgentNameRegistry' },
  { key: 'delegationManager', label: 'DelegationManager' },
];

const GOVERNANCE_ABI = [
  {
    type: 'function',
    name: 'governance',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

interface Finding {
  contract: string;
  address: Address;
  problem: string;
}
const findings: Finding[] = [];

const EXPECTED = process.env.GOVERNANCE_MULTISIG as Address | undefined;

async function verifyOne(label: string, addr: Address): Promise<void> {
  if (addr === '0x0000000000000000000000000000000000000000') {
    findings.push({ contract: label, address: addr, problem: 'address is zero' });
    return;
  }
  // 1. Contract has code at the address (not an EOA).
  const code = await client.getBytecode({ address: addr });
  if (!code || code === '0x') {
    findings.push({ contract: label, address: addr, problem: 'no code at address (EOA?)' });
    return;
  }
  // 2. governance() resolves.
  let governance: Address;
  try {
    governance = (await client.readContract({
      address: addr,
      abi: GOVERNANCE_ABI,
      functionName: 'governance',
    })) as Address;
  } catch (e) {
    findings.push({ contract: label, address: addr, problem: `governance() reverted: ${String(e).slice(0, 120)}` });
    return;
  }
  // 3. governance() returns a contract (not an EOA).
  if (governance === '0x0000000000000000000000000000000000000000') {
    findings.push({ contract: label, address: addr, problem: `governance() returned zero` });
    return;
  }
  const govCode = await client.getBytecode({ address: governance });
  if (!govCode || govCode === '0x') {
    findings.push({
      contract: label,
      address: addr,
      problem: `governance() == ${governance} but THAT is an EOA (no code). Production governance MUST be a Safe / Timelock / multisig contract.`,
    });
    return;
  }
  // 4. If GOVERNANCE_MULTISIG is set, on-chain matches.
  if (EXPECTED && governance.toLowerCase() !== EXPECTED.toLowerCase()) {
    findings.push({
      contract: label,
      address: addr,
      problem: `governance() == ${governance} but expected ${EXPECTED} (per GOVERNANCE_MULTISIG env var)`,
    });
    return;
  }
  console.log(`  ✓ ${label.padEnd(28)} ${addr}  →  governance=${governance}${EXPECTED ? '  (matches expected)' : ''}`);
}

async function main(): Promise<void> {
  console.log(`[verify:governance-shape] network=${NETWORK} rpc=${RPC_URL!.replace(/\?.*$/, '')}`);
  if (EXPECTED) {
    console.log(`[verify:governance-shape] expected governance multisig: ${EXPECTED}`);
  } else {
    console.log(`[verify:governance-shape] no GOVERNANCE_MULTISIG env var set — verifying contract-shape only`);
  }

  for (const { key, label } of GOVERNANCE_HOLDERS) {
    const addr = deployments[key] as Address | undefined;
    if (!addr) {
      console.log(`  ~ ${label}: not in deployments JSON (skipped)`);
      continue;
    }
    await verifyOne(label, addr);
  }

  if (findings.length === 0) {
    console.log(`\n[verify:governance-shape] ✓ all checked contracts have a valid governance shape.`);
    process.exit(0);
  }

  console.error(`\n[verify:governance-shape] ✗ ${findings.length} finding(s):`);
  for (const f of findings) {
    console.error(`  - ${f.contract} (${f.address}): ${f.problem}`);
  }
  console.error(
    `\nTriage:\n` +
      `  - If this is the testnet deploy, an EOA governance is the documented\n` +
      `    accepted-risk (deployer = ${deployments.deployer}). Production deploys\n` +
      `    MUST point governance at a Safe / Timelock contract before publish.\n` +
      `  - Runbook: packages/contracts/AUDIT.md § 4.1.\n` +
      `  - Set GOVERNANCE_MULTISIG=0x... to assert a specific expected address.`,
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(`[verify:governance-shape] unexpected error:`, e);
  process.exit(2);
});
