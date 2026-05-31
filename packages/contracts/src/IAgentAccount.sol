// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "account-abstraction/interfaces/IAccount.sol";

/**
 * @title IAgenticPrimitivesAgentAccount
 * @notice ERC-165 marker interface for AgentAccounts deployed by
 *         agenticprimitives. `AgentAccount.addCustodian` queries this
 *         (via ERC-165 `supportsInterface`) to enforce the architectural
 *         invariant from spec 211 § 3 + spec 212 § 2.2: an
 *         agenticprimitives AgentAccount MUST NEVER appear in another
 *         AgentAccount's custodian set. Smart-agent ↔ smart-agent
 *         relationships are stewardship/delegation, not custody —
 *         custody bottoms out at external signer authority (EOA / SIWE /
 *         passkey / third-party smart wallet).
 *
 *         Third-party smart wallets (Safe, Argent, Privy, …) are
 *         intentionally permitted as custodians because they wrap
 *         external human signers and validate via ERC-1271 without
 *         recursing into our own custody system.
 */
interface IAgenticPrimitivesAgentAccount {
    /// @dev Marker — implementations MUST return true. The selector is
    ///      the ERC-165 interfaceId via `type(IAgenticPrimitivesAgentAccount).interfaceId`.
    function isAgenticPrimitivesAgentAccount() external pure returns (bool);
}

/**
 * @notice Parameters bundled into one struct so the factory entry point
 *         + the matching `initializeWithThresholdPolicy` initializer
 *         share an exact shape. Captures everything the spec 207
 *         threshold-policy surface needs at account birth — mode,
 *         owners, guardians, optional initial passkey. The factory
 *         installs the spec § 5.1 default threshold matrix + default
 *         T4/T5/T6 timelocks automatically; callers tune them
 *         post-deploy via T4/T5 admin flows.
 *
 * `mode`: 0=single, 1=hybrid, 2=threshold, 3=org. Factory enforces
 *         per-mode guardian-count minima per spec § 8 (single: 0,
 *         hybrid: 0+, threshold: ≥ 2, org: ≥ 3).
 */
struct AgentAccountInitParams {
    uint8 mode;
    address[] custodians;
    address[] trustees;
    bytes32 initialPasskeyCredentialIdDigest; // 0x0 to skip the passkey
    uint256 initialPasskeyX;
    uint256 initialPasskeyY;
    // H7-C.1 / CON-WEBAUTHN-001: rpIdHash the initial passkey was registered
    // against. Required (non-zero) when the passkey is present.
    bytes32 initialPasskeyRpIdHash;
}

/**
 * @notice One passkey to add as part of a T6 recovery. Coupled to
 *         `AgentAccountRecoveryArgs.addPasskeys` so callers can name
 *         each entry instead of juggling parallel arrays.
 *
 *         H7-C.1 added `rpIdHash` — see `IAgentAccount.addPasskey`.
 */
struct AgentAccountRecoveryPasskeyAdd {
    bytes32 credentialIdDigest;
    uint256 x;
    uint256 y;
    bytes32 rpIdHash;
}

/**
 * @notice Payload for `AdminAction.RecoverAccount` (T6). Atomically
 *         adds + removes owners and passkeys in a single executed
 *         action so the recovery flow doesn't pass through fragmented
 *         intermediate states (half-rotated signer set).
 *
 *         Spec 207 § 8 describes the flow:
 *           1. Guardian quorum proposes recovery.
 *           2. 48h timelock; first 24h is the primary-owner
 *              cancel window.
 *           3. Guardian quorum executes; signer set rotates atomically.
 *
 *         Removal lists may name signers that don't exist (no-op);
 *         add lists may include signers already present (no-op). This
 *         lets callers idempotently re-propose if a recovery race
 *         partially succeeded.
 */
struct AgentAccountRecoveryArgs {
    address[] addOwners;
    address[] removeOwners;
    AgentAccountRecoveryPasskeyAdd[] addPasskeys;
    bytes32[] removePasskeyCredentialIdDigests;
}

/**
 * @title IAgentAccount
 * @notice Interface for an agent-native ERC-4337 smart account.
 */
interface IAgentAccount is IAccount {
    /// @notice Emitted when an owner is added.
    event CustodianAdded(address indexed owner);

    /// @notice Emitted when an owner is removed.
    event CustodianRemoved(address indexed owner);

    /// @notice Returns true if the address is an owner.
    function isCustodian(address account) external view returns (bool);

    /// @notice Returns the number of owners.
    function custodianCount() external view returns (uint256);

    /// @notice Add a new owner. Callable only by the account itself (via UserOp).
    function addCustodian(address owner) external;

    /// @notice Remove an owner. Callable only by the account itself (via UserOp).
    function removeCustodian(address owner) external;

    /// @notice ERC-1271: validate a signature against account owners.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);

    // ─── Spec 007 Phase A — capability roles ────────────────────────

    /// @notice Bundler signer (resolved through the factory).
    function bundlerSigner() external view returns (address);

    /// @notice Session-issuer (resolved through the factory).
    function sessionIssuer() external view returns (address);

    /// @notice True iff the owner has pre-authorized this session
    ///         delegation hash on chain (Variant B).
    function hasAcceptedSessionDelegation(bytes32 sessionDelegationHash) external view returns (bool);

    /// @notice Pre-authorize an on-chain session delegation (Variant B).
    ///         `onlySelf` — must be reached via a userOp the owner signed.
    function acceptSessionDelegation(bytes32 sessionDelegationHash) external;

    /// @notice Owner-signed UUPS upgrade. Any caller can submit the tx;
    ///         what matters is whose signature `ownerSig` recovers to.
    function upgradeToWithAuthorization(address newImpl, bytes calldata ownerSig) external;
}
