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
import {
  buildExecuteCallData,
  buildExecuteBatchCallData,
} from '@agenticprimitives/agent-account';
import { config } from '../config';
import { executeCallFromAgent, executeCallFromAgentEoa } from './execute-call';
import type { DemoPasskey } from './passkey';
import { setCachedName } from './name-cache';
import type { WalletClient } from 'viem';

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
  console.log('[setPrimaryNameOnly] v7', { personAgent, agentName, node });
  const result = await sendSetPrimaryName(personAgent, passkey, node);
  console.log('[setPrimaryNameOnly] result', result);
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

  // Populate local cache + broadcast.
  setCachedName(personAgent, agentName);
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

  // Step 0.5 — pre-poll SA bytecode visibility. The bundler-side
  // simulation reads `code(sender)`; Alchemy's load-balanced pool can
  // serve stale views for a few seconds after factory.createAgentAccount
  // mined, giving us a spurious AA20. Wait until we can see code from
  // OUR read RPC before even attempting the userOp.
  {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const code = await publicClient.getCode({ address: personAgent });
        if (code && code !== '0x') break;
      } catch {
        // Ignore RPC transient errors.
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // Step 1 — ATOMIC BATCH: subregistry.register(label, sa) +
  // registry.setPrimaryName(node) in ONE userOp via
  // AgentAccount.executeBatch. Both calls land in the same on-chain
  // transaction — eliminates:
  //   - AA25 nonce mismatch between two sequential userOps
  //   - bundler simulating setPrimaryName before subregistry.register
  //     has propagated to its RPC view (NodeNotFound revert)
  //   - the inter-step propagation wait that was costing ~6-12s
  // If either inner call reverts, the whole batch reverts — there is
  // never a "register landed but setPrimaryName didn't" half-state.
  //
  // Retry on AA20 / AA25 — the bundler's pre-flight simulation RPC
  // can serve stale views (per the test-name-claim-eoa rig, this
  // happens routinely on Base Sepolia even after the deploy receipt
  // is in). 5 × 8s = up to 40s of patience.
  let registerTx: Hex | undefined;
  let primaryTx: Hex | undefined;
  {
    const registerCall = buildSubregistryRegisterCall({
      subregistry: config.permissionlessSubregistry,
      label: uniqueLabel,
      newOwner: personAgent,
    });
    const setPrimaryCall = buildSetPrimaryNameCall({
      registry: config.agentNameRegistry,
      node,
    });
    const batchCallData = buildExecuteBatchCallData([
      { to: registerCall.to as Address, value: registerCall.value, data: registerCall.data as Hex },
      { to: setPrimaryCall.to as Address, value: setPrimaryCall.value, data: setPrimaryCall.data as Hex },
    ]);
    console.log('[claim-psa-name] v8-atomic-batch+retry', {
      sender: personAgent,
      label: uniqueLabel,
      fullName,
      node,
      batchSelector: batchCallData.slice(0, 10),
    });

    const MAX_ATTEMPTS = 5;
    const RETRY_DELAY_MS = 8000;
    let lastErr = '';
    let result: Awaited<ReturnType<typeof executeCallFromAgent>> | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      result = await executeCallFromAgent({
        sender: personAgent,
        passkey,
        callData: batchCallData,
      });
      console.log(`[claim-psa-name] batch attempt ${attempt + 1}`, result);
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
        return { ok: false, reason: `"${fullName}" was taken by another caller between discovery and submit; retry.` };
      } else {
        return { ok: false, reason: `batch claim failed after retries: ${lastErr}` };
      }
    } else {
      registerTx = result.transactionHash;
      primaryTx = result.transactionHash;
    }
  }

  // Step 2 — poll until the universal resolver returns the new name.
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

  // Step 3 — populate the local name cache + broadcast. NameDisplay
  // reads synchronously from the cache (per ADR-0012, no browser-side
  // log scans).
  setCachedName(personAgent, fullName);
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

/**
 * SIWE-flavor of `sendSetPrimaryName` — same retry-on-AA20/AA25 loop
 * but signs via the wallet EOA instead of a passkey. Used by the
 * AlreadyClaimed recovery path in `claimPsaNameViaEoa` when the SA's
 * subregistry slot was consumed by a prior attempt (so the atomic
 * batch reverts, but the SA already owns the name and just needs
 * setPrimaryName to land separately).
 */
async function sendSetPrimaryNameEoa(
  sender: Address,
  walletClient: WalletClient,
  account: Address,
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
  const MAX_ATTEMPTS = 5;
  const RETRY_DELAY_MS = 8000;
  let result: Awaited<ReturnType<typeof executeCallFromAgentEoa>> | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    result = await executeCallFromAgentEoa({ sender, walletClient, account, callData });
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
    return { ok: false, reason: `setPrimaryName via EOA failed: ${lastErr}` };
  }
  return { ok: true, transactionHash: result.transactionHash };
}

