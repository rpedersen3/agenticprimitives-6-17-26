// Pete + Jill as real PERSON Smart Agents (spec 247).
//
// Each operator EOA custodies TWO sibling SAs: its PERSON SA at salt 0 — which
// matches demo-sso's SIWE derivation `{ mode:0, custodians:[eoa], salt:0 }`, so the
// SAME key resolves the SAME SA when the operator connects at their `.me` home —
// and its ORG SA at salt 1 (onchain.ts). We deploy + name the person SA from the
// stored persona key so it is a real, connectable, ERC-1271-capable agent that can
// also own an MCP vault. No nested custody: the EOA owns both SAs directly.

import type { Address, Hex } from '@agenticprimitives/types';
import {
  AgentNamingClient,
  namehash,
  buildSubregistryRegisterCall,
  buildSetPrimaryNameCall,
} from '@agenticprimitives/agent-naming';
import { buildExecuteBatchCallData } from '@agenticprimitives/agent-account';
import {
  CHAIN_ID,
  CONTRACTS,
  RPC_URL,
  deployOrgSa,
  deriveOrgSaAddress,
  isContractDeployed,
} from './chain.js';
import { loadOrMintPersona, type PersonaName } from './personas.js';

/** Salt 0 = the operator's own person SA (demo-sso SIWE convention). Orgs use salt 1. */
export const PERSON_SALT = 0n;

export interface PersonChainState {
  name: PersonaName;
  custodian: Address;
  /** The person SA (custodian EOA @ salt 0) — same address demo-sso SIWE resolves. */
  saAddress: Address;
  /** Claimed `.impact` primary name (e.g. `pete.impact`), once deployed. */
  agentName?: string;
  deployed: boolean;
  deployTxHash?: Hex;
}

const KEY = (n: PersonaName) => `demo-jp/person-deploy/${n}`;

function loadState(n: PersonaName): PersonChainState | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(KEY(n));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersonChainState;
  } catch {
    return null;
  }
}

function saveState(s: PersonChainState): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY(s.name), JSON.stringify(s));
}

/** The person SA address for an operator (custodian EOA @ salt 0) — no deploy. */
export async function personSaAddress(name: PersonaName): Promise<Address> {
  const cached = loadState(name);
  if (cached?.saAddress) return cached.saAddress;
  const persona = loadOrMintPersona(name);
  return deriveOrgSaAddress(persona.address, PERSON_SALT);
}

/** Forced-unique `<base>[N].impact` pick — mirrors Connect's /connect/name, run locally
 *  so demo-jp needs no cross-origin call (one read mechanism, ADR-0013). */
async function pickFreeName(base: string): Promise<{ label: string; name: string; node: Hex }> {
  const naming = new AgentNamingClient({
    rpcUrl: RPC_URL,
    chainId: CHAIN_ID,
    registry: CONTRACTS.agentNameRegistry,
    universalResolver: CONTRACTS.agentNameUniversalResolver,
  });
  const s = base.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '') || 'agent';
  for (let i = 1; i < 50; i++) {
    const label = i === 1 ? s : `${s}${i}`;
    const name = `${label}.impact`;
    if (!(await naming.resolveName(name))) return { label, name, node: namehash(name) };
  }
  throw new Error('no free name');
}

/** Derive → deploy (if needed) → name the operator's person SA. Idempotent: a cached
 *  deployed state short-circuits, and an already-on-chain SA (e.g. created when the
 *  operator first connected at their `.me` home) is adopted rather than re-deployed. */
export async function ensurePersonDeployed(name: PersonaName): Promise<PersonChainState> {
  const persona = loadOrMintPersona(name);
  const cached = loadState(name);
  if (cached?.deployed) return cached;

  const saAddress = cached?.saAddress ?? (await deriveOrgSaAddress(persona.address, PERSON_SALT));

  if (await isContractDeployed(saAddress)) {
    const adopted: PersonChainState = {
      name, custodian: persona.address, saAddress, deployed: true, agentName: cached?.agentName,
    };
    saveState(adopted);
    return adopted;
  }

  const picked = await pickFreeName(name); // base = 'pete' / 'jill'
  const register = buildSubregistryRegisterCall({
    subregistry: CONTRACTS.permissionlessSubregistry,
    label: picked.label,
    newOwner: saAddress,
  });
  const setPrimary = buildSetPrimaryNameCall({ registry: CONTRACTS.agentNameRegistry, node: picked.node });
  const callData = buildExecuteBatchCallData([register, setPrimary]);

  const res = await deployOrgSa({ custodian: persona, salt: PERSON_SALT, callData });
  if (!res.ok || !res.deployedAddress) {
    saveState({ name, custodian: persona.address, saAddress, deployed: false, agentName: picked.name });
    throw new Error(res.error ?? 'person deploy failed');
  }
  const state: PersonChainState = {
    name,
    custodian: persona.address,
    saAddress: res.deployedAddress,
    agentName: picked.name,
    deployed: true,
    deployTxHash: res.txHash,
  };
  saveState(state);
  return state;
}

export function personChainState(name: PersonaName): PersonChainState | null {
  return loadState(name);
}
