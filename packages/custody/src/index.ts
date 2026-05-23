// @agenticprimitives/custody — custody-layer SDK
//
// Public surface for the CustodyPolicy ERC-7579 module. Hosts the ABI,
// CustodyAction enum + arg builders, EIP-712 typed-data shapes, and
// custody-domain types (Custodian, Trustee, CustodyCouncil, ScheduledChange).
//
// Scope discipline: this package speaks custody-domain vocabulary only.
// Delegation / Steward / Caveat concepts belong in @agenticprimitives/delegation.
// See spec 212 § 2.2 + spec 213 for the vocabulary firewall.

export { custodyPolicyAbi } from './abi.js';

export {
  CustodyAction,
  buildAddCustodianArgs,
  buildRemoveCustodianArgs,
  buildAddTrusteeArgs,
  buildRemoveTrusteeArgs,
  buildChangeCustodyModeArgs,
  buildChangeValueCeilingArgs,
  buildSetRecoveryApprovalsArgs,
  buildApplySystemUpdateArgs,
  buildChangeApprovalsRequiredArgs,
  buildAddPasskeyCredentialArgs,
  buildRemovePasskeyCredentialArgs,
  buildRotateAllCustodiansArgs,
  buildRecoverAccountArgs,
  type RecoveryPasskeyAdd,
} from './actions.js';

export {
  CUSTODY_DOMAIN_NAME,
  CUSTODY_DOMAIN_VERSION,
  custodyDomain,
  ScheduleCustodyChangeRequest,
  ApplyCustodyChangeRequest,
  CancelScheduledChangeRequest,
  type ScheduleCustodyChangeMessage,
  type ApplyCustodyChangeMessage,
  type CancelScheduledChangeMessage,
} from './eip712.js';

export {
  type Custodian,
  type Trustee,
  type CustodyCouncil,
  type ScheduledChange,
  type CustodyMode,
  type RiskTier,
  CUSTODY_MODE_BY_INDEX,
} from './types.js';

export {
  type EcdsaSlot,
  type ContractSigSlot,
  type ApprovedHashSlot,
  type PasskeySlot,
  type QuorumSlot,
  type WebAuthnAssertion,
  packQuorumSigs,
  encodePasskeyTailBody,
  passkeyIdentity,
} from './quorum-slots.js';