/**
 * SIWE-flavor of `claimPsaName` — same atomic batch (register +
 * setPrimaryName) but signs the userOpHash with the user's wallet
 * EOA (custodian on the SA) via wagmi instead of a WebAuthn passkey.
 *
 * Used by Act 1 when the seat was claimed with SIWE only (no
 * passkey enrolled). The MetaMask popup shows a "Sign Message"
 * prompt with the userOpHash — same on-chain effect.
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

  // 0. Discover next-free label.
  let uniqueLabel: string;
  try {
    uniqueLabel = await findUniqueLabel(publicClient, config.agentNameRegistry, baseLabel);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  const fullName = `${uniqueLabel}.demo.agent`;
  const node = namehash(fullName);

  // 0.5. Pre-poll bytecode visibility (same race as the passkey path).
  {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const code = await publicClient.getCode({ address: personAgent });
        if (code && code !== '0x') break;
      } catch {}
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // 1. Atomic batch (subregistry.register + registry.setPrimaryName).
  const registerCall = buildSubregistryRegisterCall({
    subregistry: config.permissionlessSubregistry,
    label: uniqueLabel,
    newOwner: personAgent,
  });
  const setPrimaryCall = buildSetPrimaryNameCall({
    registry: config.agentNameRegistry,
    node,
  });
  const batchCallData = buildExecuteBatchCallData([
    { to: registerCall.to as Address, value: registerCall.value, data: registerCall.data as Hex },
    { to: setPrimaryCall.to as Address, value: setPrimaryCall.value, data: setPrimaryCall.data as Hex },
  ]);
  console.log('[claim-psa-name/eoa] v9', {
    sender: personAgent, account, label: uniqueLabel, fullName,
    batchSelector: batchCallData.slice(0, 10),
  });

  let batchTx: Hex | undefined;
  const MAX_ATTEMPTS = 5;
  const RETRY_DELAY_MS = 8000;
  let lastErr = '';
  let result: Awaited<ReturnType<typeof executeCallFromAgentEoa>> | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    result = await executeCallFromAgentEoa({
      sender: personAgent, walletClient, account, callData: batchCallData,
    });
    console.log(`[claim-psa-name/eoa] attempt ${attempt + 1}`, result);
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
    const lowered = lastErr.toLowerCase();
    // AlreadyClaimed — the SA's subregistry slot was consumed by a
    // prior attempt (register landed but the batch reverted on
    // setPrimaryName for some reason, OR a partial earlier run with
    // a different flow). The name is already owned by the SA; just
    // run setPrimaryName alone to bind the reverse record.
    //
    // The subregistry's AlreadyClaimed error carries the prior node;
    // we look it up directly from chain instead of relying on the
    // (often-mangled) decoded revert payload.
    if (
      lowered.includes('alreadyclaimed') ||
      lowered.includes('userop_reverted')
    ) {
      console.log('[claim-psa-name/eoa] AlreadyClaimed fallback — trying setPrimaryName alone');
      // Find the actual claimed node (whichever label this SA owns).
      try {
        const subregistryAbi = [
          {
            type: 'function', name: 'hasClaimed', stateMutability: 'view',
            inputs: [{ name: 'caller', type: 'address' }], outputs: [{ type: 'bool' }],
          },
          {
            type: 'function', name: 'claimedBy', stateMutability: 'view',
            inputs: [{ name: 'caller', type: 'address' }], outputs: [{ type: 'bytes32' }],
          },
        ] as const;
        const claimedNode = (await publicClient.readContract({
          address: config.permissionlessSubregistry,
          abi: subregistryAbi,
          functionName: 'claimedBy',
          args: [personAgent],
        })) as Hex;
        if (claimedNode !== ZERO_NODE) {
          // SA already owns SOME node — use that as the target for
          // setPrimaryName instead of the freshly-discovered one.
          const fallback = await sendSetPrimaryNameEoa(personAgent, walletClient, account, claimedNode);
          if (fallback.ok) {
            // Resolve the full name string from on-chain for accurate cache.
            try {
              const universalAbi = [
                {
                  type: 'function', name: 'nameOf', stateMutability: 'view',
                  inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'string' }],
                },
              ] as const;
              const resolvedName = config.agentNameUniversalResolver
                ? ((await publicClient.readContract({
                    address: config.agentNameUniversalResolver,
                    abi: universalAbi,
                    functionName: 'nameOf',
                    args: [claimedNode],
                  })) as string)
                : '';
              const actualName = resolvedName || fullName;
              setCachedName(personAgent, actualName);
              try {
                window.dispatchEvent(
                  new CustomEvent<NamingClaimedDetail>(NAMING_CLAIMED_EVENT, {
                    detail: { address: personAgent, name: actualName },
                  }),
                );
              } catch {}
              return {
                ok: true,
                name: actualName,
                label: actualName.replace(/\.demo\.agent$/, ''),
                registerTx: undefined,
                primaryTx: fallback.transactionHash,
              };
            } catch {
              // If we can't resolve the name, return success with the discovered label.
              return { ok: true, name: fullName, label: uniqueLabel, primaryTx: fallback.transactionHash };
            }
          }
          return { ok: false, reason: `AlreadyClaimed fallback failed: ${fallback.reason}` };
        }
      } catch (e) {
        return { ok: false, reason: `AlreadyClaimed lookup failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    return { ok: false, reason: `batch claim failed: ${lastErr}` };
  }
  batchTx = result.transactionHash;

  // 2. Cache + broadcast.
  setCachedName(personAgent, fullName);
  try {
    window.dispatchEvent(
      new CustomEvent<NamingClaimedDetail>(NAMING_CLAIMED_EVENT, {
        detail: { address: personAgent, name: fullName },
      }),
    );
  } catch {}

  return { ok: true, name: fullName, label: uniqueLabel, registerTx: batchTx, primaryTx: batchTx };
}
