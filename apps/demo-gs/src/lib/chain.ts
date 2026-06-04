// Live on-chain glue for demo-gs.
//
// (1) READS against the seeded skill + geo DEFINITION registries (spec 251) via the SDKs' injected
//     readContract seam (the original, fixture-era purpose).
// (2) Vault + deploy glue for spec 252 (vault persistence): the delegation contracts used to build an
//     owner-issued vault delegation, a persona signer, and the relayer deploy/derive/code helpers —
//     all routed through the `/a2a/*` Pages proxy → demo-a2a, exactly like demo-jp's chain.ts.

import { createPublicClient, http, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from '@agenticprimitives/types';
import { CONTRACTS as DEPLOYED } from '@agenticprimitives/contracts/deployments/base-sepolia';
import {
  skillDefinitionExists, type SkillDefinitionRef, type ReadContractFn as SkillReadFn,
} from '@agenticprimitives/agent-skills';
import {
  geoFeatureExists, type GeoFeatureRef, type ReadContractFn as GeoReadFn,
} from '@agenticprimitives/geo-features';
import { ensureCsrfToken, csrfHeaders } from '../csrf';

export const CHAIN_ID = 84532;

export const SKILL_REGISTRY = DEPLOYED.skillDefinitionRegistry as Address;
export const GEO_REGISTRY = DEPLOYED.geoFeatureRegistry as Address;

/** Delegation manager + enforcers — used to build the owner-issued vault delegation (spec 247/252).
 *  The enforcers gate the off-chain MCP token, not an on-chain redemption, so the vault delegation
 *  carries only the timestamp + value-0 caveats. Single source: the contracts deployments subpath. */
export const CONTRACTS = {
  delegationManager: DEPLOYED.delegationManager as Address,
  timestampEnforcer: DEPLOYED.timestampEnforcer as Address,
  valueEnforcer: DEPLOYED.valueEnforcer as Address,
} as const;

const RPC_URL = (import.meta.env?.VITE_RPC_URL as string | undefined) ?? 'https://sepolia.base.org';

let _client: PublicClient | null = null;
function client(): PublicClient {
  if (!_client) _client = createPublicClient({ transport: http(RPC_URL) });
  return _client;
}

/** Does this skill definition `(skillId, version)` exist on the live SkillDefinitionRegistry? */
export async function skillOnChain(ref: SkillDefinitionRef): Promise<boolean> {
  const read = ((a: Parameters<SkillReadFn>[0]) => client().readContract(a as never)) as SkillReadFn;
  return skillDefinitionExists(read, SKILL_REGISTRY, ref);
}

/** Does this geo feature `(featureId, version)` exist on the live GeoFeatureRegistry? */
export async function featureOnChain(ref: GeoFeatureRef): Promise<boolean> {
  const read = ((a: Parameters<GeoReadFn>[0]) => client().readContract(a as never)) as GeoReadFn;
  return geoFeatureExists(read, GEO_REGISTRY, ref);
}

// ─── Vault + deploy glue (spec 252) ─────────────────────────────────────────

/** A key-bearing custodian: the EOA that controls an SA (the vault delegate + ERC-1271 signer). */
export interface Signer {
  address: Address;
  privateKey: `0x${string}`;
}

export type SignHash = (hash: Hex) => Promise<Hex>;

/** A SignHash bound to a custodian's key. Eth-signed-message ECDSA — the SA's `_verifyEcdsa`
 *  eth-signed fallback recovers the custodian (same as demo-jp's personaSignHash). */
export function personaSignHash(s: Signer): SignHash {
  const account = privateKeyToAccount(s.privateKey);
  return (hash: Hex) => account.signMessage({ message: { raw: hash } }) as Promise<Hex>;
}

/** Predict the factory CREATE2 address for an EOA-custodied (Mode-0) org SA, via the relayer. */
export async function deriveOrgSaAddress(custodian: Address, salt: bigint): Promise<Address> {
  await ensureCsrfToken();
  const res = await fetch('/a2a/account/derive-address', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ initMethod: 'eoa', owner: custodian, salt: salt.toString() }),
  });
  const j = (await res.json().catch(() => null)) as { smartAccountAddress?: Address; address?: Address; error?: string } | null;
  const addr = j?.smartAccountAddress ?? j?.address;
  if (!res.ok || !addr) throw new Error(j?.error ?? `derive-address failed (HTTP ${res.status})`);
  return addr;
}

export interface DeployResult {
  ok: boolean;
  deployedAddress?: Address;
  txHash?: Hex;
  error?: string;
}

/** Deploy a Mode-0 EOA-custodied org SA through the relayer. No callData (no name-claim) — demo-gs
 *  only needs the SA deployed + ERC-1271-capable so it can own a vault (spec 252 §4). */
export async function deployOrgSa(args: { custodian: Signer; salt: bigint }): Promise<DeployResult> {
  await ensureCsrfToken();
  const buildRes = await fetch('/a2a/session/deploy', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ custodians: [args.custodian.address], salt: args.salt.toString() }),
  });
  if (buildRes.status === 409) return { ok: false, error: 'Gas sponsorship is not enabled on the relayer (paymaster).' };
  const built = (await buildRes.json().catch(() => null)) as {
    ok?: boolean; sender?: Address; userOpHash?: Hex; userOp?: Record<string, unknown>; error?: string;
  } | null;
  if (!buildRes.ok || !built?.ok || !built.userOpHash || !built.userOp) {
    return { ok: false, error: built?.error ?? `deploy build failed (HTTP ${buildRes.status})` };
  }
  const signature = await personaSignHash(args.custodian)(built.userOpHash);
  const submitRes = await fetch('/a2a/session/deploy/submit', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ userOp: { ...built.userOp, signature } }),
  });
  const submitted = (await submitRes.json().catch(() => null)) as {
    ok?: boolean; deployedAddress?: Address; transactionHash?: Hex; error?: string; detail?: string;
  } | null;
  if (!submitRes.ok || !submitted?.ok || !submitted.deployedAddress) {
    return { ok: false, error: [submitted?.error, submitted?.detail].filter(Boolean).join(' — ') || `deploy submit failed (HTTP ${submitRes.status})` };
  }
  return { ok: true, deployedAddress: submitted.deployedAddress, txHash: submitted.transactionHash };
}

/** Does an address already have contract code on chain? (skip a redundant, reverting re-deploy). */
export async function isContractDeployed(addr: Address): Promise<boolean> {
  try {
    const code = await client().getCode({ address: addr });
    return !!code && code !== '0x';
  } catch {
    return false;
  }
}
