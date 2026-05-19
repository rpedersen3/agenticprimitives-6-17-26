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
