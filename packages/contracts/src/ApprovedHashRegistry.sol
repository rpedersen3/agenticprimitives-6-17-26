// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ApprovedHashRegistry
 * @notice On-chain pre-approved hashes — the `v == 1` path of Safe's
 *         `checkSignatures` packing format, ported into the
 *         agenticprimitives multi-sig surface so signers that can't
 *         easily produce off-chain ECDSA over arbitrary EIP-712 payloads
 *         (passkey-only smart accounts, hardware wallets without typed
 *         data support, etc.) can pre-approve a hash by transaction
 *         instead of off-chain signature.
 *
 * @dev Mirrors Safe's `Safe.approveHash` semantics exactly:
 *      `QuorumEnforcer.beforeHook` consults `isApproved(signer, hash)`
 *      when it parses a 65-byte signature slot with `v = 1`. The signer
 *      address rides in the slot's `r` field (left-padded); the
 *      pre-approval gates whether that signer's "signature" counts
 *      toward the threshold.
 *
 *      Anyone may approve their own hashes — the verifier
 *      (`QuorumEnforcer`) only counts approvals from addresses present
 *      in the delegation's bound signer set, so spam approvals from
 *      non-signers are no-ops.
 *
 *      Pairs with `MultiSendCallOnly` (atomic batch) so a passkey
 *      smart account can `approveHash` + perform the delegated action
 *      in one userOp.
 */
contract ApprovedHashRegistry {
    /// signer => hash => approved
    mapping(address => mapping(bytes32 => bool)) public approved;

    event HashApproved(address indexed signer, bytes32 indexed hash);
    event HashRevoked(address indexed signer, bytes32 indexed hash);

    /**
     * @notice Pre-approve a hash. `msg.sender` is the signer; only
     *         this address can later be counted by `QuorumEnforcer`
     *         for this hash.
     */
    function approveHash(bytes32 hash) external {
        approved[msg.sender][hash] = true;
        emit HashApproved(msg.sender, hash);
    }

    /// @notice Revoke a previously-approved hash before redemption.
    function revokeHash(bytes32 hash) external {
        approved[msg.sender][hash] = false;
        emit HashRevoked(msg.sender, hash);
    }

    /// @notice External view used by `QuorumEnforcer`'s `v == 1` path.
    function isApproved(address signer, bytes32 hash) external view returns (bool) {
        return approved[signer][hash];
    }
}
