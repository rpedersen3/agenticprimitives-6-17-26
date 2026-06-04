// On-chain provisioning for demo-gs's broker vault (spec 252 §4). The Switchboard org SA must be
// DEPLOYED + ERC-1271-capable before any vault write (the relayer verifies the owner's signature,
// no EOA fallback). This is the minimal `ensureOrgDeployed('jp')` analog: derive the canonical
// factory address from Jane's custodian + a fixed salt, deploy via the relayer if absent, cache it.

import { keccak256, toBytes } from 'viem';
import type { Address } from '@agenticprimitives/types';
import { deployOrgSa, deriveOrgSaAddress, isContractDeployed } from './chain';
import { JANE_CUSTODIAN } from './personas';
import type { VaultOwner } from './vault-client';

/** Fixed CREATE2 salt for the Switchboard broker org SA (deterministic across sessions/browsers). */
const SWITCHBOARD_SALT: bigint = BigInt(keccak256(toBytes('demo-gs/switchboard-org/v1')));

const CACHE_KEY = 'agenticprimitives:demo-gs:switchboard-sa';
interface DeployState { sa: Address; deployed: boolean }

function loadState(): DeployState | null {
  try { const r = localStorage.getItem(CACHE_KEY); return r ? (JSON.parse(r) as DeployState) : null; } catch { return null; }
}
function saveState(s: DeployState): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// Concurrent callers (each broker panel on mount) share ONE in-flight deploy — otherwise they'd each
// pass the not-yet-deployed check and race two deploys (nonce conflict).
let _inflight: Promise<DeployState> | null = null;

export function ensureSwitchboardDeployed(): Promise<DeployState> {
  if (_inflight) return _inflight;
  _inflight = _ensure().finally(() => { _inflight = null; });
  return _inflight;
}

async function _ensure(): Promise<DeployState> {
  const cached = loadState();
  if (cached?.deployed) return cached;

  const sa = cached?.sa ?? (await deriveOrgSaAddress(JANE_CUSTODIAN.address, SWITCHBOARD_SALT));

  if (await isContractDeployed(sa)) {
    const adopted: DeployState = { sa, deployed: true };
    saveState(adopted);
    return adopted;
  }

  const res = await deployOrgSa({ custodian: JANE_CUSTODIAN, salt: SWITCHBOARD_SALT });
  if (!res.ok || !res.deployedAddress) {
    saveState({ sa, deployed: false }); // persist the predicted address for display pre-deploy
    throw new Error(res.error ?? 'Switchboard org deploy failed');
  }
  const state: DeployState = { sa: res.deployedAddress, deployed: true };
  saveState(state);
  return state;
}

/** The Switchboard (Jane) broker-vault owner for spec-247 reads/writes — deploys on first use. */
export async function switchboardVaultOwner(): Promise<VaultOwner> {
  const { sa } = await ensureSwitchboardDeployed();
  return { owner: sa, custodian: JANE_CUSTODIAN };
}

/** The predicted Switchboard SA address (no deploy) — for display. */
export async function predictSwitchboardSa(): Promise<Address> {
  const cached = loadState();
  if (cached?.sa) return cached.sa;
  const sa = await deriveOrgSaAddress(JANE_CUSTODIAN.address, SWITCHBOARD_SALT);
  saveState({ sa, deployed: false });
  return sa;
}
