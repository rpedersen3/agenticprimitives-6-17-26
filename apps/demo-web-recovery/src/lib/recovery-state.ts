/**
 * Recovery-specific localStorage state — Sam's lost-credential marker,
 * replacement-credential reference, the in-flight RecoverAccount changeId.
 *
 * A "credential" is passkey OR EOA (SIWE) — the recovery demo works with
 * either kind. Seat enrolment (Alice/Bob/Sam) lives in seats.ts +
 * passkey.ts; this file owns just the recovery flow's bookkeeping.
 */

import type { Address, Hex } from 'viem';

const STORAGE_KEY = 'agenticprimitives:demo-web-recovery:flow-state';

/** A control credential that can be lost + replaced. */
export type RecoveryCredential =
  | {
      kind: 'passkey';
      credentialIdDigest: Hex;
      /** Passkey identity address (PIA). */
      pia: Address;
      pubKeyX: string; // bigint-as-decimal
      pubKeyY: string;
    }
  | {
      kind: 'eoa';
      /** The EOA owner address. */
      address: Address;
    };

export interface RecoveryFlowState {
  /** Sam's ORIGINAL credential (the lost one). */
  lostCredential?: RecoveryCredential;
  /** ISO timestamp Sam declared his original credential lost. */
  declaredLostAt?: string;
  /** Sam's REPLACEMENT credential. */
  replacementCredential?: RecoveryCredential;
  /** Recovery schedule txHash (Act 4 schedule). */
  scheduleTx?: Hex;
  /** Recovery apply txHash (Act 4 apply). */
  applyTx?: Hex;
  /** CustodyPolicy changeId of the in-flight RecoverAccount. */
  recoveryChangeId?: string;          // bigint-as-decimal
  /** ISO timestamp the recovery applied (Sam regained access). */
  recoveredAt?: string;
}

/** Short label for a credential, for UI. */
export function credentialLabel(cred: RecoveryCredential | undefined): string {
  if (!cred) return '(none)';
  if (cred.kind === 'eoa') return `wallet ${cred.address.slice(0, 6)}…${cred.address.slice(-4)}`;
  return `passkey ${cred.pia.slice(0, 6)}…${cred.pia.slice(-4)}`;
}

/** The on-chain identity a credential resolves to (PIA or EOA). */
export function credentialIdentity(cred: RecoveryCredential): Address {
  return cred.kind === 'eoa' ? cred.address : cred.pia;
}

export function loadRecoveryState(): RecoveryFlowState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as RecoveryFlowState;
  } catch {
    return {};
  }
}

export function saveRecoveryState(patch: Partial<RecoveryFlowState>): void {
  const current = loadRecoveryState();
  const next = { ...current, ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event('recovery-state:update'));
}

export function clearRecoveryState(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event('recovery-state:update'));
}
