// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "account-abstraction/interfaces/IAccount.sol";

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
    address[] owners;
    address[] guardians;
    bytes32 initialPasskeyCredentialIdDigest; // 0x0 to skip the passkey
    uint256 initialPasskeyX;
    uint256 initialPasskeyY;
}

/**
 * @title IAgentAccount
 * @notice Interface for an agent-native ERC-4337 smart account.
 */
interface IAgentAccount is IAccount {
    /// @notice Emitted when an owner is added.
    event OwnerAdded(address indexed owner);

    /// @notice Emitted when an owner is removed.
    event OwnerRemoved(address indexed owner);

    /// @notice Returns true if the address is an owner.
    function isOwner(address account) external view returns (bool);

    /// @notice Returns the number of owners.
    function ownerCount() external view returns (uint256);

    /// @notice Add a new owner. Callable only by the account itself (via UserOp).
    function addOwner(address owner) external;

    /// @notice Remove an owner. Callable only by the account itself (via UserOp).
    function removeOwner(address owner) external;

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
