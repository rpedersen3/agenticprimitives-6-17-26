// Risk-tier helpers. The taxonomy is the binding contract — these helpers
// surface "what should issuance demand for this tier."

import type {
  RiskTier,
  ToolClassification,
  ThresholdPolicyDecision,
} from './types';
import { ThresholdTier } from './types';

const TTL_CLAMP_SECONDS: Record<RiskTier, number> = {
  low: 7 * 24 * 60 * 60,        // 7 days
  medium: 7 * 24 * 60 * 60,     // 7 days
  high: 24 * 60 * 60,           // 1 day
  critical: 60 * 60,            // 1 hour
};

const REQUIRED_CAVEATS: Record<RiskTier, string[]> = {
  low: ['timestamp'],
  medium: ['timestamp', 'mcp-tool-scope'],
  high: ['timestamp', 'mcp-tool-scope', 'value', 'data-scope'],
  critical: ['timestamp', 'exact-call'],
};

export function clampTtlForRiskTier(requestedTtlSec: number, risk: RiskTier): number {
  if (!Number.isFinite(requestedTtlSec) || requestedTtlSec <= 0) {
    throw new Error('clampTtlForRiskTier: requestedTtlSec must be a positive number');
  }
  const max = TTL_CLAMP_SECONDS[risk];
  return Math.min(requestedTtlSec, max);
}

export function requiredCaveatsForRiskTier(risk: RiskTier): string[] {
  return [...REQUIRED_CAVEATS[risk]];
}

// ─── Spec 207 threshold-policy mapping ────────────────────────────────
//
// `@sa-risk-tier` (string) → `ThresholdPolicyDecision` (the shape
// `mcp-runtime.withDelegation` consumes when gating delegation
// verification). T1-T3 are tool-call tiers (the only tiers
// `evaluateThresholdPolicy` returns); T4-T6 are account-level admin
// tiers and live entirely in `agent-account`.
//
// V0 calibration:
//   - low → T1 Read: 1-of-N, no UV gate, no on-chain blessing.
//   - medium → T2 Write: 1-of-N + passkey UV (hybrid mode).
//   - high → T3 Value: quorum caveat required + passkey UV.
//   - critical → T3 Value + on-chain `acceptSessionDelegation` blessing.
//
// Future refinements: argument-level caveats (spec 208) will let
// individual tool arguments shift the tier (e.g. `target` in a known
// allowlist drops the on-chain blessing requirement). Until then this
// flat mapping is the single source of truth.

export const RISK_TIER_REQUIREMENTS: Record<RiskTier, ThresholdPolicyDecision> = {
  low: {
    tier: ThresholdTier.Read,
    requiresQuorum: false,
    requiresUv: false,
    requiresAcceptedOnChain: false,
  },
  medium: {
    tier: ThresholdTier.Write,
    requiresQuorum: false,
    requiresUv: true,
    requiresAcceptedOnChain: false,
  },
  high: {
    tier: ThresholdTier.Value,
    requiresQuorum: true,
    requiresUv: true,
    requiresAcceptedOnChain: false,
  },
  critical: {
    tier: ThresholdTier.Value,
    requiresQuorum: true,
    requiresUv: true,
    requiresAcceptedOnChain: true,
  },
};

/**
 * Map a tool classification to the spec-207 threshold-policy decision.
 *
 * Defaults to `low` (T1 Read) when `@sa-risk-tier` is unset, matching
 * the existing `evaluatePolicy` permissive default for unclassified
 * tools. Callers should run `lintClassification` to catch unset risk
 * tiers as a separate concern; this function intentionally doesn't
 * fail closed on missing classification (that's `evaluatePolicy`'s
 * job).
 */
export function evaluateThresholdPolicy(
  classification: ToolClassification,
): ThresholdPolicyDecision {
  const risk = classification['@sa-risk-tier'] ?? 'low';
  return RISK_TIER_REQUIREMENTS[risk];
}
