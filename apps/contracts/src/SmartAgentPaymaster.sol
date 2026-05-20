// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "account-abstraction/core/BasePaymaster.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/interfaces/PackedUserOperation.sol";
import "./governance/IGovernance.sol";

/**
 * @title SmartAgentPaymaster
 * @notice ERC-4337 paymaster (v0.7+ interface, runs against our v0.9 EntryPoint)
 *         that sponsors gas at the EntryPoint level so users never need ETH.
 *         A userOp sets `paymasterAndData = <this paymaster> || <empty>` and
 *         the EntryPoint reimburses the bundler from this paymaster's
 *         on-EntryPoint deposit.
 *
 * Design posture (v1, ported from smart-agent):
 *   - DEV-SAFE accept-all policy. `_validatePaymasterUserOp` returns
 *     `("", 0)` for every userOp, regardless of sender or callData.
 *   - The `_acceptList` mapping + governance admin surface is wired so that
 *     a follow-up production PR can flip `_dev = false` and require senders
 *     to be allow-listed (or replace this with a verifying-paymaster variant
 *     that checks an off-chain signature in `paymasterData`).
 *   - No per-call accounting → `_postOp` is a no-op and
 *     `_validatePaymasterUserOp` returns empty context, telling EntryPoint
 *     to skip the postOp call entirely (saves ~30k gas per op).
 *
 * Production checklist (DO BEFORE PUBLIC DEPLOY):
 *   1. Call `setDevMode(false)` (governance only).
 *   2. Populate `_acceptList` with the canonical AgentAccountFactory and/or
 *      the set of legitimate smart-account senders.
 *   3. Consider upgrading to a verifying-paymaster (off-chain signed
 *      paymasterData) before exposing this to untrusted senders.
 *   4. Monitor `getDeposit()` and alert below a runway threshold.
 *
 * @dev Inherits `addStake`, `unlockStake`, `withdrawStake`, `deposit`, and
 *      `withdrawTo` from `BasePaymaster`. Ownable owner is set in the
 *      constructor (Ownable2Step pattern).
 */
contract SmartAgentPaymaster is BasePaymaster {
    /// @notice Whether the paymaster is in dev (accept-all) mode.
    bool private _dev;

    /// @notice Per-sender allow-list for production mode.
    mapping(address => bool) private _acceptList;

    /// @notice The Governance contract whose pause flag halts paymaster
    ///         validation. Stored immutable.
    address public immutable governance;

    error SenderNotAccepted(address sender);
    error SystemPaused();
    error ZeroGovernance();
    error NotGovernance();

    event DevModeSet(bool dev);
    event SenderAcceptedSet(address indexed sender, bool accepted);

    /// @dev Storage gap reserves slots for future state.
    uint256[50] private __gap;

    /// @param entryPointAddr ERC-4337 EntryPoint.
    /// @param initialOwner   Transient Ownable owner used during deploy
    ///                       so the deployer can `addStake` / `deposit`
    ///                       in the same broadcast. Transfer ownership
    ///                       to `governance_` at the end of deploy via
    ///                       `transferOwnership` + `acceptOwnership`.
    /// @param governance_    The Governance contract; sourced for the
    ///                       pause flag. Stored immutable so it cannot
    ///                       be redirected post-deploy.
    constructor(
        IEntryPoint entryPointAddr,
        address initialOwner,
        address governance_
    ) BasePaymaster(entryPointAddr, initialOwner) {
        if (governance_ == address(0)) revert ZeroGovernance();
        governance = governance_;
        _dev = true;
        emit DevModeSet(true);
    }

    // ─── Admin (governance-only) ────────────────────────────────────────

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    function setDevMode(bool dev) external onlyGovernance {
        _dev = dev;
        emit DevModeSet(dev);
    }

    function setAccepted(address sender, bool accepted) external onlyGovernance {
        _acceptList[sender] = accepted;
        emit SenderAcceptedSet(sender, accepted);
    }

    function setAcceptedBatch(address[] calldata senders, bool accepted) external onlyGovernance {
        for (uint256 i = 0; i < senders.length; i++) {
            _acceptList[senders[i]] = accepted;
            emit SenderAcceptedSet(senders[i], accepted);
        }
    }

    // ─── Views ──────────────────────────────────────────────────────────

    function devMode() external view returns (bool) {
        return _dev;
    }

    function isAccepted(address sender) external view returns (bool) {
        return _acceptList[sender];
    }

    // ─── Paymaster hook ────────────────────────────────────────────────

    /// @inheritdoc BasePaymaster
    /// @dev Accept-all in dev; allow-list in prod. Returns empty context so
    ///      EntryPoint skips postOp (cheaper). validationData=0 signals
    ///      "valid signature, valid indefinitely".
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /*userOpHash*/,
        uint256 /*maxCost*/
    ) internal view override returns (bytes memory context, uint256 validationData) {
        if (IGovernanceView(governance).isPaused()) revert SystemPaused();
        if (!_dev) {
            if (!_acceptList[userOp.sender]) revert SenderNotAccepted(userOp.sender);
        }
        return ("", 0);
    }

    /// @inheritdoc BasePaymaster
    /// @dev No per-call accounting in v1. No-op so EntryPoint can safely
    ///      call us if it ever does (it won't — we return empty context).
    function _postOp(
        PostOpMode /*mode*/,
        bytes calldata /*context*/,
        uint256 /*actualGasCost*/,
        uint256 /*actualUserOpFeePerGas*/
    ) internal pure override {
        // intentionally empty
    }
}
