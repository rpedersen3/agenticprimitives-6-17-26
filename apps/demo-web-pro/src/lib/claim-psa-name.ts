/**
 * claim-psa-name.ts — auto-claim a forced-unique `<label>[N].demo.agent`
 * name for a freshly deployed Smart Agent and set it as the SA's
 * primary name.
 *
 * Per ADR-0010 + spec 220 § 5, the algorithm forces uniqueness via a
 * sequential-number suffix: `alice` → `alice2` → `alice3` → … No hex
 * salts, no global collisions, names stay human-readable.
 *
 * Three on-chain reads/writes, all gasless via the SA's passkey path:
 *   1. Discover the next available label by querying
 *      `AgentNameRegistry.childNode(demoNode, keccak256(candidate))`
 *      for each candidate, starting at `baseLabel` and counter-
 *      suffixing on collision.
 *   2. PermissionlessSubregistry.register(uniqueLabel, sa) — claims
 *      the unique subname owned by the SA.
 *   3. AgentNameRegistry.setPrimaryName(node) — sets the SA's reverse
 *      record so NameDisplay everywhere shows the new name.
 *
 * Best-effort: failures surface a structured reason so the demo's
 * success card can render a hint without blocking flow.
 */

import {
  createPublicClient,
  encodePacked,
  http,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import {
  AgentNamingClient,
  agentNameRegistryAbi,
  buildSubregistryRegisterCall,
  buildSetPrimaryNameCall,
} from '@agenticprimitives/agent-naming';
import { buildExecuteCallData } from '@agenticprimitives/agent-account';
import { config } from '../config';
import { executeCallFromAgent } from './execute-call';
import type { DemoPasskey } from './passkey';

/**
 * Event fired AFTER the on-chain claim has propagated and a fresh
 * reverseResolve(address) returns the expected name. Listeners (e.g.
 * `useNamingClaimListener` in use-agent-naming.ts) invalidate cached
 * React Query name reads so NameDisplay everywhere refreshes.
 */
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

/**
 * Walk `baseLabel`, `baseLabel2`, `baseLabel3`, … against the live
 * registry to find the next free label. Per spec 220 § 5. Exported so
 * Act 1 / Act 3 can predict the label BEFORE registering the passkey,
 * letting the OS-level passkey name match the eventual `.agent` name
 * (e.g. `alice3.demo.agent`).
 *
 * TOCTOU note: another caller may grab the label between this read
 * and the eventual `subregistry.register` write. `claimPsaName` runs
 * its own discovery to recover; in that case the on-chain name will
 * be the NEXT free label and the passkey name might be off by one.
 * That's an acceptable soft degradation for the demo.
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
 * Send `setPrimaryName(node)` from the SA via the gasless passkey
 * path. Aggressive retry on AA25 because Base Sepolia's load-balanced
 * RPC pool can return stale nonce state for a while after the prior
 * userOp (subregistry.register) lands. 5 attempts × 12s = up to 60s
 * of patience.
 *
 * Returns a structured result; never throws.
 */
async function sendSetPrimaryName(
  sender: Address,
  passkey: DemoPasskey,
  node: Hex,
): Promise<{ ok: true; transactionHash?: Hex } | { ok: false; reason: string }> {
  if (!config.agentNameRegistry) {
    return { ok: false, reason: 'agentNameRegistry not configured' };
  }
  const call = buildSetPrimaryNameCall({
    registry: config.agentNameRegistry,
    node,
  });
  const callData = buildExecuteCallData({
    to: call.to as Address,
    value: call.value,
    data: call.data as Hex,
  });
  let lastErr = '';
  let attempt = 0;
  let result: Awaited<ReturnType<typeof executeCallFromAgent>> | null = null;
  const MAX_ATTEMPTS = 5;
  const RETRY_DELAY_MS = 12000;
  for (attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
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
    return {
      ok: false,
      reason: `setPrimaryName failed after ${attempt + 1} attempt${attempt === 0 ? '' : 's'}: ${lastErr}`,
    };
  }
  return { ok: true, transactionHash: result.transactionHash };
}

/**
 * Recovery helper: SA's owner of `<name>` is already on chain
 * (subregistry.register landed) but the reverse record was never set.
 * This re-runs ONLY the setPrimaryName step + propagation poll +
 * naming:claimed broadcast. Used by AgentDetailModal's "Set primary
 * name now" button when the diagnostic shows
 * forward ✓ / reverse ✗.
 */
export async function setPrimaryNameOnly(args: {
  personAgent: Address;
  passkey: DemoPasskey;
  agentName: string;
}): Promise<{ ok: true; transactionHash?: Hex; name: string } | { ok: false; reason: string }> {
  const { personAgent, passkey, agentName } = args;
  if (!config.agentNameRegistry || !config.agentNameUniversalResolver || !config.rpcUrl) {
    return { ok: false, reason: 'naming contracts / RPC not configured' };
  }
  const node = namehash(agentName);
  const result = await sendSetPrimaryName(personAgent, passkey, node);
  if (!result.ok) return result;

  // Poll the resolver until it returns the expected name (or timeout).
  const namingClient = new AgentNamingClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId!,
    registry: config.agentNameRegistry,
    universalResolver: config.agentNameUniversalResolver,
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const resolved = await namingClient.reverseResolve(personAgent);
      if (resolved && resolved.toLowerCase() === agentName.toLowerCase()) break;
    } catch {
      // Ignore transient RPC errors.
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Broadcast so cached NameDisplay reads invalidate.
  try {
    window.dispatchEvent(
      new CustomEvent<NamingClaimedDetail>(NAMING_CLAIMED_EVENT, {
        detail: { address: personAgent, name: agentName },
      }),
    );
  } catch {}

  return { ok: true, transactionHash: result.transactionHash, name: agentName };
}

export async function claimPsaName(args: {
  /** The desired base label (3+ chars, a-z 0-9 -). Forced-unique via counter. */
  baseLabel: string;
  /** The Smart Agent address (person / org / treasury). */
  personAgent: Address;
  /** The passkey bound to the SA via its custodian set. */
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

  // Step 0 — discover the next-free label.
  let uniqueLabel: string;
  try {
    uniqueLabel = await findUniqueLabel(publicClient, config.agentNameRegistry, baseLabel);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  const fullName = `${uniqueLabel}.demo.agent`;
  const node = namehash(fullName);

  // Step 1 — subregistry.register(uniqueLabel, personAgent).
  let registerTx: Hex | undefined;
  {
    const call = buildSubregistryRegisterCall({
      subregistry: config.permissionlessSubregistry,
      label: uniqueLabel,
      newOwner: personAgent,
    });
    const callData = buildExecuteCallData({
      to: call.to as Address,
      value: call.value,
      data: call.data as Hex,
    });
    const result = await executeCallFromAgent({
      sender: personAgent,
      passkey,
      callData,
    });
    if (!result.ok) {
      const reason = (result.reason ?? '').toLowerCase();
      // AlreadyClaimed → this SA already has a name. Fall through to
      // step 2; the SA may have already registered something in a
      // prior run AND we still want primaryName to land.
      if (reason.includes('alreadyclaimed')) {
        // No tx hash — we didn't actually send anything new on chain.
      } else if (reason.includes('nodealreadyexists')) {
        // Race: another caller grabbed this label between our
        // discovery and our submit. Bail with a clear error; the
        // caller can retry, which will re-discover the next free.
        return { ok: false, reason: `"${fullName}" was taken by another caller between discovery and submit; retry.` };
      } else {
        return { ok: false, reason: result.reason ?? result.error };
      }
    } else {
      registerTx = result.transactionHash;
    }
  }

  // Inter-step propagation wait — Base Sepolia's RPC pool can return
  // stale state for a few seconds after a userOp lands. 6 s + an AA25
  // retry loop below gives ~14 s of slack.
  if (registerTx) {
    await new Promise((r) => setTimeout(r, 6000));
  }

  // Step 2 — setPrimaryName.
  const primaryResult = await sendSetPrimaryName(personAgent, passkey, node);
  if (!primaryResult.ok) {
    return {
      ok: false,
      reason: primaryResult.reason +
        (registerTx ? ` (register OK — ${fullName})` : ''),
    };
  }
  const primaryTx: Hex | undefined = primaryResult.transactionHash;

  // Step 3 — poll until the universal resolver returns the new name.
  // Base Sepolia's RPC pool can return stale state for a few seconds
  // after a userOp lands; without this, downstream NameDisplay reads
  // would invalidate too early and re-cache the stale null. We wait
  // up to ~15s. If polling doesn't see the name in time we still
  // return ok — the event fires anyway and React Query will refetch
  // on later interactions.
  if (
    config.agentNameRegistry &&
    config.agentNameUniversalResolver &&
    config.chainId &&
    config.rpcUrl
  ) {
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
      } catch {
        // Ignore transient RPC errors; keep polling.
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // Step 4 — broadcast so cached NameDisplay reads invalidate.
  try {
    window.dispatchEvent(
      new CustomEvent<NamingClaimedDetail>(NAMING_CLAIMED_EVENT, {
        detail: { address: personAgent, name: fullName },
      }),
    );
  } catch {
    // Server / SSR / test harness without window — skip silently.
  }

  return { ok: true, name: fullName, label: uniqueLabel, registerTx, primaryTx };
}
