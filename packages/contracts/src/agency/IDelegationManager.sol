// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IDelegationManager
 * @notice Manages delegations between agent accounts with caveat enforcement.
 *
 * Aligned with ERC-7710 (Smart Contract Delegation) patterns and inspired by
 * MetaMask delegation-framework:
 * - A delegation grants a delegate the right to act on behalf of a delegator
 * - Caveats constrain what the delegate can do (time, value, methods, targets)
 * - Delegations can be chained: A delegates to B, B delegates to C
 * - Revocation is immediate and on-chain
 * - Execution goes through the delegator's smart account (executeFromExecutor)
 *
 * ERC-7710 defines: redeemDelegations(bytes[], bytes32[], bytes[])
 * We provide both the typed `redeemDelegation` and the ERC-7710 opaque interface.
 */
interface IDelegationManager {
    struct Caveat {
        address enforcer;   // contract that validates this caveat
        bytes terms;        // encoded parameters set at delegation creation time
        bytes args;         // encoded parameters provided by redeemer at redemption time
    }

    struct Delegation {
        address delegator;  // account granting authority
        address delegate;   // account receiving authority (address(0xa11) = open delegation)
        bytes32 authority;  // parent delegation hash (ROOT_AUTHORITY for root)
        Caveat[] caveats;   // restrictions on the delegation
        uint256 salt;       // replay protection
        bytes signature;    // EIP-712 signature from delegator
    }

    /// @notice Emitted when a delegation is redeemed.
    event DelegationRedeemed(
        bytes32 indexed delegationHash,
        address indexed delegator,
        address indexed delegate
    );

    /// @notice Emitted when a delegation is revoked.
    event DelegationRevoked(bytes32 indexed delegationHash);

    /// @notice Redeem a delegation chain to execute an action on behalf of the delegator.
    ///         The delegator's smart account executes the call via executeFromExecutor.
    function redeemDelegation(
        Delegation[] calldata delegations,
        address target,
        uint256 value,
        bytes calldata data
    ) external;

    /// @notice Revoke a delegation by its hash.
    ///
    /// @dev Legacy permissionless path. Phase A.5 introduces
    ///      `revokeDelegationByOwner` for authenticated revocation that
    ///      works for Variant A delegations.
    function revokeDelegation(bytes32 delegationHash) external;

    /// @notice Phase A.5 — authenticated revocation. Caller must be
    ///         either `delegation.delegator` or `delegation.delegate`.
    ///         The delegation struct is signature-checked first to
    ///         prevent a malicious delegate from revoking a forged hash.
    function revokeDelegationByOwner(Delegation calldata delegation) external;

    /// @notice Check if a delegation has been revoked.
    function isRevoked(bytes32 delegationHash) external view returns (bool);

    /// @notice View-only verification of a delegation chain. Returns whether
    ///         the chain authorizes `sender` to redeem WITHOUT executing it.
    ///         Used by trust-substrate contracts (e.g. AttestationRegistry's
    ///         bilateral-consent path per spec 242 PD-9) to validate a packed
    ///         delegation as a signed authorization predicate.
    /// @param delegations Delegation chain, leaf first
    /// @param sender The address that would be the redeemer
    /// @return ok True if the chain verifies
    /// @return reason Empty if ok; otherwise short rejection reason
    function verifyAuthorization(
        Delegation[] calldata delegations,
        address sender
    ) external view returns (bool ok, string memory reason);

    /// @notice View-only authorization of a SPECIFIC call (ADR-0027 / spec 249 RW1-4):
    ///         validates the chain AND evaluates every caveat's `beforeHook` against the exact
    ///         `(target, value, data)` read-only, fail-closed. `true` ONLY if the chain validates
    ///         and every caveat passes under `staticcall`; a denied OR non-view-evaluable caveat
    ///         yields `false` ("use live redemption"). Lets a registry bind consent to the exact
    ///         call inside its own transaction. Caveat evaluation mirrors `redeemDelegation`.
    /// @param delegations Delegation chain, leaf first
    /// @param sender The address that would be the redeemer
    /// @param target The exact target of the delegated call
    /// @param value The exact ETH value
    /// @param data The exact calldata
    /// @return ok True if the chain + every caveat authorize this exact call
    /// @return reason Empty if ok; otherwise short rejection reason
    function verifyAuthorizationForCall(
        Delegation[] calldata delegations,
        address sender,
        address target,
        uint256 value,
        bytes calldata data
    ) external view returns (bool ok, string memory reason);
}
