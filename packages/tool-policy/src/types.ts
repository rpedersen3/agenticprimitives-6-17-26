import type { Address, Hex } from '@agenticprimitives/types';

export type { Address, Hex };

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface ToolClassification {
  '@sa-tool': 'delegation-verified' | 'service-only' | 'bootstrap' | 'dev-only';
  '@sa-auth': 'session-token' | 'service-hmac' | 'none' | 'none-with-csrf';
  '@sa-validation'?: 'shape-check' | 'json-schema' | 'none-no-body' | 'none-path-params' | 'wallet-action-canonical';
  '@sa-risk-tier'?: RiskTier;
  '@sa-owner'?: string;
  '@sa-rate-limit'?: string;
  '@sa-prod-gate'?: 'enabled' | 'disabled';
}

export interface ExactCallPolicy {
  target: Address;
  selector: Hex;
  calldataHash?: Hex;
  valueLimit?: bigint;
}

// Forward-decl types so this package doesn't depend on @agenticprimitives/delegation at runtime.
export interface CaveatLike {
  enforcer: Address;
  terms: Hex;
}

export interface DelegationLike {
  delegator: Address;
  delegate: Address;
  caveats: CaveatLike[];
}

export interface CaveatContext {
  timestamp: number;
  mcpTool?: string;
  target?: Address;
  selector?: Hex;
  value?: bigint;
  principal?: Address;
}

export interface PolicyContext {
  toolName: string;
  classification: ToolClassification;
  delegation?: DelegationLike;
  caveatContext?: CaveatContext;
  callerKind: 'user-session' | 'agent-session' | 'service';
  callDetails?: { to: Address; data: Hex; value: bigint };
}

export type PolicyDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'requires-consent'; promptId: string; risk: RiskTier };

export interface LintResult {
  passed: boolean;
  errors: Array<{ file: string; line: number; missing: string[] }>;
}

// ─── Spec 207 threshold-policy tiers ──────────────────────────────────
//
// Coexists with the string `RiskTier` above. `RiskTier` is a *tool
// classification* concept (how risky is this tool?); `ThresholdTier` is
// the *delegation-time gating* tier from spec 207 § 5 (what kind of
// authorization does this tier demand?). The two map cleanly via
// `RISK_TIER_REQUIREMENTS` below, but they serve different layers and
// stay distinct in the type system.

export enum ThresholdTier {
  Read = 1,      // T1 — view-shape MCP delegation, no on-chain mutation
  Write = 2,     // T2 — mutates state but no value transfer above T3 ceiling
  Value = 3,     // T3 — token / native value transfer; requires quorum + (high-value) on-chain blessing
  Admin = 4,     // T4 — owner / passkey / guardian / mode mutation; account-level (not exposed by evaluateThresholdPolicy)
  Critical = 5,  // T5 — impl upgrade / DM change / paymaster change; account-level + timelock
  Recovery = 6,  // T6 — multi-passkey + guardian recovery flow; account-level
}

/**
 * Decision returned by `evaluateThresholdPolicy(classification)` —
 * the shape mcp-runtime's withDelegation threads into
 * `verifyDelegationToken` so the verify path knows what to enforce.
 *
 * - `tier`: which spec 207 § 5 tier the tool falls into. T1-T3 only;
 *   T4-T6 are account-level admin tiers, not tool-call tiers.
 * - `requiresQuorum`: the delegation MUST carry a QuorumEnforcer caveat.
 *   True for T3+ (per spec § 5 multisig/org rows).
 * - `requiresUv`: at least one signer must have presented a passkey UV
 *   (user-verification) flag. True for T2+ (per spec § 5 hybrid rows).
 * - `requiresAcceptedOnChain`: the account must have called
 *   `acceptSessionDelegation(hash)` for this delegation. True for the
 *   high-value T3 path (per spec § 6 + § 5 critical-risk-tier).
 */
export interface ThresholdPolicyDecision {
  tier: ThresholdTier;
  requiresQuorum: boolean;
  requiresUv: boolean;
  requiresAcceptedOnChain: boolean;
}
