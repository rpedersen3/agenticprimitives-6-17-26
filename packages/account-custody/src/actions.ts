// CustodyAction — mirrors enum in packages/contracts/src/custody/CustodyPolicy.sol
// (spec 213 § 2.2). The on-the-wire encoding is uint8; this enum maps the
// values into the same custody-vocabulary names the Solidity surface uses.
//
// Wave H2 hardening: every builder validates arguments at the package
// boundary so wire-format bugs surface at call time instead of as
// opaque on-chain reverts.

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

// ─── Range / shape validators ────────────────────────────────────────────

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const U256_MAX = (1n << 256n) - 1n;
const U8_MAX = 255;

function assertAddress(label: string, v: Address): void {
  if (typeof v !== 'string' || !ADDRESS_RE.test(v)) {
    throw new RangeError(`[custody] ${label}: not a 20-byte hex address (${v})`);
  }
}

function assertBytes32(label: string, v: Hex): void {
  if (typeof v !== 'string' || !BYTES32_RE.test(v)) {
    throw new RangeError(`[custody] ${label}: not a 32-byte hex (${v})`);
  }
}

function assertUint8(label: string, v: number, min = 0, max = U8_MAX): void {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new RangeError(`[custody] ${label}: not a uint8 in [${min}, ${max}] (got ${v})`);
  }
}

function assertUint256(label: string, v: bigint, min = 0n, max = U256_MAX): void {
  if (typeof v !== 'bigint' || v < min || v > max) {
    throw new RangeError(`[custody] ${label}: not a uint256 in [${min}, ${max}] (got ${v})`);
  }
}

// ─── Per-action arg builders ─────────────────────────────────────────────
//
// Each builder produces the `args` bytes the on-chain scheduler expects.
// Keeping these here means the UI never reaches for `encodeAbiParameters`
// directly with magic type strings.

export function buildAddCustodianArgs(custodian: Address): Hex {
  assertAddress('AddCustodian.custodian', custodian);
  return encodeAbiParameters([{ type: 'address' }], [custodian]);
}

export function buildRemoveCustodianArgs(custodian: Address): Hex {
  assertAddress('RemoveCustodian.custodian', custodian);
  return encodeAbiParameters([{ type: 'address' }], [custodian]);
}

export function buildAddTrusteeArgs(trustee: Address): Hex {
  assertAddress('AddTrustee.trustee', trustee);
  return encodeAbiParameters([{ type: 'address' }], [trustee]);
}

export function buildRemoveTrusteeArgs(trustee: Address): Hex {
  assertAddress('RemoveTrustee.trustee', trustee);
  return encodeAbiParameters([{ type: 'address' }], [trustee]);
}

export function buildChangeCustodyModeArgs(newMode: 0 | 1 | 2 | 3): Hex {
  assertUint8('ChangeCustodyMode.newMode', newMode, 0, 3);
  return encodeAbiParameters([{ type: 'uint8' }], [newMode]);
}

export function buildChangeValueCeilingArgs(newCeilingWei: bigint): Hex {
  assertUint256('ChangeValueCeiling.newCeilingWei', newCeilingWei);
  return encodeAbiParameters([{ type: 'uint256' }], [newCeilingWei]);
}

/**
 * Encode args for `SetRecoveryApprovals(newThreshold)`.
 *
 * The on-chain CustodyPolicy rejects `newThreshold == 0` (Wave 2C C-9)
 * to prevent T4-quorum-induced silent recovery disable. The builder
 * does NOT enforce that ceiling because the upper bound is the
 * runtime trustee count; on-chain validation catches an over-threshold.
 */
export function buildSetRecoveryApprovalsArgs(approvals: number): Hex {
  assertUint8('SetRecoveryApprovals.approvals', approvals);
  return encodeAbiParameters([{ type: 'uint8' }], [approvals]);
}

export function buildApplySystemUpdateArgs(newImpl: Address): Hex {
  assertAddress('ApplySystemUpdate.newImpl', newImpl);
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
  assertUint8('ChangeApprovalsRequired.tier', tier, 1, 5);
  assertUint8('ChangeApprovalsRequired.newCount', newCount, 1);
  return encodeAbiParameters(
    [{ type: 'uint8' }, { type: 'uint8' }],
    [tier, newCount],
  );
}

/**
 * Encode args for `AddPasskeyCredential(credentialIdDigest, x, y)`.
 * Side effect on AgentAccount: also registers the PIA derived from
 * `(x, y)` as a first-class custodian.
 *
 * Wave 2C C-6 hardening: on-chain initializer rejects credentialIdDigest
 * == 0; this builder echoes that check at the wire-format boundary so
 * the demo never spends gas on a guaranteed-revert tx.
 */
