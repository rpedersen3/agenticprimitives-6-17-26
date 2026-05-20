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
  MCP_TOOL_SCOPE_ENFORCER,
  DATA_SCOPE_ENFORCER,
  DELEGATE_BINDING_ENFORCER,
} from './caveats';
export type { QuorumCaveatOpts } from './caveats';

export { hashDelegation, hashCaveats, DELEGATION_EIP712_TYPES, delegationDomain } from './hash';
export { evaluateCaveats } from './evaluator';
export { DelegationClient } from './client';
export { SessionManager, createMemorySessionStore } from './session-manager';

export { mintDelegationToken, verifyDelegationToken, verifyCrossDelegation } from './token';
export { isRevoked, revokeDelegation } from './onchain';

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
  JtiStore,
  SessionMeta,
  SessionPackage,
  SessionRow,
  SessionStore,
  TxContext,
  VerifyError,
  VerifyOpts,
} from './types';
