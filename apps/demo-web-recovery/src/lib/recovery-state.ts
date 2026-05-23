/**
 * Recovery-specific localStorage state — Sam's lost-passkey marker,
 * replacement passkey reference, the in-flight RecoverAccount changeId.
 *
 * Seat state (Alice/Bob/Sam credential enrolment) lives in seats.ts +
 * passkey.ts. This file owns just the recovery flow's bookkeeping.
 */

import type { Address, Hex } from 'viem';

const STORAGE_KEY = 'agenticprimitives:demo-web-recovery:flow-state';

export interface RecoveryFlowState {
  /** keccak256(credentialId) of Sam's ORIGINAL passkey (the lost one). */
  lostCredentialIdDigest?: Hex;
  /** ISO timestamp Sam declared his original passkey lost. */
  declaredLostAt?: string;
  /** keccak256(credentialId) of Sam's REPLACEMENT passkey. */
  replacementCredentialIdDigest?: Hex;
  /** Replacement passkey's PIA — derived once at registration time. */
  replacementPia?: Address;
  /** Replacement passkey's P-256 pubkey. */
  replacementPubKeyX?: string;        // bigint-as-decimal
  replacementPubKeyY?: string;
  /** Recovery schedule txHash (Act 4 schedule). */
  scheduleTx?: Hex;
  /** Recovery apply txHash (Act 4 apply). */
  applyTx?: Hex;
  /** CustodyPolicy changeId of the in-flight RecoverAccount. */
  recoveryChangeId?: string;          // bigint-as-decimal
  /** ISO timestamp the recovery applied (Sam regained access). */
  recoveredAt?: string;
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
