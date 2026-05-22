// CustodyAction — mirrors enum in apps/contracts/src/custody/CustodyPolicy.sol
// (spec 213 § 2.2). The on-the-wire encoding is uint8; this enum maps the
// values into the same custody-vocabulary names the Solidity surface uses.

import { encodeAbiParameters, type Address, type Hex } from 'viem';

export enum CustodyAction {
  AddCustodian = 0,
  RemoveCustodian = 1,
  AddPasskeyCredential = 2,
  RemovePasskeyCredential = 3,
  AddTrustee = 4,
  RemoveTrustee = 5,
  ChangeCustodyMode = 6,
  ApplySystemUpdate = 7,
  RotateDelegationManager = 8,
  RotatePaymaster = 9,
  RotateSessionIssuer = 10,
  RotateAllCustodians = 11,
  ChangeValueCeiling = 12,
  SetRecoveryApprovals = 13,
  RecoverAccount = 14,
  ChangeApprovalsRequired = 15,
}

// ─── Per-action arg builders ─────────────────────────────────────────────
//
// Each builder produces the `args` bytes the on-chain scheduler expects.
// Keeping these here means the UI never reaches for `encodeAbiParameters`
// directly with magic type strings.

export function buildAddCustodianArgs(custodian: Address): Hex {
  return encodeAbiParameters([{ type: 'address' }], [custodian]);
}

export function buildRemoveCustodianArgs(custodian: Address): Hex {
  return encodeAbiParameters([{ type: 'address' }], [custodian]);
}

export function buildAddTrusteeArgs(trustee: Address): Hex {
  return encodeAbiParameters([{ type: 'address' }], [trustee]);
}

export function buildRemoveTrusteeArgs(trustee: Address): Hex {
  return encodeAbiParameters([{ type: 'address' }], [trustee]);
}

export function buildChangeCustodyModeArgs(newMode: 0 | 1 | 2 | 3): Hex {
  return encodeAbiParameters([{ type: 'uint8' }], [newMode]);
}

export function buildChangeValueCeilingArgs(newCeilingWei: bigint): Hex {
  return encodeAbiParameters([{ type: 'uint256' }], [newCeilingWei]);
}

export function buildSetRecoveryApprovalsArgs(approvals: number): Hex {
  return encodeAbiParameters([{ type: 'uint8' }], [approvals]);
}

export function buildApplySystemUpdateArgs(newImpl: Address): Hex {
  return encodeAbiParameters([{ type: 'address' }], [newImpl]);
}

/**
 * Encode args for `ChangeApprovalsRequired(tier, newCount)`.
 *
 * `tier` is a RiskTier in [1, 5] — T6 (recovery) lives in a separate
 * slot and is set via `buildSetRecoveryApprovalsArgs`. `newCount` must
 * satisfy `1 <= newCount <= account.custodianCount()` at apply time.
 */
export function buildChangeApprovalsRequiredArgs(tier: number, newCount: number): Hex {
  return encodeAbiParameters(
    [{ type: 'uint8' }, { type: 'uint8' }],
    [tier, newCount],
  );
}

/**
 * Encode args for `AddPasskeyCredential(credentialIdDigest, x, y)`.
 * Side effect on AgentAccount: also registers the PIA derived from
 * `(x, y)` as a first-class custodian.
 */
export function buildAddPasskeyCredentialArgs(
  credentialIdDigest: Hex,
  x: bigint,
  y: bigint,
): Hex {
  return encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }],
    [credentialIdDigest, x, y],
  );
}

/** Encode args for `RemovePasskeyCredential(credentialIdDigest)`. */
export function buildRemovePasskeyCredentialArgs(credentialIdDigest: Hex): Hex {
  return encodeAbiParameters([{ type: 'bytes32' }], [credentialIdDigest]);
}
