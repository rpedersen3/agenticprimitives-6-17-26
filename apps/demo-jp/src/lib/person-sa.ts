// Pete + Jill as real PERSON Smart Agents (spec 247).
//
// Each operator EOA custodies TWO sibling SAs: its PERSON SA at salt 0 — which
// matches demo-sso's SIWE derivation `{ mode:0, custodians:[eoa], salt:0 }`, so the
// SAME key resolves the SAME SA when the operator connects at their `.me` home —
// and its ORG SA at salt 1 (onchain.ts). We deploy + name the person SA from the
// stored persona key so it is a real, connectable, ERC-1271-capable agent that can
// also own an MCP vault. No nested custody: the EOA owns both SAs directly.

import type { Address, Hex } from '@agenticprimitives/types';
import { deployOrgSa, deriveOrgSaAddress, isContractDeployed } from './chain.js';
import { buildNameClaimCallData } from './naming.js';
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

  // Reserve a `<name>.impact` name and claim it atomically in the deploy userOp.
  const { callData, name: agentName } = await buildNameClaimCallData(saAddress, name); // base = 'pete' / 'jill'

  const res = await deployOrgSa({ custodian: persona, salt: PERSON_SALT, callData });
  if (!res.ok || !res.deployedAddress) {
    saveState({ name, custodian: persona.address, saAddress, deployed: false, agentName });
    throw new Error(res.error ?? 'person deploy failed');
  }
  const state: PersonChainState = {
    name,
    custodian: persona.address,
    saAddress: res.deployedAddress,
    agentName,
    deployed: true,
    deployTxHash: res.txHash,
  };
  saveState(state);
  return state;
}

export function personChainState(name: PersonaName): PersonChainState | null {
  return loadState(name);
}
