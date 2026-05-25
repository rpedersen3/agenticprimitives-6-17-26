/**
 * claim-psa-name.ts — auto-claim a forced-unique `<label>[N].demo.agent`
 * name for a freshly deployed Smart Agent and set it as the SA's
 * primary name.
 *
 * Ported (lean) from demo-web-pro. Per ADR-0010 + spec 220 § 5 the
 * algorithm forces uniqueness via a sequential-number suffix:
 * `sam` → `sam2` → `sam3` → …. The register + setPrimaryName land in
 * ONE atomic `executeBatch` userOp so there's never a half-claimed
 * state.
 *
 * Slice 1 ships the passkey signing path (Sam onboards with a passkey).
 * Slice 2 adds the EOA/SIWE path alongside it.
 *
 * Reads use the package's single-call `reverseResolveString` — no
 * `eth_getLogs` walk, no fallback (ADR-0013).
 */

import {
  createPublicClient,
  encodePacked,
  http,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type WalletClient,
} from 'viem';
import {
  AgentNamingClient,
  agentNameRegistryAbi,
  buildSubregistryRegisterCall,
  buildSetPrimaryNameCall,
} from '@agenticprimitives/agent-naming';
import {
  buildExecuteCallData,
  buildExecuteBatchCallData,
} from '@agenticprimitives/agent-account';
import { config } from '../config';
import { executeCallFromAgent, executeCallFromAgentEoa } from './execute-call';
import type { DemoPasskey } from './passkey';
import { setCachedName } from './name-cache';

/** Fired AFTER a claim propagates so NameDisplay reads refresh. */
export const NAMING_CLAIMED_EVENT = 'naming:claimed';
export interface NamingClaimedDetail {
  address: Address;
  name: string;
}

export type ClaimPsaNameResult =
  | { ok: true; name: string; label: string; registerTx?: Hex; primaryTx?: Hex }
  | { ok: false; reason: string };

const ZERO_NODE = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;
const MAX_SUFFIX = 9999;

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

const DEMO_NODE: Hex = namehash('demo.agent');

async function findUniqueLabel(
  publicClient: ReturnType<typeof createPublicClient>,
  registry: Address,
  baseLabel: string,
): Promise<string> {
  for (let i = 1; i < MAX_SUFFIX; i++) {
    const candidate = i === 1 ? baseLabel : `${baseLabel}${i}`;
    const labelhash = keccak256(toHex(candidate));
    const childNode = await publicClient.readContract({
      address: registry,
      abi: agentNameRegistryAbi,
      functionName: 'childNode',
      args: [DEMO_NODE, labelhash],
    });
    if (childNode === ZERO_NODE) return candidate;
    const exists = await publicClient.readContract({
      address: registry,
      abi: agentNameRegistryAbi,
      functionName: 'recordExists',
      args: [childNode],
    });
    if (!exists) return candidate;
  }
  throw new Error(`No free label found after ${MAX_SUFFIX} attempts starting from "${baseLabel}"`);
}

/**
 * Predict the next-free `<label>` BEFORE the passkey ceremony so the OS
 * keychain entry can match the eventual `.agent` name.
 */
export async function predictUniqueAgentLabel(baseLabel: string): Promise<string | null> {
  if (!config.agentNameRegistry || !config.rpcUrl) return null;
  if (!/^[a-z0-9-]{3,}$/.test(baseLabel)) return null;
  const publicClient = createPublicClient({ transport: http(config.rpcUrl) });
  try {
    return await findUniqueLabel(publicClient, config.agentNameRegistry, baseLabel);
  } catch {
    return null;
  }
}

