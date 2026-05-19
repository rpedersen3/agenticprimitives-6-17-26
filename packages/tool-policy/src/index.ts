// @agenticprimitives/tool-policy — public API
//
// See ../../specs/204-tool-policy.md for the full contract.
//
// CRITICAL: This package is protocol-agnostic. It MUST NOT import from any
// transport SDK (see capability.manifest.json:forbiddenImports for the full
// list and docs/architecture/decisions/0003-tool-policy-protocol-agnostic.md
// for why).

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
  selector: Hex;            // 4 bytes
  calldataHash?: Hex;       // 32 bytes; if set, calldata must match exactly
  valueLimit?: bigint;
}

// Caveat-shape forward-decl so this package doesn't depend on @agenticprimitives/delegation at runtime.
// Consumers pass these in as opaque values — we only inspect known shapes.
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

// Taxonomy
export declare function declareTool<T>(def: T, classification: ToolClassification): T & { _classification: ToolClassification };

// Exact-call DSL
export declare function exactCall(target: Address, selector: Hex, opts?: { calldataHash?: Hex; valueLimit?: bigint }): ExactCallPolicy;
export declare function matchesExactCall(call: { to: Address; data: Hex; value: bigint }, policy: ExactCallPolicy): boolean;

// Decision engine
export declare function evaluatePolicy(ctx: PolicyContext): PolicyDecision;

// Risk-tier helpers
export declare function clampTtlForRiskTier(requestedTtlSec: number, risk: RiskTier): number;
export declare function requiredCaveatsForRiskTier(risk: RiskTier): string[];

// Lint (also available at @agenticprimitives/tool-policy/lint)
export interface LintResult {
  passed: boolean;
  errors: Array<{ file: string; line: number; missing: string[] }>;
}

export declare function lintClassification(opts: {
  srcDir: string;
  requiredTags: string[];
  optionalTags?: string[];
  tagBlockPattern?: RegExp;
}): Promise<LintResult>;
