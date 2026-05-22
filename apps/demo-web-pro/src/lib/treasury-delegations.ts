/**
 * Treasury-issued delegations (Act 5 output).
 *
 * Spec 211 § Act 5: Treasury (signed by its custodian quorum) issues
 * delegations to each Person Smart Agent. Per spec 212, the delegation
 * is between agents — never directly between humans. The signature
 * lives in localStorage for the demo; runtime enforcement against the
 * DelegationManager + enforcers is 🟡 SIMULATED for phase 6f.5 — the
 * object construction, hashing, and signing are all LIVE.
 */

import type { Delegation } from '@agenticprimitives/delegation';
import type { Address, Hex } from 'viem';

const STORAGE_KEY = 'agenticprimitives:demo-web-pro:treasury-delegations';

export interface StoredTreasuryDelegation {
  /** The Person Smart Agent the delegation is granted to. */
  delegate: Address;
  /** Human label for the dashboard card. */
  delegateLabel: string;
  /** Full Delegation envelope (delegator = Treasury). */
  delegation: Delegation;
  /** Pre-computed EIP-712 delegation hash, for display. */
  delegationHash: Hex;
  /** Issuing tx hash (zero-filled when no on-chain submit happened). */
  txHash?: Hex;
  /** ISO timestamp when issued. */
  issuedAt: string;
  /** Plain-language summary of the caveats, rendered into permission cards. */
  summary: {
    actions: string[];
    limits: string[];
    notPermitted: string[];
    expiry: string;
  };
}

type Store = Record<string, StoredTreasuryDelegation>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeBigInts(v: any): any {
  if (typeof v === 'bigint') return { __bigint: v.toString() };
  if (Array.isArray(v)) return v.map(serializeBigInts);
  if (v && typeof v === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any = {};
    for (const k of Object.keys(v)) out[k] = serializeBigInts(v[k]);
    return out;
  }
  return v;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reviveBigInts(v: any): any {
  if (v && typeof v === 'object') {
    if (typeof v.__bigint === 'string' && Object.keys(v).length === 1) {
      return BigInt(v.__bigint);
    }
    if (Array.isArray(v)) return v.map(reviveBigInts);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any = {};
    for (const k of Object.keys(v)) out[k] = reviveBigInts(v[k]);
    return out;
  }
  return v;
}

export function loadTreasuryDelegations(): StoredTreasuryDelegation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const record = reviveBigInts(parsed) as Store;
    return Object.values(record);
  } catch {
    return [];
  }
}

export function saveTreasuryDelegation(d: StoredTreasuryDelegation): void {
  let record: Store = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) record = reviveBigInts(JSON.parse(raw)) as Store;
  } catch { /* tolerate */ }
  record[d.delegate.toLowerCase()] = d;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeBigInts(record)));
  window.dispatchEvent(new Event('treasury-delegations:update'));
}

export function clearTreasuryDelegations(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event('treasury-delegations:update'));
}

export function subscribeTreasuryDelegations(listener: () => void): () => void {
  window.addEventListener('treasury-delegations:update', listener);
  return () => window.removeEventListener('treasury-delegations:update', listener);
}
