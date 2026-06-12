// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../agency/ICaveatEnforcer.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPaymentReceiptRegistry {
    function record(
        bytes32 mandateId,
        address payer,
        address payee,
        address asset,
        uint256 amount,
        bytes32 resourceHash,
        bytes32 delegationHash,
        bytes32 nonce
    ) external;
}

/**
 * @title PaymentEnforcer
 * @notice x402 pay-per-use caveat enforcer (spec 272, PAY-CON-1). Constrains a redeemed PAYMENT
 *         delegation to EXACTLY a capped `IERC20.transfer(treasury, amount)`, with a per-delegation
 *         aggregate spend cap, a windowed frequency cap, and a single-use nonce (on-chain replay
 *         guard). Fuses smart-agent's AllocationLimit (spend) + RateLimit (window) into one
 *         `beforeHook` so spend, frequency, and binding are checked ATOMICALLY — a charge that passes
 *         the rate limit but busts the budget reverts the whole redemption as a unit (spec §2 divergence).
 *
 * @dev    terms = abi.encode(
 *           address treasury, address asset, uint256 maxAmountPerCharge,
 *           uint256 maxAggregate, uint32 maxRedemptionsPerWindow, uint32 windowSeconds)   // 192 bytes
 *         args  = abi.encode(bytes32 mandateId, bytes32 nonce, bytes32 resourceHash)
 *
 *         State is keyed [delegator][delegationHash] so sibling delegations never cross-interfere
 *         (a redeemer can't bypass the cap by re-anchoring under a different delegation).
 *
 *         Fail-closed (spec §9): wrong/zero asset or treasury, non-`transfer` calldata, wrong
 *         recipient/amount, ANY cap breach, or a reused nonce reverts and blocks the whole
 *         `DelegationManager.redeemDelegation`. The state SSTOREs are atomic with the underlying
 *         transfer — if Phase-2 execution reverts, the budget/nonce writes revert with it.
 *
 *         `transfer`-only by construction (spec §163): `target == asset` rejects multicall/router
 *         targets; the 68-byte length + selector check rejects `transferFrom`/`approve`/extra-arg
 *         smuggling; `value == 0` rejects ETH; the DelegationManager's single (target,value,data)
 *         redemption shape rejects batch/delegatecall.
 */
