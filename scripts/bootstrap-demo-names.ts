/**
 * bootstrap-demo-names.ts
 *
 * One-shot helper that uses the deployer EOA (root owner of `.agent`)
 * to register a small set of demo names + resolver records on chain.
 * Run AFTER `pnpm deploy:base-sepolia` so the demo apps have
 * live names to read via the read-side Phase 2 client wiring.
 *
 * Registers:
 *   acme.agent           — Organization Smart Agent placeholder
 *   treasury.acme.agent  — Treasury Service Agent placeholder
 *   demo.agent           — Catchall (deployer's primary-name target)
 *
 * For each name, sets:
 *   atl:addr        → deployer (placeholder until per-user agents register)
 *   atl:agentKind   → keccak256("org" | "treasury" | "service")
 *   atl:displayName → human label
 *
 * Then sets deployer's primary name = demo.agent so reverseResolve(deployer)
 * round-trips.
 *
 * Self-contained — does NOT import @agenticprimitives/agent-naming so it
 * can run from the repo root without going through a workspace-package
 * build cycle. Predicate IDs + ABIs are derived inline to keep the
 * script standalone.
 *
 * Usage:
 *   set -a; source .env.deploy.local; set +a
 *   tsx scripts/bootstrap-demo-names.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  encodePacked,
  http,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const NETWORK = process.env.DEPLOY_NETWORK ?? 'base-sepolia';

// ─── Predicate ids (mirror packages/agent-naming/src/records.ts) ───
const PREDICATE_ID = {
  addr:        keccak256(toHex('atl:addr')),
  agentKind:   keccak256(toHex('atl:agentKind')),
  displayName: keccak256(toHex('atl:displayName')),
} as const;

const AGENT_KIND_ID = {
  person:   keccak256(toHex('person')),
  org:      keccak256(toHex('org')),
  service:  keccak256(toHex('service')),
  treasury: keccak256(toHex('treasury')),
} as const;

const ZERO_NODE = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

// ─── Minimal ABIs (only the entry points we call) ───────────────────
const REGISTRY_ABI = [
  { type: 'function', name: 'AGENT_ROOT', stateMutability: 'pure', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'childNode', stateMutability: 'view',
    inputs: [{ name: 'parentNode', type: 'bytes32' }, { name: 'lh', type: 'bytes32' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'recordExists', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [
      { name: 'parentNode', type: 'bytes32' },
      { name: 'label', type: 'string' },
      { name: 'newOwner', type: 'address' },
      { name: 'resolverContract', type: 'address' },
      { name: 'expiry', type: 'uint64' },
    ],
    outputs: [{ name: 'childNode', type: 'bytes32' }] },
  { type: 'function', name: 'setPrimaryName', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }], outputs: [] },
] as const satisfies Abi;

const RESOLVER_ABI = [
  { type: 'function', name: 'setAddressAttribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'address' }], outputs: [] },
  { type: 'function', name: 'setStringAttribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'string' }], outputs: [] },
  { type: 'function', name: 'setBytes32Attribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'bytes32' }], outputs: [] },
] as const satisfies Abi;

const UNIVERSAL_ABI = [
  { type: 'function', name: 'reverseResolve', stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }], outputs: [{ type: 'bytes32' }] },
] as const satisfies Abi;

// ─── namehash (mirror packages/agent-naming/src/namehash.ts) ───────
function namehash(name: string): Hex {
  if (name === '') return ZERO_NODE;
  const labels = name.split('.');
  let node: Hex = ZERO_NODE;
  for (let i = labels.length - 1; i >= 0; i--) {
    const lh = keccak256(toHex(labels[i]!));
    node = keccak256(encodePacked(['bytes32', 'bytes32'], [node, lh]));
  }
  return node;
}

interface Deployments {
  chainId: number;
  agentNameRegistry?: Address;
  agentNameResolver?: Address;
  agentNameUniversalResolver?: Address;
}

type PublicClientT = ReturnType<typeof createPublicClient>;
type WalletClientT = ReturnType<typeof createWalletClient>;

async function main() {
  const path = join(REPO_ROOT, 'apps', 'contracts', `deployments-${NETWORK}.json`);
  const d = JSON.parse(readFileSync(path, 'utf8')) as Deployments;
  if (!d.agentNameRegistry || !d.agentNameResolver || !d.agentNameUniversalResolver) {
    console.error('bootstrap-demo-names: naming contracts missing from deployments. Redeploy first.');
    process.exit(1);
  }

  const pkRaw = process.env.PRIVATE_KEY;
  const rpc = process.env.BASE_SEPOLIA_RPC;
  if (!pkRaw || !rpc) {
    console.error('bootstrap-demo-names: PRIVATE_KEY + BASE_SEPOLIA_RPC env vars required.');
    console.error('Run: set -a; source .env.deploy.local; set +a');
    process.exit(1);
  }
  const pk = (pkRaw.startsWith('0x') ? pkRaw : '0x' + pkRaw) as `0x${string}`;
  const account = privateKeyToAccount(pk);
  console.log(`bootstrap-demo-names: deployer = ${account.address}`);
  console.log(`bootstrap-demo-names: network = ${NETWORK} (chainId=${d.chainId})`);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });
  const registry = d.agentNameRegistry;
  const resolverAddr = d.agentNameResolver;
  const universal = d.agentNameUniversalResolver;

  const agentRoot = await publicClient.readContract({
    address: registry, abi: REGISTRY_ABI, functionName: 'AGENT_ROOT',
  });
  const rootOwner = await publicClient.readContract({
    address: registry, abi: REGISTRY_ABI, functionName: 'owner', args: [agentRoot],
  });
  console.log(`bootstrap-demo-names: .agent root = ${agentRoot}`);
  console.log(`bootstrap-demo-names: .agent root owner = ${rootOwner}`);
  if (rootOwner.toLowerCase() !== account.address.toLowerCase()) {
    console.error('bootstrap-demo-names: deployer is NOT root owner; cannot register subnames.');
    process.exit(1);
  }

  await registerOrSkip(publicClient, wallet, registry, resolverAddr, agentRoot, 'acme', account.address, 'Acme Construction', 'org');
  const acmeNode = namehash('acme.agent');
  await registerOrSkip(publicClient, wallet, registry, resolverAddr, acmeNode, 'treasury', account.address, 'Acme Treasury', 'treasury');
  await registerOrSkip(publicClient, wallet, registry, resolverAddr, agentRoot, 'demo', account.address, 'Demo Deployer', 'service');

  const demoNode = namehash('demo.agent');
  console.log(`bootstrap-demo-names: setting primary name for deployer → demo.agent (${demoNode})`);
  await sendAndConfirm(publicClient, wallet, {
    address: registry, abi: REGISTRY_ABI, functionName: 'setPrimaryName', args: [demoNode],
  });

  const resolved = await publicClient.readContract({
    address: universal, abi: UNIVERSAL_ABI, functionName: 'reverseResolve', args: [account.address],
  });
  console.log(`bootstrap-demo-names: reverseResolve(deployer) → ${resolved}`);
  console.log(
    resolved.toLowerCase() === demoNode.toLowerCase()
      ? 'bootstrap-demo-names: ✓ round-trip OK'
      : 'bootstrap-demo-names: ✗ round-trip MISMATCH',
  );
}

async function registerOrSkip(
  publicClient: PublicClientT,
  wallet: WalletClientT,
  registry: Address,
  resolverAddr: Address,
  parentNode: Hex,
  label: string,
  owner: Address,
  displayName: string,
  kind: keyof typeof AGENT_KIND_ID,
): Promise<void> {
  const labelhash = keccak256(toHex(label));
  const childNode = await publicClient.readContract({
    address: registry, abi: REGISTRY_ABI, functionName: 'childNode', args: [parentNode, labelhash],
  });
  if (childNode !== ZERO_NODE) {
    const exists = await publicClient.readContract({
      address: registry, abi: REGISTRY_ABI, functionName: 'recordExists', args: [childNode],
    });
    if (exists) {
      console.log(`  ${label}: already registered (node=${childNode}); refreshing records`);
      await writeRecords(publicClient, wallet, resolverAddr, childNode, owner, displayName, kind);
      return;
    }
  }
  console.log(`  registering ${label} under parent ${parentNode}`);
  await sendAndConfirm(publicClient, wallet, {
    address: registry, abi: REGISTRY_ABI, functionName: 'register',
    args: [parentNode, label, owner, resolverAddr, 0n],
  });
  // Compute the new child node off-chain rather than re-reading
  // childNode() — Base Sepolia RPC sometimes has read-after-write lag
  // that returns stale ZERO_NODE for a beat after the tx confirms.
  const node = keccak256(encodePacked(['bytes32', 'bytes32'], [parentNode, labelhash]));
  console.log(`    → ${node}`);
  // Poll recordExists until the registry observation propagates to the
  // resolver's view (cap at 10 attempts × 2 s = 20 s).
  await waitForRecord(publicClient, registry, node);
  await writeRecords(publicClient, wallet, resolverAddr, node, owner, displayName, kind);
}

async function waitForRecord(publicClient: PublicClientT, registry: Address, node: Hex): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const exists = await publicClient.readContract({
      address: registry, abi: REGISTRY_ABI, functionName: 'recordExists', args: [node],
    });
    if (exists) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`waitForRecord: registry did not observe node ${node} within 20 s`);
}

async function writeRecords(
  publicClient: PublicClientT,
  wallet: WalletClientT,
  resolverAddr: Address,
  node: Hex,
  owner: Address,
  displayName: string,
  kind: keyof typeof AGENT_KIND_ID,
): Promise<void> {
  await sendAndConfirm(publicClient, wallet, {
    address: resolverAddr, abi: RESOLVER_ABI, functionName: 'setAddressAttribute',
    args: [node, PREDICATE_ID.addr, owner],
  });
  await sendAndConfirm(publicClient, wallet, {
    address: resolverAddr, abi: RESOLVER_ABI, functionName: 'setStringAttribute',
    args: [node, PREDICATE_ID.displayName, displayName],
  });
  await sendAndConfirm(publicClient, wallet, {
    address: resolverAddr, abi: RESOLVER_ABI, functionName: 'setBytes32Attribute',
    args: [node, PREDICATE_ID.agentKind, AGENT_KIND_ID[kind]],
  });
  console.log(`    records: addr=${owner}, displayName="${displayName}", kind=${kind}`);
}

/**
 * Send a writeContract tx with explicit nonce + retry on "replacement
 * underpriced". Base Sepolia's public RPC sometimes lags in surfacing
 * the latest nonce after a confirmed tx; an explicit pendingTxCount
 * fetch each time avoids the race.
 */
async function sendAndConfirm(
  publicClient: PublicClientT,
  wallet: WalletClientT,
  args: Parameters<WalletClientT['writeContract']>[0],
): Promise<void> {
  const account = (wallet as { account?: { address: Address } }).account;
  if (!account) throw new Error('wallet has no account');
  for (let attempt = 0; attempt < 3; attempt++) {
    const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' });
    try {
      const tx = await wallet.writeContract({ ...args, nonce } as Parameters<WalletClientT['writeContract']>[0]);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      return;
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('replacement') || msg.includes('underpriced')) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('sendAndConfirm: exceeded retries');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
