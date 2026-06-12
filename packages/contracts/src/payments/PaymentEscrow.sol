// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PaymentEscrow
 * @notice Hold-and-capture for an exchange order (spec 243 §5.5 escrow rail, FG-PAY-7).
 *         A payer funds a hold keyed by `orderHash`; funds then move on exactly ONE terminal path:
 *           - release  → captured to the payee (on fulfillment evidence)
 *           - refund   → returned to the payer (payee-consented, before capture)
 *           - reclaim  → returned to the payer (payer-initiated, after expiry)
 *         Symmetric-escrow doctrine (273 EXC-D4): any escrowable leg can be held. Ports the
 *         smart-agent `CommitmentRegistry` status-machine pattern; no third-party escrow dependency.
 *
 * @dev    HASH-ONLY events (orderHash only — no amounts/addresses leak; privacy posture §6). Apps read
 *         hold state via the `getHold` view (`readContract`), never inline `eth_getLogs` (ADR-0012).
 *         Fail-closed: a hold moves Held → {Captured|Refunded|Reclaimed} once and never again
 *         (checks-effects-interactions + ReentrancyGuard). Uses OZ SafeERC20 for fee/no-return tokens.
 */
contract PaymentEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Held,
        Captured,
        Refunded,
        Reclaimed
    }

    struct Hold {
        address payer; // funded the hold
        address asset; // ERC-20
        uint256 amount;
        address payee; // captures on release
        address refundTo; // receives refund / reclaim
        address releaser; // OPTIONAL extra party authorized to release (0 = payee-only)
        uint64 expiry; // payer may reclaim at/after this time
        Status status;
    }

    mapping(bytes32 orderHash => Hold) private _holds;

    event EscrowDeposited(bytes32 indexed orderHash);
    event EscrowReleased(bytes32 indexed orderHash);
    event EscrowRefunded(bytes32 indexed orderHash);
    event EscrowReclaimed(bytes32 indexed orderHash);

    error HoldExists();
    error NoHold();
    error NotHeld();
    error ZeroAmount();
    error ZeroAddress();
    error BadExpiry();
    error NotAuthorized();
    error NotYetExpired();

    /**
     * @notice Fund a hold for `orderHash`. Pulls `amount` of `asset` from the caller (the payer).
     * @param refundTo Where refund/reclaim returns funds; 0 defaults to the payer.
     * @param releaser Extra address allowed to `release` besides `payee`; 0 = payee-only.
     */
    function deposit(
        bytes32 orderHash,
        address asset,
        uint256 amount,
        address payee,
        address refundTo,
        address releaser,
        uint64 expiry
    ) external nonReentrant {
        if (_holds[orderHash].status != Status.None) revert HoldExists();
        if (amount == 0) revert ZeroAmount();
        if (asset == address(0) || payee == address(0)) revert ZeroAddress();
        if (expiry <= block.timestamp) revert BadExpiry();

        _holds[orderHash] = Hold({
            payer: msg.sender,
            asset: asset,
            amount: amount,
            payee: payee,
            refundTo: refundTo == address(0) ? msg.sender : refundTo,
            releaser: releaser,
            expiry: expiry,
            status: Status.Held
        });
        emit EscrowDeposited(orderHash);
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Capture a held order to the payee. Authorized: the payee, or the configured releaser.
    function release(bytes32 orderHash) external nonReentrant {
        Hold storage h = _held(orderHash);
        if (msg.sender != h.payee && (h.releaser == address(0) || msg.sender != h.releaser)) revert NotAuthorized();
        h.status = Status.Captured;
        emit EscrowReleased(orderHash);
        IERC20(h.asset).safeTransfer(h.payee, h.amount);
    }

    /// @notice Payee-consented refund of a held order to the payer (before capture).
    function refund(bytes32 orderHash) external nonReentrant {
        Hold storage h = _held(orderHash);
        if (msg.sender != h.payee) revert NotAuthorized();
        h.status = Status.Refunded;
        emit EscrowRefunded(orderHash);
        IERC20(h.asset).safeTransfer(h.refundTo, h.amount);
    }

    /// @notice Payer reclaims a held order after expiry (never released).
    function reclaim(bytes32 orderHash) external nonReentrant {
        Hold storage h = _held(orderHash);
        if (msg.sender != h.payer) revert NotAuthorized();
        if (block.timestamp < h.expiry) revert NotYetExpired();
        h.status = Status.Reclaimed;
        emit EscrowReclaimed(orderHash);
        IERC20(h.asset).safeTransfer(h.refundTo, h.amount);
    }

    /// @notice Full hold record (app reads via this view, not log scans — ADR-0012).
    function getHold(bytes32 orderHash) external view returns (Hold memory) {
        return _holds[orderHash];
    }

    function statusOf(bytes32 orderHash) external view returns (Status) {
        return _holds[orderHash].status;
    }

    /// @dev Load a hold that MUST be in `Held` (fail-closed): missing → NoHold; terminal → NotHeld.
    function _held(bytes32 orderHash) private view returns (Hold storage h) {
        h = _holds[orderHash];
        if (h.status == Status.None) revert NoHold();
        if (h.status != Status.Held) revert NotHeld();
    }
}
