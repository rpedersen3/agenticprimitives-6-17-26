// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title PaymentReceiptRegistry
 * @notice Trustless, queryable settlement log for x402 pay-per-use (spec 272, PAY-CON-4 / X402-D9.3).
 *         Only the authorized {PaymentEnforcer} may `record` — a receipt is a byproduct of a gated
 *         `DelegationManager.redeemDelegation`, so a service cannot fabricate one and the reader's
 *         charge history needs no trust in service logs.
 *
 * @dev    HASHES + ADDRESSES ONLY — no URLs, queries, licensed text, or passage refs ever reach the
 *         chain (PAY-WIRE-6). Event-only (no per-row storage): apps read settlements via an indexer /
 *         app cache, never inline `eth_getLogs` in product hot paths (ADR-0012). The
 *         `PaymentEnforcer.PaymentCharged` event is the primary on-chain receipt; `PaymentSettled`
 *         here adds payer/payee/mandateId-indexed querying for treasury views.
 */
contract PaymentReceiptRegistry {
    /// @notice The deployer who wires the sole authorized recorder once.
    address public immutable owner;
    /// @notice The single PaymentEnforcer permitted to `record` (set once via {setEnforcer}).
    address public enforcer;

    event PaymentSettled(
        bytes32 indexed mandateId,
        address indexed payer,
        address indexed payee,
        address asset,
        uint256 amount,
        bytes32 resourceHash,
        bytes32 delegationHash,
        bytes32 nonce
    );
    event EnforcerSet(address indexed enforcer);

    error NotOwner();
    error NotEnforcer();
    error EnforcerAlreadySet();
    error ZeroAddress();

    constructor() {
        owner = msg.sender;
    }

    /// @notice One-time wiring: authorize the deployed {PaymentEnforcer} as the sole recorder.
    function setEnforcer(address enforcer_) external {
        if (msg.sender != owner) revert NotOwner();
        if (enforcer != address(0)) revert EnforcerAlreadySet();
        if (enforcer_ == address(0)) revert ZeroAddress();
        enforcer = enforcer_;
        emit EnforcerSet(enforcer_);
    }

    /// @notice Record a settled payment. Reverts unless called by the authorized enforcer.
    function record(
        bytes32 mandateId,
        address payer,
        address payee,
        address asset,
        uint256 amount,
        bytes32 resourceHash,
        bytes32 delegationHash,
        bytes32 nonce
    ) external {
        if (msg.sender != enforcer) revert NotEnforcer();
        emit PaymentSettled(mandateId, payer, payee, asset, amount, resourceHash, delegationHash, nonce);
    }
}