/** Gasless `setPrimaryName(node)` via the SA's passkey, retry on AA25. */
async function sendSetPrimaryName(
  sender: Address,
  passkey: DemoPasskey,
  node: Hex,
): Promise<{ ok: true; transactionHash?: Hex } | { ok: false; reason: string }> {
  if (!config.agentNameRegistry) {
    return { ok: false, reason: 'agentNameRegistry not configured' };
  }
  const call = buildSetPrimaryNameCall({ registry: config.agentNameRegistry, node });
  const callData = buildExecuteCallData({
    to: call.to as Address,
    value: call.value,
    data: call.data as Hex,
  });
  let lastErr = '';
  let result: Awaited<ReturnType<typeof executeCallFromAgent>> | null = null;
  const MAX_ATTEMPTS = 5;
  const RETRY_DELAY_MS = 12000;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    result = await executeCallFromAgent({ sender, passkey, callData });
    if (result.ok) break;
    lastErr = result.reason ?? result.error;
    const isNonceMismatch =
      lastErr.includes('AA25') ||
      lastErr.toLowerCase().includes('invalid account nonce') ||
      lastErr.toLowerCase().includes('replacement transaction underpriced');
    if (isNonceMismatch && attempt + 1 < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }
    break;
  }
  if (!result || !result.ok) {
    return { ok: false, reason: `setPrimaryName failed: ${lastErr}` };
  }
  return { ok: true, transactionHash: result.transactionHash };
}

/**
 * Claim `<baseLabel>[N].demo.agent` for `personAgent` and set it primary,
 * signing with the SA's passkey. Best-effort; never throws.
 */
