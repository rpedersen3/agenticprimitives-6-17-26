// Custody-layer domain types. Mirrors the ontology in
// docs/ontology/ap-custody.ttl (spec 213 § 2.5). These are pure data
// shapes — no chain access.

import type { Address } from 'viem';

/**
 * A Custodian is a Smart Agent (typically a Person Smart Agent) that
 * holds custody authority over another Smart Agent. Member of a
 * CustodyCouncil. Authorizes scheduled custody changes via m-of-n
 * approvals.
 */
export interface Custodian {
  address: Address;
  /** Optional label for UI ("Alice", "Bob's iPhone passkey"). */
  label?: string;
}

/**
 * A Trustee is a Smart Agent that holds recovery authority. Distinct
 * from Custodian — trustees only act when the routine custody set is
 * unavailable (lost passkeys, compromised custodians). T6 recovery
 * quorum.
 */
export interface Trustee {
  address: Address;
  label?: string;
}

/**
 * The set of Custodians for a given Smart Agent + the per-tier
 * approvals-required count + per-tier safety-delay seconds.
 */
export interface CustodyCouncil {
  custodians: Custodian[];
  approvalsRequiredByTier: Record<1 | 2 | 3 | 4 | 5 | 6, number>;
  safetyDelayByTierSeconds: Record<1 | 2 | 3 | 4 | 5 | 6, number>;
}

/**
 * A queued custody change awaiting its safety delay + approvals. The
 * on-chain record is keyed by (account, changeId). The off-chain mirror
 * is what the UI shows on the "pending changes" tab.
 */
export interface ScheduledChange {
  account: Address;
  changeId: bigint;
  action: number;
  args: `0x${string}`;
  proposedAtUnix: number;
  etaUnix: number;
  proposer: Address;
  executed: boolean;
  cancelled: boolean;
}

/** Custody policy posture for an account. */
export type CustodyMode = 'single' | 'hybrid' | 'threshold' | 'org';

export const CUSTODY_MODE_BY_INDEX: Record<0 | 1 | 2 | 3, CustodyMode> = {
  0: 'single',
  1: 'hybrid',
  2: 'threshold',
  3: 'org',
};

/**
 * Tier ids used across the custody surface. Mirrors spec 207 § 5.
 *
 *   T1 Read    — view methods, never gated
 *   T2 Write   — low-value mutating calls (data updates)
 *   T3 Value   — value transfers below the high-value ceiling
 *   T4 Admin   — most custody changes (Add/Remove Custodian, Add/Remove
 *                Trustee, ChangeCustodyMode)
 *   T5 Critical — system updates (ApplySystemUpdate, Rotate*Manager)
 *   T6 Recovery — RecoverAccount, gated by trustees, longer safety delay
 */
export type RiskTier = 1 | 2 | 3 | 4 | 5 | 6;
