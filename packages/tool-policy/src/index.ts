// @agenticprimitives/tool-policy — public API
//
// See ../../specs/204-tool-policy.md for the full contract.
//
// CRITICAL: This package is protocol-agnostic. It MUST NOT import from any
// transport SDK (see capability.manifest.json:forbiddenImports for the full
// list and docs/architecture/decisions/0003-tool-policy-protocol-agnostic.md
// for why).

export { declareTool } from './classification';
export { exactCall, matchesExactCall } from './exact-call';
export { evaluatePolicy } from './decision';
export {
  clampTtlForRiskTier,
  requiredCaveatsForRiskTier,
  evaluateThresholdPolicy,
  RISK_TIER_REQUIREMENTS,
} from './risk-tier';
export { lintClassification } from './lint';
// ThresholdTier is an enum (value export, not type-only).
export { ThresholdTier } from './types';

export type {
  Address,
  Hex,
  RiskTier,
  ToolClassification,
  ExactCallPolicy,
  CaveatLike,
  DelegationLike,
  CaveatContext,
  PolicyContext,
  PolicyDecision,
  ThresholdPolicyDecision,
  LintResult,
} from './types';
