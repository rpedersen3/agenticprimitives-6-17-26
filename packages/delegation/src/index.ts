// @agenticprimitives/delegation — public API
//
// See ../../specs/202-delegation.md for the full contract.

export { ROOT_AUTHORITY } from './types';

export {
  buildCaveat,
  buildMcpToolScopeCaveat,
  buildDataScopeCaveat,
  buildDelegateBindingCaveat,
  buildQuorumCaveat,
  encodeTimestampTerms,
  encodeValueTerms,
  encodeAllowedTargetsTerms,
  encodeAllowedMethodsTerms,
  encodeCallDataHashTerms,
  MCP_TOOL_SCOPE_ENFORCER,
  DATA_SCOPE_ENFORCER,
  DELEGATE_BINDING_ENFORCER,
  PAYMENT_TRANSFER_SELECTOR,
  encodePaymentTerms,
  buildPaymentMandateCaveats,
  describePaymentMandate,
} from './caveats';
export type { QuorumCaveatOpts, PaymentMandateCaveatOpts, PaymentMandateConsent } from './caveats';

export { hashDelegation, hashCaveats, DELEGATION_EIP712_TYPES, delegationDomain } from './hash';
// DEL-001 session-delegation leaf builder (spec 270 v4 W2) — every connect flow uses this.
export { buildSessionDelegation } from './session-delegation';
export type { SessionDelegationParams } from './session-delegation';
export { evaluateCaveats } from './evaluator';
export { DelegationClient } from './client';
export { SessionManager, createMemorySessionStore } from './session-manager';

/**
 * Spec 242 PD-9 — SDK helper for the `verifyAuthorization(...)` view entrypoint
 * on DelegationManager.sol. View-only verification of a delegation chain.
 * Consumed by `@agenticprimitives/attestations` for the bilateral-consent path.
 */
export { verifyAuthorization } from './verify-authorization';
export type { VerifyAuthorizationResult } from './verify-authorization';

// H7-B.8: `verifyCrossDelegation` removed from the public surface (XPKG-002 /
// EXT-024 closure). The stub unconditionally returned a "not implemented"
// error string — a public symbol that lies about runtime capability. When the
// work resumes it lands behind `./experimental` per spec 100 §6.
export { mintDelegationToken, verifyDelegationToken, sessionDelegateBindingError } from './token';
export { isRevoked, buildRevokeDelegationCall } from './onchain';

export type {
  Address,
  Hex,
  Caveat,
  CaveatContext,
  CaveatVerdict,
  Delegation,
  DataScopeGrant,
  DelegationClientOpts,
  DelegationTokenClaims,
  EnforcerAddressMap,
  EvaluateOpts,
  JtiStore,
  SessionMeta,
  SessionPackage,
  SessionRow,
  SessionStore,
  TxContext,
  VerifyError,
  VerifyOpts,
} from './types';

// Wave H3 — full verifier opts (quorum proof + tier gates). Exported
// for consumers that need the extended shape (mcp-runtime); the
// minimal `VerifyOpts` above stays for external callers.
export type { VerifyOptsExt } from './token';
