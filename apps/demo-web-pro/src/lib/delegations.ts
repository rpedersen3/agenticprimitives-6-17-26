/**
 * Generic delegation storage — Act 5 issues several kinds of off-chain
 * Variant A delegations (Person → Person for PII access; Org → Person
 * for sensitive-data access; Treasury → Person for spend). Each one is
 * a fully signed envelope verifiable via ERC-1271 on the delegator
 * smart account. Stored together so Act 6 / future flows can look them
 * up by `kind` + `delegate`.
 *
 * Storage is localStorage-only; replicates the Variant A "off-chain
 * artifact" pattern from spec 202 / DelegationManager.
 */

import type { Delegation } from '@agenticprimitives/delegation';
import type { Address, Hex } from 'viem';

const STORAGE_KEY = 'agenticprimitives:demo-web-pro:delegations';

/** Categorises stored delegations so the dashboard can fan-out into rows. */
export type DelegationKind =
  | 'pii-read'         // Alice.PSA / Bob.PSA → other PSA: read PII
  | 'org-sensitive'    // Org → Person.PSA: read sensitive Org data
  | 'treasury-spend'   // Treasury → Person.PSA: spend (legacy from Act 5 v1)
  | 'usdc-quorum';     // Treasury → Person.PSA, QuorumCaveat-gated: USDC

export interface StoredDelegation {
  kind: DelegationKind;
  /** Person.PSA / Org / Treasury that signed the delegation. */
  delegator: Address;
  /** Label for the dashboard ("Acme Construction", "Alice's PSA", …). */
  delegatorLabel: string;
  /** Recipient agent. */
  delegate: Address;
  /** Label for the dashboard. */
  delegateLabel: string;
  /** Full signed envelope. */
  delegation: Delegation;
  /** Pre-computed EIP-712 hash (display + audit trail). */
  delegationHash: Hex;
  /** ISO timestamp when minted. */
  issuedAt: string;
  /** Human-readable description for permission cards. */
  summary: {
    actions: string[];
    limits: string[];
    notPermitted: string[];
    expiry: string;
  };
}

type Store = Record<string, StoredDelegation>;

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

function storeKey(d: { kind: DelegationKind; delegator: Address; delegate: Address }): string {
  return `${d.kind}|${d.delegator.toLowerCase()}|${d.delegate.toLowerCase()}`;
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return reviveBigInts(JSON.parse(raw)) as Store;
  } catch {
    return {};
  }
}

function writeStore(s: Store): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeBigInts(s)));
  window.dispatchEvent(new Event('delegations:update'));
}

export function loadAllDelegations(): StoredDelegation[] {
  return Object.values(readStore());
}

export function loadDelegationsByKind(kind: DelegationKind): StoredDelegation[] {
  return loadAllDelegations().filter((d) => d.kind === kind);
}

export function findDelegation(args: {
  kind: DelegationKind;
  delegator?: Address;
  delegate?: Address;
}): StoredDelegation | undefined {
  return loadAllDelegations().find(
    (d) =>
      d.kind === args.kind &&
      (!args.delegator || d.delegator.toLowerCase() === args.delegator.toLowerCase()) &&
      (!args.delegate || d.delegate.toLowerCase() === args.delegate.toLowerCase()),
  );
}

export function saveDelegation(d: StoredDelegation): void {
  const s = readStore();
  s[storeKey(d)] = d;
  writeStore(s);
}

export function clearDelegations(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event('delegations:update'));
}

export function subscribeDelegations(listener: () => void): () => void {
  window.addEventListener('delegations:update', listener);
  return () => window.removeEventListener('delegations:update', listener);
}