export async function claimPsaName(args: {
  baseLabel: string;
  personAgent: Address;
  passkey: DemoPasskey;
}): Promise<ClaimPsaNameResult> {
  const { baseLabel, personAgent, passkey } = args;
  if (!config.permissionlessSubregistry || !config.agentNameRegistry || !config.rpcUrl) {
    return { ok: false, reason: 'naming contracts not configured (subregistry / registry / rpc missing)' };
  }
  if (!/^[a-z0-9-]{3,}$/.test(baseLabel)) {
    return { ok: false, reason: `label "${baseLabel}" must match /^[a-z0-9-]{3,}$/` };
  }

  const publicClient = createPublicClient({ transport: http(config.rpcUrl) });

  // Early-out if the SA already has a primary name (re-run on the same
  // deterministic CREATE2 address). Single read, no fallback.
  if (config.agentNameUniversalResolver && config.chainId) {
    try {
      const existing = await new AgentNamingClient({
        rpcUrl: config.rpcUrl,
        chainId: config.chainId,
        registry: config.agentNameRegistry,
        universalResolver: config.agentNameUniversalResolver,
      }).reverseResolve(personAgent);
      if (existing && /^[a-z0-9-]+\.demo\.agent$/i.test(existing)) {
        setCachedName(personAgent, existing);
        broadcastClaimed(personAgent, existing);
        return { ok: true, name: existing, label: existing.replace(/\.demo\.agent$/i, '') };
      }
    } catch {
      // Pre-check failure is non-fatal — continue with the normal claim.
    }
  }

  let uniqueLabel: string;
  try {
    uniqueLabel = await findUniqueLabel(publicClient, config.agentNameRegistry, baseLabel);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  const fullName = `${uniqueLabel}.demo.agent`;
  const node = namehash(fullName);

  // Pre-poll SA bytecode visibility (bundler reads code(sender); Alchemy's
  // pool can serve stale views right after deploy).
  {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const code = await publicClient.getCode({ address: personAgent });
        if (code && code !== '0x') break;
      } catch { /* transient */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // ATOMIC BATCH: subregistry.register + registry.setPrimaryName in one
  // executeBatch userOp. Retry on AA20/AA25 (stale bundler simulation RPC).
  let registerTx: Hex | undefined;
  let primaryTx: Hex | undefined;
  {
    const registerCall = buildSubregistryRegisterCall({
      subregistry: config.permissionlessSubregistry,
      label: uniqueLabel,
      newOwner: personAgent,
    });
    const setPrimaryCall = buildSetPrimaryNameCall({ registry: config.agentNameRegistry, node });
    const batchCallData = buildExecuteBatchCallData([
      { to: registerCall.to as Address, value: registerCall.value, data: registerCall.data as Hex },
      { to: setPrimaryCall.to as Address, value: setPrimaryCall.value, data: setPrimaryCall.data as Hex },
    ]);

    const MAX_ATTEMPTS = 5;
    const RETRY_DELAY_MS = 8000;
    let lastErr = '';
    let result: Awaited<ReturnType<typeof executeCallFromAgent>> | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      result = await executeCallFromAgent({ sender: personAgent, passkey, callData: batchCallData });
      if (result.ok) break;
      lastErr = (result.reason ?? result.error ?? '').toString();
      const lowered = lastErr.toLowerCase();
      const transient =
        lowered.includes('aa20') ||
        lowered.includes('account not deployed') ||
        lowered.includes('aa25') ||
        lowered.includes('invalid account nonce') ||
        lowered.includes('replacement transaction underpriced');
      if (transient && attempt + 1 < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      break;
    }
    if (!result || !result.ok) {
      const reason = (result?.reason ?? '').toLowerCase();
      if (reason.includes('alreadyclaimed')) {
        const fallback = await sendSetPrimaryName(personAgent, passkey, node);
        if (!fallback.ok) return { ok: false, reason: fallback.reason };
        primaryTx = fallback.transactionHash;
      } else if (reason.includes('nodealreadyexists')) {
        return { ok: false, reason: `"${fullName}" was taken between discovery and submit; retry.` };
      } else {
        return { ok: false, reason: `batch claim failed after retries: ${lastErr}` };
      }
    } else {
      registerTx = result.transactionHash;
      primaryTx = result.transactionHash;
    }
  }

  // Poll until the resolver returns the new name (single-call reads).
  if (config.agentNameUniversalResolver && config.chainId) {
    const namingClient = new AgentNamingClient({
      rpcUrl: config.rpcUrl,
      chainId: config.chainId,
      registry: config.agentNameRegistry,
      universalResolver: config.agentNameUniversalResolver,
    });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const resolved = await namingClient.reverseResolve(personAgent);
        if (resolved && resolved.toLowerCase() === fullName.toLowerCase()) break;
      } catch { /* transient */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  setCachedName(personAgent, fullName);
  broadcastClaimed(personAgent, fullName);
  return { ok: true, name: fullName, label: uniqueLabel, registerTx, primaryTx };
}

function broadcastClaimed(address: Address, name: string): void {
  try {
    window.dispatchEvent(
      new CustomEvent<NamingClaimedDetail>(NAMING_CLAIMED_EVENT, { detail: { address, name } }),
    );
  } catch { /* SSR / no window */ }
}

/** EOA-signed `setPrimaryName(node)` with AA20/AA25 retry. */
async function sendSetPrimaryNameEoa(
  sender: Address,
  walletClient: WalletClient,
  account: Address,
  node: Hex,
): Promise<{ ok: true; transactionHash?: Hex } | { ok: false; reason: string }> {
  if (!config.agentNameRegistry) return { ok: false, reason: 'agentNameRegistry not configured' };
  const call = buildSetPrimaryNameCall({ registry: config.agentNameRegistry, node });
  const callData = buildExecuteCallData({ to: call.to as Address, value: call.value, data: call.data as Hex });
  let lastErr = '';
  let result: Awaited<ReturnType<typeof executeCallFromAgentEoa>> | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    result = await executeCallFromAgentEoa({ sender, walletClient, account, callData });
    if (result.ok) break;
    lastErr = (result.reason ?? result.error ?? '').toString();
    const t = lastErr.toLowerCase();
    if ((t.includes('aa20') || t.includes('aa25') || t.includes('account not deployed') || t.includes('invalid account nonce')) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 8000));
      continue;
    }
    break;
  }
  if (!result || !result.ok) return { ok: false, reason: `setPrimaryName via EOA failed: ${lastErr}` };
  return { ok: true, transactionHash: result.transactionHash };
}

/**
 * SIWE/EOA flavour of {@link claimPsaName} — same atomic register +
 * setPrimaryName batch, but the SA's EOA custodian signs the userOpHash
 * via the wallet. Best-effort; never throws. Reverse reads stay
 * single-call (no log walk, ADR-0013).
 */
