// Spec 272 PAY-RAIL-4/5 — the off-chain nullifier reservation store. A redeemed mandate/nonce cannot
// settle twice (the on-chain nonce is the durable guard; this blocks concurrent duplicates + caches the
// original receipt for safe retries). State machine: unseen → reserved → settling → settled |
// failed_retryable | failed_terminal.

import type { Hex32 } from './resource.js';

export type NonceState = 'unseen' | 'reserved' | 'settling' | 'settled' | 'failed_retryable' | 'failed_terminal';

export interface SettledReceipt {
  settlementHash: Hex32;
  mandateId: Hex32;
}

export type ReserveResult =
  | { ok: true }
  | { ok: false; state: Exclude<NonceState, 'unseen'>; receipt?: SettledReceipt };

export interface NonceReservationStore {
  /** Atomically claim the nullifier. `unseen`/`failed_retryable` → reserved (ok). `settled` → not-ok
   *  WITH the original receipt (safe-retry returns it). `reserved`/`settling`/`failed_terminal` →
   *  not-ok (concurrent duplicate / permanently failed). */
  reserve(nullifier: Hex32): Promise<ReserveResult>;
  markSettling(nullifier: Hex32): Promise<void>;
  markSettled(nullifier: Hex32, receipt: SettledReceipt): Promise<void>;
  markFailed(nullifier: Hex32, retryable: boolean): Promise<void>;
  get(nullifier: Hex32): Promise<{ state: NonceState; receipt?: SettledReceipt } | undefined>;
}

interface Row {
  state: NonceState;
  receipt?: SettledReceipt;
}

/** In-memory store (single-worker / tests). A durable adapter (KV / D1) implements the same interface;
 *  the reserve() must be ATOMIC there (compare-and-set) to actually block concurrent duplicates. */
export function createMemoryNonceStore(): NonceReservationStore {
  const rows = new Map<string, Row>();
  return {
    async reserve(nullifier) {
      const row = rows.get(nullifier);
      if (!row || row.state === 'unseen' || row.state === 'failed_retryable') {
        rows.set(nullifier, { state: 'reserved' });
        return { ok: true };
      }
      if (row.state === 'settled') return { ok: false, state: 'settled', receipt: row.receipt };
      return { ok: false, state: row.state };
    },
    async markSettling(nullifier) {
      const row = rows.get(nullifier) ?? { state: 'unseen' };
      rows.set(nullifier, { ...row, state: 'settling' });
    },
    async markSettled(nullifier, receipt) {
      rows.set(nullifier, { state: 'settled', receipt });
    },
    async markFailed(nullifier, retryable) {
      rows.set(nullifier, { state: retryable ? 'failed_retryable' : 'failed_terminal' });
    },
    async get(nullifier) {
      return rows.get(nullifier);
    },
  };
}
