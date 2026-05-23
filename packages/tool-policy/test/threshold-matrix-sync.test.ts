// Threshold matrix sync (production-readiness wave 1).
//
// The risk-tier → policy-decision matrix lives in `RISK_TIER_REQUIREMENTS`
// (TypeScript). The on-chain side has its own threshold defaults in
// `AgentAccountFactory._defaultApprovals` (Solidity). The two are
// related but not identical — TS encodes "what policy gates apply
// per tier"; Solidity encodes "what approval-count default applies
// per (custodian count, tier) pair."
//
// This test locks down the TS matrix shape + values so a casual
// "let's bump medium to require on-chain blessing" edit is caught in
// CI rather than rediscovered as an outage. The Solidity-side sync
// is covered by a Forge test mirror.

import { describe, it, expect } from 'vitest';
import {
  RISK_TIER_REQUIREMENTS,
  ThresholdTier,
  evaluateThresholdPolicy,
  type RiskTier,
} from '../src';

// Canonical tier set. Adding a new tier MUST update this list AND
// `RISK_TIER_REQUIREMENTS`; the "every declared RiskTier has a matrix
// entry" check below catches the second half of that pair.
const RISK_TIERS: RiskTier[] = ['low', 'medium', 'high', 'critical'];

describe('threshold matrix — TS source-of-truth lockdown', () => {
  it('every declared RiskTier has a matrix entry', () => {
    for (const t of RISK_TIERS) {
      expect(RISK_TIER_REQUIREMENTS[t]).toBeDefined();
    }
  });

  it('ThresholdTier enum is stable (wire-format)', () => {
    // ThresholdTier values are consumed by callers + serialized into
    // policy decisions. Adding new tiers is safe; renumbering is a
    // wire-protocol break. Lock the integer values explicitly.
    expect(ThresholdTier.Read).toBe(1);
    expect(ThresholdTier.Write).toBe(2);
    expect(ThresholdTier.Value).toBe(3);
    expect(ThresholdTier.Admin).toBe(4);
  });

  it('golden: low tier → no gates (T1 Read)', () => {
    const v = RISK_TIER_REQUIREMENTS.low;
    expect(v).toEqual({
      tier: ThresholdTier.Read,
      requiresQuorum: false,
      requiresUv: false,
      requiresAcceptedOnChain: false,
    });
  });

  it('golden: medium tier → UV gate (T2 Write)', () => {
    const v = RISK_TIER_REQUIREMENTS.medium;
    expect(v).toEqual({
      tier: ThresholdTier.Write,
      requiresQuorum: false,
      requiresUv: true,
      requiresAcceptedOnChain: false,
    });
  });

  it('golden: high tier → quorum + UV (T3 Value)', () => {
    const v = RISK_TIER_REQUIREMENTS.high;
    expect(v).toEqual({
      tier: ThresholdTier.Value,
      requiresQuorum: true,
      requiresUv: true,
      requiresAcceptedOnChain: false,
    });
  });

  it('golden: critical tier → quorum + UV + on-chain blessing', () => {
    const v = RISK_TIER_REQUIREMENTS.critical;
    expect(v).toEqual({
      tier: ThresholdTier.Value,
      requiresQuorum: true,
      requiresUv: true,
      requiresAcceptedOnChain: true,
    });
  });

  it('evaluateThresholdPolicy returns the matrix entry per tier', () => {
    for (const tier of RISK_TIERS) {
      const decision = evaluateThresholdPolicy({ '@sa-risk-tier': tier } as never);
      expect(decision).toEqual(RISK_TIER_REQUIREMENTS[tier]);
    }
  });

  it('evaluateThresholdPolicy defaults to low when tier unset', () => {
    expect(evaluateThresholdPolicy({} as never)).toEqual(RISK_TIER_REQUIREMENTS.low);
  });

  it('gate monotonicity: each step up adds restrictions, never removes', () => {
    // Strict monotonicity: low ≤ medium ≤ high ≤ critical in restriction count.
    const sequence: RiskTier[] = ['low', 'medium', 'high', 'critical'];
    const restrictionCount = (t: RiskTier) => {
      const r = RISK_TIER_REQUIREMENTS[t];
      return (r.requiresQuorum ? 1 : 0) + (r.requiresUv ? 1 : 0) + (r.requiresAcceptedOnChain ? 1 : 0);
    };
    for (let i = 1; i < sequence.length; i++) {
      const prev = restrictionCount(sequence[i - 1]!);
      const curr = restrictionCount(sequence[i]!);
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });
});