export async function claimPsaNameViaEoa(args: {
  baseLabel: string;
  personAgent: Address;
  walletClient: WalletClient;
  account: Address;
}): Promise<ClaimPsaNameResult> {
  const { baseLabel, personAgent, walletClient, account } = args;
  if (!config.permissionlessSubregistry || !config.agentNameRegistry || !config.rpcUrl) {
    return { ok: false, reason: 'naming contracts not configured (subregistry / registry / rpc missing)' };
  }
  if (!/^[a-z0-9-]{3,}$/.test(baseLabel)) {
    return { ok: false, reason: `label "${baseLabel}" must match /^[a-z0-9-]{3,}$/` };
  }

  const publicClient = createPublicClient({ transport: http(config.rpcUrl) });

  // Early-out if a primary name already resolves (re-run on the same address).
  if (config.agentNameUniversalResolver && config.chainId) {
    try {
      const existing = await new AgentNamingClient({
        rpcUrl: config.rpcUrl,
        chainId: config.chainId,
        registry: config.agentNameRegistry,
        universalResolver: config.agentNameUniversalResolver,
      }).reverseResolve(personAgent);
      if (existing && /^[a-z0-9-]+\.demo\.agent$/i.test(existing)) {
        setCachedName(personAgent, existing);
        broadcastClaimed(personAgent, existing);
        return { ok: true, name: existing, label: existing.replace(/\.demo\.agent$/i, '') };
      }
    } catch { /* non-fatal */ }
  }

  let uniqueLabel: string;
  try {
    uniqueLabel = await findUniqueLabel(publicClient, config.agentNameRegistry, baseLabel);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  const fullName = `${uniqueLabel}.demo.agent`;
  const node = namehash(fullName);

  // Pre-poll bytecode visibility.
  {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const code = await publicClient.getCode({ address: personAgent });
        if (code && code !== '0x') break;
      } catch { /* transient */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  const registerCall = buildSubregistryRegisterCall({
    subregistry: config.permissionlessSubregistry,
    label: uniqueLabel,
    newOwner: personAgent,
  });
  const setPrimaryCall = buildSetPrimaryNameCall({ registry: config.agentNameRegistry, node });
  const batchCallData = buildExecuteBatchCallData([
    { to: registerCall.to as Address, value: registerCall.value, data: registerCall.data as Hex },
    { to: setPrimaryCall.to as Address, value: setPrimaryCall.value, data: setPrimaryCall.data as Hex },
  ]);

  let registerTx: Hex | undefined;
  let primaryTx: Hex | undefined;
  let lastErr = '';
  let result: Awaited<ReturnType<typeof executeCallFromAgentEoa>> | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    result = await executeCallFromAgentEoa({ sender: personAgent, walletClient, account, callData: batchCallData });
    if (result.ok) break;
    lastErr = (result.reason ?? result.error ?? '').toString();
    const t = lastErr.toLowerCase();
    if ((t.includes('aa20') || t.includes('aa25') || t.includes('account not deployed') || t.includes('invalid account nonce')) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 8000));
      continue;
    }
    break;
  }
  if (!result || !result.ok) {
    const reason = (result?.reason ?? lastErr).toLowerCase();
    if (reason.includes('alreadyclaimed') || reason.includes('userop_reverted')) {
      // Name already owned by the SA; just bind the reverse record.
      const fallback = await sendSetPrimaryNameEoa(personAgent, walletClient, account, node);
      if (!fallback.ok) return { ok: false, reason: fallback.reason };
      primaryTx = fallback.transactionHash;
    } else {
      return { ok: false, reason: `batch claim (EOA) failed after retries: ${lastErr}` };
    }
  } else {
    registerTx = result.transactionHash;
    primaryTx = result.transactionHash;
  }

  if (config.agentNameUniversalResolver && config.chainId) {
    const namingClient = new AgentNamingClient({
      rpcUrl: config.rpcUrl,
      chainId: config.chainId,
      registry: config.agentNameRegistry,
      universalResolver: config.agentNameUniversalResolver,
    });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const resolved = await namingClient.reverseResolve(personAgent);
        if (resolved && resolved.toLowerCase() === fullName.toLowerCase()) break;
      } catch { /* transient */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  setCachedName(personAgent, fullName);
  broadcastClaimed(personAgent, fullName);
  return { ok: true, name: fullName, label: uniqueLabel, registerTx, primaryTx };
}
