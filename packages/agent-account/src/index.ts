// @agenticprimitives/agent-account — public API
//
// See ../../specs/201-agent-account.md for the full contract.

export { AgentAccountClient, SaMismatchError } from './client';
export type { AgentAccountClientOpts, AgentAccountSpec } from './client';
export type { UserOperation, Address, Hex } from './types';
export { buildExecuteCallData, buildExecuteBatchCallData, type ContractCall } from './execute';
// Spec 272 PAY-ACCT-1/2 — x402 treasury + payer ERC-20 helpers.
export { buildErc20TransferCall, readErc20Balance } from './erc20';
export { BundlerClient, packGasLimits, unpackGasLimits } from './bundler-client';
export type { BundlerClientOpts, PackedUserOperation } from './bundler-client';
export {
  agentAccountAbi,
  agentAccountFactoryAbi,
  approvedHashRegistryAbi,
  entryPointAbi,
} from './abis';
// custodyPolicyAbi moved to @agenticprimitives/account-custody (spec 213 § 2.6).

// Spec 207 threshold-policy + quorum utilities (6c.3-c).
export {
  packSafeSignatures,
  computeAdminPayloadHash,
  ADMIN_VERB_PROPOSE,
  ADMIN_VERB_EXECUTE,
  ADMIN_VERB_CANCEL,
} from './quorum';
export type { SafeSignatureSlot } from './quorum';

// WebAuthn on-chain signature wire format (spec 130).
// The structured `WebAuthnAssertion` struct + WebAuthn ceremony live in
// the connect-auth package — agent-account only ships the on-chain
// encoder that turns the assertion into the byte layout
// `AgentAccount._validateSig` consumes.
export {
  SIG_TYPE_WEBAUTHN,
  encodeAssertion,
  encodeWebAuthnSignature,
} from './webauthn-signature';