export function buildAddPasskeyCredentialArgs(
  credentialIdDigest: Hex,
  x: bigint,
  y: bigint,
): Hex {
  assertBytes32('AddPasskeyCredential.credentialIdDigest', credentialIdDigest);
  if (credentialIdDigest === ('0x' + '00'.repeat(32))) {
    throw new RangeError('[custody] AddPasskeyCredential.credentialIdDigest: must be non-zero (audit C-6)');
  }
  assertUint256('AddPasskeyCredential.x', x, 1n);
  assertUint256('AddPasskeyCredential.y', y, 1n);
  return encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }],
    [credentialIdDigest, x, y],
  );
}

/** Encode args for `RemovePasskeyCredential(credentialIdDigest)`. */
export function buildRemovePasskeyCredentialArgs(credentialIdDigest: Hex): Hex {
  assertBytes32('RemovePasskeyCredential.credentialIdDigest', credentialIdDigest);
  return encodeAbiParameters([{ type: 'bytes32' }], [credentialIdDigest]);
}

/**
 * Encode args for `RotateAllCustodians(addCustodians, removeCustodians)`
 * (Wave 2C C-10). Adds the new set + removes the old in one atomic action;
 * factory enforces that at-least-one custodian remains.
 */
export function buildRotateAllCustodiansArgs(
  addCustodians: readonly Address[],
  removeCustodians: readonly Address[],
): Hex {
  for (const c of addCustodians) assertAddress('RotateAllCustodians.add', c);
  for (const c of removeCustodians) assertAddress('RotateAllCustodians.remove', c);
  return encodeAbiParameters(
    [{ type: 'address[]' }, { type: 'address[]' }],
    [addCustodians as Address[], removeCustodians as Address[]],
  );
}

/**
 * One passkey to add inside a T6 recovery — mirrors the Solidity
 * `AgentAccountRecoveryPasskeyAdd` struct.
 */
export interface RecoveryPasskeyAdd {
  credentialIdDigest: Hex;
  x: bigint;
  y: bigint;
}

/**
 * Encode args for `RecoverAccount(args)` — atomic add/remove of owners
 * and passkeys in one T6 action so the signer set doesn't pass through
 * a half-rotated intermediate state.
 *
 * Solidity struct (from packages/contracts/src/IAgentAccount.sol):
 *   struct AgentAccountRecoveryArgs {
 *     address[] addOwners;
 *     address[] removeOwners;
 *     AgentAccountRecoveryPasskeyAdd[] addPasskeys;
 *     bytes32[] removePasskeyCredentialIdDigests;
 *   }
 */
export function buildRecoverAccountArgs(args: {
  addOwners?: readonly Address[];
  removeOwners?: readonly Address[];
  addPasskeys?: readonly RecoveryPasskeyAdd[];
  removePasskeyCredentialIdDigests?: readonly Hex[];
}): Hex {
  const addOwners = args.addOwners ?? [];
  const removeOwners = args.removeOwners ?? [];
  const addPasskeys = args.addPasskeys ?? [];
  const removePasskeyCredentialIdDigests = args.removePasskeyCredentialIdDigests ?? [];

  for (const a of addOwners) assertAddress('RecoverAccount.addOwners', a);
  for (const a of removeOwners) assertAddress('RecoverAccount.removeOwners', a);
  for (const p of addPasskeys) {
    assertBytes32('RecoverAccount.addPasskeys.credentialIdDigest', p.credentialIdDigest);
    if (p.credentialIdDigest === ('0x' + '00'.repeat(32))) {
      throw new RangeError('[custody] RecoverAccount.addPasskeys: credentialIdDigest must be non-zero (audit C-6)');
    }
    assertUint256('RecoverAccount.addPasskeys.x', p.x, 1n);
    assertUint256('RecoverAccount.addPasskeys.y', p.y, 1n);
  }
  for (const d of removePasskeyCredentialIdDigests) {
    assertBytes32('RecoverAccount.removePasskeyCredentialIdDigests', d);
  }

  if (
    addOwners.length === 0 &&
    removeOwners.length === 0 &&
    addPasskeys.length === 0 &&
    removePasskeyCredentialIdDigests.length === 0
  ) {
    throw new RangeError('[custody] RecoverAccount: at least one add/remove field must be non-empty');
  }

  return encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'addOwners', type: 'address[]' },
          { name: 'removeOwners', type: 'address[]' },
          {
            name: 'addPasskeys',
            type: 'tuple[]',
            components: [
              { name: 'credentialIdDigest', type: 'bytes32' },
              { name: 'x', type: 'uint256' },
              { name: 'y', type: 'uint256' },
            ],
          },
          { name: 'removePasskeyCredentialIdDigests', type: 'bytes32[]' },
        ],
      },
    ],
    [{
      addOwners: addOwners as Address[],
      removeOwners: removeOwners as Address[],
      addPasskeys: addPasskeys as RecoveryPasskeyAdd[],
      removePasskeyCredentialIdDigests: removePasskeyCredentialIdDigests as Hex[],
    }],
  );
}
