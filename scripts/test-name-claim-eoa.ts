/**
 * test-name-claim-eoa.ts
 *
 * Headless end-to-end test of the agent-name claim flow that mirrors
 * the browser's path EXCEPT it signs userOps with a generated EOA
 * instead of a WebAuthn passkey. Hits the live demo-a2a Worker for:
 *
 *   1. /auth/csrf                      (cookie + token bootstrap)
 *   2. /session/direct-deploy          (factory deploys SA, demo-a2a pays gas)
 *   3. /account/build-call-userop      (builds userOp for SA)
 *   4. EOA signs the userOpHash locally (raw ECDSA over the hash)
 *   5. /account/submit-call-userop     (paymaster-sponsored bundler submission)
 *
 * Asserts after the tx mines:
 *   universal.resolveName(<label>.demo.agent) === SA
 *   universal.reverseResolve(SA)              === node(<label>.demo.agent)
 *
 * If both pass → the browser bug is passkey-specific.
 * If reverse fails → the bug is in the contract / paymaster / bundler
 * layer, NOT the browser.
 *
 * Usage:
 *   set -a; source .env.deploy.local; set +a
 *   pnpm tsx scripts/test-name-claim-eoa.ts
 *
 * Env vars:
 *   BASE_SEPOLIA_RPC      RPC URL for read-side asserts (chain reads).
 *   DEMO_A2A_URL          Optional. Defaults to the prod Cloudflare URL.
 *   DEMO_ORIGIN           Optional. Origin header passed to /auth/csrf
 *                         and used for CORS allowlist. Defaults to the
 *                         demo-web-pro Pages URL.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPublicClient,
  encodeFunctionData,
  encodePacked,
  http,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const NETWORK = process.env.DEPLOY_NETWORK ?? 'base-sepolia';
const DEMO_A2A_URL =
  process.env.DEMO_A2A_URL ?? 'https://demo-a2a-production.richardpedersen3.workers.dev';
const DEMO_ORIGIN =
  process.env.DEMO_ORIGIN ?? 'https://agenticprimitives-demo-pro.pages.dev';

const ZERO_NODE = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

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

// ─── ABI fragments (reads only — demo-a2a does the writes) ────────

const REGISTRY_ABI = [
  {
    type: 'function', name: 'childNode', stateMutability: 'view',
    inputs: [{ name: 'p', type: 'bytes32' }, { name: 'lh', type: 'bytes32' }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function', name: 'recordExists', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'bool' }],
  },
  {
    type: 'function', name: 'primaryName', stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }], outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function', name: 'owner', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'address' }],
  },
  {
    type: 'function', name: 'setPrimaryName', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }], outputs: [],
  },
] as const satisfies Abi;

const SUBREGISTRY_ABI = [
  {
    type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'newOwner', type: 'address' },
    ],
    outputs: [{ name: 'childNode', type: 'bytes32' }],
  },
] as const satisfies Abi;

const UNIVERSAL_ABI = [
  {
    type: 'function', name: 'resolveName', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'address' }],
  },
  {
    type: 'function', name: 'reverseResolve', stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }], outputs: [{ type: 'bytes32' }],
  },
] as const satisfies Abi;

const AGENT_ACCOUNT_EXECUTE_BATCH_ABI = [
  {
    type: 'function', name: 'executeBatch', stateMutability: 'nonpayable',
    inputs: [{ name: 'calls', type: 'tuple[]', components: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ]}],
    outputs: [],
  },
] as const satisfies Abi;

interface Deployments {
  chainId: number;
  agentNameRegistry: Address;
  agentNameUniversalResolver: Address;
  permissionlessSubregistry: Address;
}

const DEMO_PARENT = namehash('demo.agent');

// ─── HTTP helpers ─────────────────────────────────────────────────

interface Session {
  csrfToken: string;
  cookieHeader: string;
}

async function bootstrapSession(): Promise<Session> {
  const res = await fetch(`${DEMO_A2A_URL}/auth/csrf`, {
    method: 'GET',
    headers: { Origin: DEMO_ORIGIN },
  });
  if (!res.ok) {
    throw new Error(`/auth/csrf failed: ${res.status} ${await res.text()}`);
  }
  // Token is in the response body AND set as a cookie.
  const body = (await res.json()) as { token?: string; csrf?: string };
  const csrfToken = body.token ?? body.csrf ?? '';
  const setCookie = res.headers.get('set-cookie') ?? '';
  // Cloudflare may collapse multiple Set-Cookie headers; the cookie we
  // need is "agentic-csrf". Extract just name=value.
  const match = /agentic-csrf=([^;]+)/.exec(setCookie);
  if (!match) throw new Error(`/auth/csrf missing agentic-csrf cookie: ${setCookie}`);
  if (!csrfToken) throw new Error(`/auth/csrf no token in body: ${JSON.stringify(body)}`);
  return { csrfToken, cookieHeader: `agentic-csrf=${match[1]}` };
}

async function postJson(
  path: string,
  body: unknown,
  session: Session,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${DEMO_A2A_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: DEMO_ORIGIN,
      'X-CSRF-Token': session.csrfToken,
      Cookie: session.cookieHeader,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function findFreeLabel(
  publicClient: ReturnType<typeof createPublicClient>,
  registry: Address,
  base: string,
): Promise<string> {
  for (let i = 1; i < 9999; i++) {
    const candidate = i === 1 ? base : `${base}${i}`;
    const lh = keccak256(toHex(candidate));
    const child = (await publicClient.readContract({
      address: registry, abi: REGISTRY_ABI, functionName: 'childNode',
      args: [DEMO_PARENT, lh],
    })) as Hex;
    if (child === ZERO_NODE) return candidate;
    const exists = (await publicClient.readContract({
      address: registry, abi: REGISTRY_ABI, functionName: 'recordExists',
      args: [child],
    })) as boolean;
    if (!exists) return candidate;
  }
  throw new Error(`no free label after 9999 attempts starting from ${base}`);
}

async function main() {
  const path = join(REPO_ROOT, 'apps', 'contracts', `deployments-${NETWORK}.json`);
  const d = JSON.parse(readFileSync(path, 'utf8')) as Deployments;
  const rpc = process.env.BASE_SEPOLIA_RPC;
  if (!rpc) {
    console.error('test-name-claim-eoa: BASE_SEPOLIA_RPC required');
    process.exit(1);
  }

  const custodianPk = generatePrivateKey();
  const custodian = privateKeyToAccount(custodianPk);

  console.log('━━━ test-name-claim-eoa (HTTP) ━━━');
  console.log(`demo-a2a URL       ${DEMO_A2A_URL}`);
  console.log(`origin             ${DEMO_ORIGIN}`);
  console.log(`network            ${NETWORK} (chainId=${d.chainId})`);
  console.log(`custodian EOA      ${custodian.address}`);
  console.log();

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });

  // 1. CSRF bootstrap.
  console.log('1/5 bootstrapping CSRF session…');
  const session = await bootstrapSession();
  console.log(`    token: ${session.csrfToken.slice(0, 12)}…  cookie: agentic-csrf=…`);

  // 2. Direct deploy the SA (mode=0, custodian = our EOA, no passkey).
  console.log('2/5 POST /session/direct-deploy…');
  const deployRes = await postJson('/session/direct-deploy', {
    mode: 0,
    custodians: [custodian.address],
    trustees: [],
    initialPasskeyCredentialIdDigest: ZERO_NODE,
    initialPasskeyX: '0',
    initialPasskeyY: '0',
    timelockOverrides: [0, 0, 0, 0, 0, 0, 0],
    salt: String(Date.now()),
  }, session);
  if (deployRes.status !== 200 || deployRes.json.ok !== true) {
    console.error(`direct-deploy failed: ${deployRes.status}`, deployRes.json);
    process.exit(1);
  }
  const sa = deployRes.json.deployedAddress as Address;
  console.log(`    SA: ${sa}  tx: ${deployRes.json.transactionHash}`);

  // 3. Find free label and build the atomic batch callData.
  const baseLabel = `eoa-${custodian.address.slice(2, 8).toLowerCase()}`;
  const label = await findFreeLabel(publicClient, d.agentNameRegistry, baseLabel);
  const fullName = `${label}.demo.agent`;
  const node = namehash(fullName);
  console.log(`3/5 label=${label}  fullName=${fullName}`);

  const registerData = encodeFunctionData({
    abi: SUBREGISTRY_ABI, functionName: 'register',
    args: [label, sa],
  });
  const setPrimaryData = encodeFunctionData({
    abi: REGISTRY_ABI, functionName: 'setPrimaryName',
    args: [node],
  });
  const batchCallData = encodeFunctionData({
    abi: AGENT_ACCOUNT_EXECUTE_BATCH_ABI, functionName: 'executeBatch',
    args: [[
      { target: d.permissionlessSubregistry, value: 0n, data: registerData },
      { target: d.agentNameRegistry, value: 0n, data: setPrimaryData },
    ]],
  });
  console.log(`    register selector  ${registerData.slice(0, 10)}`);
  console.log(`    setPrimary selector ${setPrimaryData.slice(0, 10)}`);
  console.log(`    batch selector      ${batchCallData.slice(0, 10)}`);

  // Bundler-side RPC propagation lag — even though /session/direct-deploy
  // waited for the deploy tx receipt, the bundler's simulation RPC can
  // still report `code(sender) == 0x` for a few seconds → AA20 account
  // not deployed. We sleep + poll to confirm at the read side before
  // building the userOp.
  console.log('… polling for SA bytecode visibility to bundler…');
  for (let i = 0; i < 20; i++) {
    const code = await publicClient.getBytecode({ address: sa });
    if (code && code !== '0x') { console.log(`    SA bytecode visible (${code.length} chars)`); break; }
    await new Promise((r) => setTimeout(r, 1500));
  }

  // 4. Build the userOp via demo-a2a (gets a userOpHash to sign).
  console.log('4/5 POST /account/build-call-userop…');
  const buildRes = await postJson('/account/build-call-userop', {
    sender: sa, callData: batchCallData,
  }, session);
  if (buildRes.status !== 200 || buildRes.json.ok !== true) {
    console.error(`build-call-userop failed: ${buildRes.status}`, buildRes.json);
    process.exit(1);
  }
  const userOpHash = buildRes.json.userOpHash as Hex;
  const userOp = buildRes.json.userOp as Record<string, unknown>;
  console.log(`    userOpHash: ${userOpHash}`);

  // 5. EOA signs the userOpHash and submit. Retry on AA20 — the
  // bundler-side simulation RPC may still report stale code() for a
  // few seconds after deploy.
  const signature = await custodian.sign({ hash: userOpHash });
  console.log(`    signature: ${signature.slice(0, 18)}…`);
  console.log('5/5 POST /account/submit-call-userop (with AA20 retry)…');
  let submitRes: Awaited<ReturnType<typeof postJson>> | null = null;
  const MAX_SUBMIT_ATTEMPTS = 6;
  for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt++) {
    submitRes = await postJson('/account/submit-call-userop', {
      userOp: { ...userOp, signature },
    }, session);
    if (submitRes.status === 200 && submitRes.json.ok === true) break;
    const detail = String(submitRes.json.detail ?? submitRes.json.error ?? '');
    const isAA20 = detail.includes('AA20') || detail.includes('account not deployed');
    const isAA25 = detail.includes('AA25') || /invalid account nonce/i.test(detail);
    console.error(`    attempt ${attempt} failed: ${detail.slice(0, 200)}`);
    if ((isAA20 || isAA25) && attempt < MAX_SUBMIT_ATTEMPTS) {
      const wait = 5000;
      console.error(`    retrying after ${wait}ms (transient bundler RPC lag)…`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    console.error(`submit-call-userop failed: ${submitRes.status}`, submitRes.json);
    process.exit(1);
  }
  if (!submitRes || submitRes.json.ok !== true) {
    console.error('submit-call-userop never succeeded');
    process.exit(1);
  }
  console.log(`    tx: ${submitRes.json.transactionHash}  status: ${submitRes.json.status}`);

  // 6. Read forward + reverse and assert. Alchemy's load-balanced
  //    RPC pool can serve stale views for a few seconds after a tx
  //    mines — same race we just patched on the bundler side. Poll
  //    until ALL three reads agree.
  console.log();
  console.log('asserting on-chain state (with read-pool propagation poll)…');
  let forward: Address = '0x0000000000000000000000000000000000000000';
  let reverseNode: Hex = ZERO_NODE;
  let registryPrimary: Hex = ZERO_NODE;
  const ASSERT_DEADLINE_MS = 30_000;
  const POLL_INTERVAL_MS = 2_000;
  const start = Date.now();
  while (Date.now() - start < ASSERT_DEADLINE_MS) {
    forward = (await publicClient.readContract({
      address: d.agentNameUniversalResolver, abi: UNIVERSAL_ABI,
      functionName: 'resolveName', args: [node],
    })) as Address;
    reverseNode = (await publicClient.readContract({
      address: d.agentNameUniversalResolver, abi: UNIVERSAL_ABI,
      functionName: 'reverseResolve', args: [sa],
    })) as Hex;
    registryPrimary = (await publicClient.readContract({
      address: d.agentNameRegistry, abi: REGISTRY_ABI,
      functionName: 'primaryName', args: [sa],
    })) as Hex;
    const allOk =
      forward.toLowerCase() === sa.toLowerCase() &&
      reverseNode === node &&
      registryPrimary === node;
    if (allOk) break;
    console.log(`    still propagating… (forward=${forward.slice(0, 10)} reverse=${reverseNode.slice(0, 10)} primary=${registryPrimary.slice(0, 10)})`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  console.log(`forward                  resolveName(${fullName}) = ${forward}`);
  console.log(`reverse                  reverseResolve(SA) = ${reverseNode}`);
  console.log(`registry.primaryName(SA) = ${registryPrimary}`);

  let failed = false;
  if (forward.toLowerCase() !== sa.toLowerCase()) {
    console.error(`✗ forward MISMATCH: expected ${sa}, got ${forward}`); failed = true;
  } else { console.log('✓ forward OK'); }
  if (reverseNode !== node) {
    console.error(`✗ reverse MISMATCH: expected ${node}, got ${reverseNode}`); failed = true;
  } else { console.log('✓ reverse OK'); }
  if (registryPrimary !== node) {
    console.error(`✗ primaryName MISMATCH: expected ${node}, got ${registryPrimary}`); failed = true;
  } else { console.log('✓ registry.primaryName OK'); }

  if (failed) { console.error('━━━ FAIL ━━━'); process.exit(2); }
  console.log('━━━ PASS ━━━ atomic batch register + setPrimaryName works end-to-end');
}

main().catch((e) => { console.error('unexpected error:', e); process.exit(1); });
