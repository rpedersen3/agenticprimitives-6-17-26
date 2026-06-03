// Shared `.impact` name reservation for demo-jp's Smart Agents (spec 247).
//
// A new SA claims a forced-unique `<base>[N].impact` in the permissionless
// subregistry and sets it primary, batched into one userOp (register +
// setPrimaryName). The same pick feeds both paths: the deploy `callData` for a
// FRESH SA (atomic with the deploy), and an `executeBatch` for an ALREADY-deployed
// SA that doesn't have a name yet ("if these are already created, go get a name").

import {
  AgentNamingClient,
  namehash,
  buildSubregistryRegisterCall,
  buildSetPrimaryNameCall,
} from '@agenticprimitives/agent-naming';
import { buildExecuteBatchCallData, type ContractCall } from '@agenticprimitives/agent-account';
import type { Address, Hex } from '@agenticprimitives/types';
import { CHAIN_ID, CONTRACTS, RPC_URL } from './chain.js';

function namingClient(): AgentNamingClient {
  return new AgentNamingClient({
    rpcUrl: RPC_URL,
    chainId: CHAIN_ID,
    registry: CONTRACTS.agentNameRegistry,
    universalResolver: CONTRACTS.agentNameUniversalResolver,
  });
}

/** Forced-unique `<base>[N].impact` pick (mirrors Connect's /connect/name), run
 *  locally so no cross-origin call is needed (one read mechanism, ADR-0013). */
export async function pickFreeName(base: string): Promise<{ label: string; name: string; node: Hex }> {
  const naming = namingClient();
  // Min 3 chars (matches Connect's /connect/name): the permissionless subregistry
  // rejects shorter labels, so a too-short base would revert the on-chain claim.
  const cleaned = base.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
  const s = cleaned.length >= 3 ? cleaned.slice(0, 24) : 'agent';
  for (let i = 1; i < 50; i++) {
    const label = i === 1 ? s : `${s}${i}`;
    const name = `${label}.impact`;
    if (!(await naming.resolveName(name))) return { label, name, node: namehash(name) };
  }
  throw new Error('no free name');
}

/** The register + setPrimaryName sub-calls an SA runs to claim `<base>`'s free name. */
export async function buildNameClaimCalls(sa: Address, base: string): Promise<{ calls: ContractCall[]; name: string }> {
  const picked = await pickFreeName(base);
  return {
    calls: [
      buildSubregistryRegisterCall({ subregistry: CONTRACTS.permissionlessSubregistry, label: picked.label, newOwner: sa }),
      buildSetPrimaryNameCall({ registry: CONTRACTS.agentNameRegistry, node: picked.node }),
    ],
    name: picked.name,
  };
}

/** The `executeBatch(register, setPrimary)` calldata an SA runs at DEPLOY time to
 *  claim `<base>`'s free name atomically in the same userOp. */
export async function buildNameClaimCallData(sa: Address, base: string): Promise<{ callData: Hex; name: string }> {
  const { calls, name } = await buildNameClaimCalls(sa, base);
  return { callData: buildExecuteBatchCallData(calls), name };
}

/** The SA's current primary `.impact` name, or `null` — so an already-deployed SA is
 *  only given a name when it doesn't already have one. */
export async function reverseName(sa: Address): Promise<string | null> {
  try {
    return await namingClient().reverseResolve(sa);
  } catch {
    return null;
  }
}
