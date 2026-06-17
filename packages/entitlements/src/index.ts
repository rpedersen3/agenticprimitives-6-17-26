// @agenticprimitives/entitlements — durable resource/action/field/purpose/
// classification authorization over VC-compatible credentials (spec 277 §10).
//
// This release: the matching engine + in-memory resolver (the enforcement core
// the vault/MCP runtime calls before decrypting fields). VC proof verification,
// status-list revocation, presentations, and storage caches (issue/verify/
// BitstringStatus/D1 cache per spec §10) are a later sub-wave layered on top.

export const PACKAGE_NAME = '@agenticprimitives/entitlements';
export const PACKAGE_STATUS = 'w1-matching' as const;
export const SPEC_REF = 'specs/277-mcp-delegated-vault-authorization.md';

export {
  type EntitlementAction,
  type EntitlementClassification,
  type EntitlementConstraints,
  type AgenticEntitlementCredentialV1,
  type EntitlementQuery,
  type EntitlementReason,
  type EntitlementDecision,
  type EntitlementResolver,
  CLASSIFICATION_ORDER,
} from './types.js';

export {
  type SingleMatch,
  matchesEntitlement,
  resolveEntitlements,
  InMemoryEntitlementResolver,
} from './match.js';