contract PaymentEnforcer is ICaveatEnforcer {
    bytes4 private constant TRANSFER_SELECTOR = IERC20.transfer.selector; // 0xa9059cbb

    struct Budget {
        uint256 spent; // cumulative against maxAggregate
        uint64 windowStart; // start of the current frequency window
        uint32 callsInWindow; // redemptions so far in the current window
    }

    /// delegator => delegationHash => budget/window state
    mapping(address => mapping(bytes32 => Budget)) private _budgets;
    /// delegator => delegationHash => nonce => consumed (on-chain replay guard)
    mapping(address => mapping(bytes32 => mapping(bytes32 => bool))) private _nonceUsed;

    /// @notice Trustless receipt sink (PAY-CON-4). Immutable; `address(0)` disables registry receipts
    ///         (the `PaymentCharged` event below is always the primary on-chain receipt).
    IPaymentReceiptRegistry public immutable receiptRegistry;

    event PaymentCharged(
        address indexed delegator,
        bytes32 indexed delegationHash,
        bytes32 indexed mandateId,
        address treasury,
        address asset,
        uint256 amount,
        bytes32 nonce,
        bytes32 resourceHash,
        uint256 totalSpent,
        uint32 callsInWindow
    );

    error InvalidTerms();
    error ValueNotZero();
    error AssetMismatch(address expectedAsset, address target);
    error NotTransferCall();
    error WrongRecipient(address treasury, address to);
    error ChargeExceedsMax(uint256 amount, uint256 maxAmountPerCharge);
    error AggregateExceeded(uint256 spent, uint256 maxAggregate, uint256 amount);
    error FrequencyExceeded(uint32 callsInWindow, uint32 maxRedemptionsPerWindow);
    error NonceReused(bytes32 nonce);

    constructor(address receiptRegistry_) {
        receiptRegistry = IPaymentReceiptRegistry(receiptRegistry_);
    }

    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 delegationHash,
        address delegator,
        address, /*redeemer*/
        address target,
        uint256 value,
        bytes calldata callData
    ) external override {
        // ── terms (immutable, set at delegation creation) ──
        if (terms.length != 192) revert InvalidTerms();
        (
            address treasury,
            address asset,
            uint256 maxPerCharge,
            uint256 maxAggregate,
            uint32 maxPerWindow,
            uint32 windowSeconds
        ) = abi.decode(terms, (address, address, uint256, uint256, uint32, uint32));
        if (
            treasury == address(0) || asset == address(0) || maxPerCharge == 0 || maxAggregate < maxPerCharge
                || maxPerWindow == 0 || windowSeconds == 0
        ) {
            revert InvalidTerms();
        }

        // ── calldata MUST be exactly IERC20.transfer(treasury, amount): single call, no ETH ──
        if (value != 0) revert ValueNotZero();
        if (target != asset) revert AssetMismatch(asset, target);
        if (callData.length != 68) revert NotTransferCall(); // 4 + 32 + 32; rejects transferFrom/approve/extra args
        if (bytes4(callData[0:4]) != TRANSFER_SELECTOR) revert NotTransferCall();
        (address to, uint256 amount) = abi.decode(callData[4:], (address, uint256));
        if (to != treasury) revert WrongRecipient(treasury, to);
        if (amount > maxPerCharge) revert ChargeExceedsMax(amount, maxPerCharge);

        // ── replay: single-use nonce per delegation (on-chain idempotency, PAY-RAIL-4) ──
        (bytes32 mandateId, bytes32 nonce, bytes32 resourceHash) = abi.decode(args, (bytes32, bytes32, bytes32));
        if (_nonceUsed[delegator][delegationHash][nonce]) revert NonceReused(nonce);
        _nonceUsed[delegator][delegationHash][nonce] = true;

        Budget storage b = _budgets[delegator][delegationHash];

        // ── aggregate spend cap (port AllocationLimitEnforcer) ──
        uint256 nextSpent = b.spent + amount;
        if (nextSpent > maxAggregate) revert AggregateExceeded(b.spent, maxAggregate, amount);

        // ── windowed frequency cap; roll on expiry (port RateLimitEnforcer) ──
        uint64 nowTs = uint64(block.timestamp);
        if (b.windowStart == 0 || nowTs >= b.windowStart + windowSeconds) {
            b.windowStart = nowTs;
            b.callsInWindow = 0;
        }
        uint32 nextCalls = b.callsInWindow + 1;
        if (nextCalls > maxPerWindow) revert FrequencyExceeded(b.callsInWindow, maxPerWindow);

        b.spent = nextSpent;
        b.callsInWindow = nextCalls;

        emit PaymentCharged(
            delegator, delegationHash, mandateId, treasury, asset, amount, nonce, resourceHash, nextSpent, nextCalls
        );

        // Trustless settlement receipt (PAY-CON-4). Reverting here reverts the whole redemption, so a
        // settled charge always has a receipt and an unsettled one never does (atomic).
        if (address(receiptRegistry) != address(0)) {
            receiptRegistry.record(mandateId, delegator, treasury, asset, amount, resourceHash, delegationHash, nonce);
        }
    }

    function afterHook(bytes calldata, bytes calldata, bytes32, address, address, address, uint256, bytes calldata)
        external
        pure
        override
    {}

    // ── views (off-chain budget display + idempotency checks) ──

    function getBudget(address delegator, bytes32 delegationHash)
        external
        view
        returns (uint256 spent, uint64 windowStart, uint32 callsInWindow)
    {
        Budget storage b = _budgets[delegator][delegationHash];
        return (b.spent, b.windowStart, b.callsInWindow);
    }

    function isNonceUsed(address delegator, bytes32 delegationHash, bytes32 nonce) external view returns (bool) {
        return _nonceUsed[delegator][delegationHash][nonce];
    }

    /// @notice Encode the immutable caveat terms (mirrors `delegation.buildPaymentMandateCaveats`).
    function encodeTerms(
        address treasury,
        address asset,
        uint256 maxAmountPerCharge,
        uint256 maxAggregate,
        uint32 maxRedemptionsPerWindow,
        uint32 windowSeconds
    ) external pure returns (bytes memory) {
        return abi.encode(treasury, asset, maxAmountPerCharge, maxAggregate, maxRedemptionsPerWindow, windowSeconds);
    }
}
