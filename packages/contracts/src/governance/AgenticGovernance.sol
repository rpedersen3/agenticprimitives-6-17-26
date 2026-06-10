// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./IGovernance.sol";

/**
 * @title AgenticGovernance
 * @notice H7-C.9 / EXT3-009 closure — the governance surface every
 *         `GovernanceManaged` contract (`AgentAccountFactory`,
 *         `SmartAgentPaymaster`, the registries) sees as its
 *         `governance` immutable. Wraps:
 *
 *           - **Pause / unpause** (the kill-switch behind every
 *             `whenNotPaused` modifier in `GovernanceManaged`).
 *           - **Forwarded execution** (`execute(target, data, value)`)
 *             so the slow-path timelock can deliver `onlyGovernance`
 *             calls that authenticate as `msg.sender == address(this)`.
 *           - **Signer / pauser registry** (`isSigner`) consumed by
 *             `IGovernanceView`.
 *
 *         Two-role authority split:
 *           - `timelock` — the OZ `TimelockController(24h)` deployed
 *             alongside this contract. Owns slow / deliberate actions
 *             (admin role mutations, unpause, signer changes,
 *             forwarded calls). All actions go through 24h delay.
 *           - `guardian` — fast-path emergency pause. CAN pause (no
 *             delay; the incident-response lever) but CANNOT unpause —
 *             unpause requires the timelock so an attacker who steals
 *             guardian keys can't unpause a paused system.
 *
 *         Post-deploy operator step (see deploy-runbook): replace the
 *         bootstrap `[deployer]` proposers/executors on the timelock
 *         with a long-lived multisig (an `AgentAccount` deployed by
 *         the factory whose `CustodyPolicy` requires M-of-N signers).
 *         Deployer then renounces the timelock admin role and is gone.
 */
contract AgenticGovernance is IGovernanceView {
    // ─── Immutables ───────────────────────────────────────────────

    /// @notice The `TimelockController(24h)` that may execute slow-path
    ///         governance actions through this contract. Set once at
    ///         construction; rotate by redeploying.
    address public immutable timelock;

    // ─── State ────────────────────────────────────────────────────

    bool private _paused;
    mapping(address => bool) private _signers;

    /// @notice Fast-path emergency-pauser role. Can pause without delay but
    ///         CANNOT unpause (unpause requires the timelock). GOV-1: this is a
    ///         STORAGE var (not immutable) so the timelock can ROTATE it — a
    ///         guardian whose key is compromised and grief-pauses the system can
    ///         be replaced WITHOUT a full governance redeploy, bounding the
    ///         re-pause DoS to one timelock window instead of "permanent". Set
    ///         (`setGuardian`) only by the timelock. Declared after the existing
    ///         storage vars so their slot assignments don't shift.
    address public guardian;

    // ─── Errors ───────────────────────────────────────────────────

    error NotTimelock(address caller);
    error NotGuardian(address caller);
    error ExecuteFailed(address target, bytes returndata);
    error ZeroAddress();

    // ─── Events ───────────────────────────────────────────────────

    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event SignerSet(address indexed who, bool isSigner);
    event Executed(address indexed target, uint256 value, bytes data);
    /// @notice GOV-1 — the guardian (fast-pause) role was rotated by the timelock.
    event GuardianRotated(address indexed oldGuardian, address indexed newGuardian);

    // ─── Constructor ──────────────────────────────────────────────

    constructor(address timelock_, address guardian_, address[] memory initialSigners) {
        if (timelock_ == address(0) || guardian_ == address(0)) revert ZeroAddress();
        timelock = timelock_;
        guardian = guardian_;
        for (uint256 i; i < initialSigners.length; i++) {
            address s = initialSigners[i];
            if (s == address(0)) revert ZeroAddress();
            _signers[s] = true;
            emit SignerSet(s, true);
        }
    }

    // ─── IGovernanceView ──────────────────────────────────────────

    /// @inheritdoc IGovernanceView
    function isPaused() external view returns (bool) {
        return _paused;
    }

    /// @inheritdoc IGovernanceView
    function isSigner(address who) external view returns (bool) {
        return _signers[who];
    }

    // ─── Pause / Unpause ──────────────────────────────────────────

    /// @notice Emergency pause. Callable by the guardian without delay.
    function pause() external {
        if (msg.sender != guardian) revert NotGuardian(msg.sender);
        _paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Unpause. Requires the timelock (a deliberate 24h
    ///         decision); guardian alone cannot unpause.
    function unpause() external {
        if (msg.sender != timelock) revert NotTimelock(msg.sender);
        _paused = false;
        emit Unpaused(msg.sender);
    }

    // ─── Slow-path governance (timelock only) ─────────────────────

    /// @notice Forward a call to a `GovernanceManaged` target. The
    ///         target sees `msg.sender == address(this)`, satisfying
    ///         its `onlyGovernance` modifier. Only callable by the
    ///         timelock (every action sees a 24h delay before execute).
    function execute(address target, bytes calldata data, uint256 value)
        external
        payable
        returns (bytes memory)
    {
        if (msg.sender != timelock) revert NotTimelock(msg.sender);
        (bool ok, bytes memory result) = target.call{value: value}(data);
        if (!ok) revert ExecuteFailed(target, result);
        emit Executed(target, value, data);
        return result;
    }

    /// @notice Add / remove a signer (consumed by `isSigner` reads from
    ///         downstream `GovernanceManaged` contracts).
    function setSigner(address who, bool sig) external {
        if (msg.sender != timelock) revert NotTimelock(msg.sender);
        _signers[who] = sig;
        emit SignerSet(who, sig);
    }

    /// @notice GOV-1 — rotate the guardian (fast-pause) role. Timelock-only, so a
    ///         compromised guardian that is perpetually re-pausing the system can
    ///         be replaced after one timelock window WITHOUT a governance redeploy.
    ///         To retire the fast-pause capability entirely, rotate to a burn
    ///         address. Cannot be the zero address (would make `pause()` an
    ///         accidental no-op while looking live).
    function setGuardian(address newGuardian) external {
        if (msg.sender != timelock) revert NotTimelock(msg.sender);
        if (newGuardian == address(0)) revert ZeroAddress();
        address old = guardian;
        guardian = newGuardian;
        emit GuardianRotated(old, newGuardian);
    }

    // ─── Receive ETH ──────────────────────────────────────────────

    receive() external payable {}
}
