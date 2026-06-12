// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../src/enforcers/PaymentEnforcer.sol";
import "../src/payments/PaymentReceiptRegistry.sol";

/// @notice Spec 272 PAY-CON-1 — the x402 PaymentEnforcer + PaymentReceiptRegistry. Unit tests the
///         `beforeHook` gate directly (the DelegationManager just forwards (target,value,callData)),
///         covering the §11 security checklist: transfer-only calldata, caps, window, replay, fail-closed.
contract PaymentEnforcerTest is Test {
    PaymentEnforcer internal enf;
    PaymentReceiptRegistry internal registry;

    address internal constant TREASURY = address(0x7EEA);
    address internal constant USDC = address(0x05DC);
    address internal constant DELEGATOR = address(0xDE16);
    address internal constant REDEEMER = address(0xBEEF);
    bytes32 internal constant DHASH = keccak256("delegation-1");

    // defaults: $1.00 max/charge (1e6, 6-dec), $5.00 aggregate, 3 charges / 1h window
    uint256 internal constant MAX_CHARGE = 1_000_000;
    uint256 internal constant MAX_AGG = 5_000_000;
    uint32 internal constant MAX_PER_WINDOW = 3;
    uint32 internal constant WINDOW = 3600;

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

    function setUp() public {
        registry = new PaymentReceiptRegistry();
        enf = new PaymentEnforcer(address(registry));
        registry.setEnforcer(address(enf));
    }

    // ── helpers ──
    function _terms() internal pure returns (bytes memory) {
        return abi.encode(TREASURY, USDC, MAX_CHARGE, MAX_AGG, MAX_PER_WINDOW, WINDOW);
    }

    function _args(uint256 nonceSeed) internal pure returns (bytes memory) {
        return abi.encode(
            keccak256(abi.encode("mandate", nonceSeed)), bytes32(nonceSeed), keccak256(abi.encode("resource", nonceSeed))
        );
    }

    function _transferCd(address to, uint256 amount) internal pure returns (bytes memory) {
        return abi.encodeCall(IERC20.transfer, (to, amount));
    }

    function _charge(uint256 amount, uint256 nonceSeed) internal {
        enf.beforeHook(_terms(), _args(nonceSeed), DHASH, DELEGATOR, REDEEMER, USDC, 0, _transferCd(TREASURY, amount));
    }

    // ── happy path + receipt ──

    function test_validCharge_passes_emits_records() public {
        // Don't assert the derived mandateId topic; check payer + payee indexed topics.
        vm.expectEmit(false, true, true, false, address(registry));
        emit PaymentSettled(bytes32(0), DELEGATOR, TREASURY, USDC, 0, bytes32(0), DHASH, bytes32(0));
        _charge(MAX_CHARGE, 1);

        (uint256 spent,, uint32 calls) = enf.getBudget(DELEGATOR, DHASH);
        assertEq(spent, MAX_CHARGE);
        assertEq(calls, 1);
        assertTrue(enf.isNonceUsed(DELEGATOR, DHASH, bytes32(uint256(1))));
    }

    // ── terms validation (fail-closed) ──

    function test_reverts_zeroTreasury() public {
        bytes memory t = abi.encode(address(0), USDC, MAX_CHARGE, MAX_AGG, MAX_PER_WINDOW, WINDOW);
        vm.expectRevert(PaymentEnforcer.InvalidTerms.selector);
        enf.beforeHook(t, _args(1), DHASH, DELEGATOR, REDEEMER, USDC, 0, _transferCd(TREASURY, 1));
    }

    function test_reverts_aggregateLessThanPerCharge() public {
        bytes memory t = abi.encode(TREASURY, USDC, MAX_CHARGE, MAX_CHARGE - 1, MAX_PER_WINDOW, WINDOW);
        vm.expectRevert(PaymentEnforcer.InvalidTerms.selector);
        enf.beforeHook(t, _args(1), DHASH, DELEGATOR, REDEEMER, USDC, 0, _transferCd(TREASURY, 1));
    }

    function test_reverts_zeroWindowOrFreq() public {
        bytes memory t = abi.encode(TREASURY, USDC, MAX_CHARGE, MAX_AGG, uint32(0), WINDOW);
        vm.expectRevert(PaymentEnforcer.InvalidTerms.selector);
        enf.beforeHook(t, _args(1), DHASH, DELEGATOR, REDEEMER, USDC, 0, _transferCd(TREASURY, 1));
    }

    function test_reverts_wrongTermsLength() public {
        vm.expectRevert(PaymentEnforcer.InvalidTerms.selector);
        enf.beforeHook(abi.encode(TREASURY, USDC), _args(1), DHASH, DELEGATOR, REDEEMER, USDC, 0, _transferCd(TREASURY, 1));
    }

    // ── transfer-only calldata (§163) ──

    function test_reverts_nonZeroValue() public {
        vm.expectRevert(PaymentEnforcer.ValueNotZero.selector);
        enf.beforeHook(_terms(), _args(1), DHASH, DELEGATOR, REDEEMER, USDC, 1, _transferCd(TREASURY, 1));
    }

    function test_reverts_targetNotAsset() public {
        vm.expectRevert(abi.encodeWithSelector(PaymentEnforcer.AssetMismatch.selector, USDC, address(0xBAD)));
        enf.beforeHook(_terms(), _args(1), DHASH, DELEGATOR, REDEEMER, address(0xBAD), 0, _transferCd(TREASURY, 1));
    }

    function test_reverts_transferFrom() public {
        bytes memory cd = abi.encodeCall(IERC20.transferFrom, (DELEGATOR, TREASURY, 1));
        vm.expectRevert(PaymentEnforcer.NotTransferCall.selector);
        enf.beforeHook(_terms(), _args(1), DHASH, DELEGATOR, REDEEMER, USDC, 0, cd);
    }

    function test_reverts_approve() public {
        bytes memory cd = abi.encodeCall(IERC20.approve, (TREASURY, 1));
        vm.expectRevert(PaymentEnforcer.NotTransferCall.selector); // 68 bytes but wrong selector
        enf.beforeHook(_terms(), _args(1), DHASH, DELEGATOR, REDEEMER, USDC, 0, cd);
    }

    function test_reverts_extraArgsSmuggling() public {
        bytes memory cd = bytes.concat(_transferCd(TREASURY, 1), hex"deadbeef"); // 72 bytes
        vm.expectRevert(PaymentEnforcer.NotTransferCall.selector);
        enf.beforeHook(_terms(), _args(1), DHASH, DELEGATOR, REDEEMER, USDC, 0, cd);
    }

    function test_reverts_wrongRecipient() public {
        vm.expectRevert(abi.encodeWithSelector(PaymentEnforcer.WrongRecipient.selector, TREASURY, address(0xBAD)));
        enf.beforeHook(_terms(), _args(1), DHASH, DELEGATOR, REDEEMER, USDC, 0, _transferCd(address(0xBAD), 1));
    }

    function test_reverts_amountOverPerCharge() public {
        vm.expectRevert(abi.encodeWithSelector(PaymentEnforcer.ChargeExceedsMax.selector, MAX_CHARGE + 1, MAX_CHARGE));
        _charge(MAX_CHARGE + 1, 1);
    }

    // ── caps ──

    function test_aggregateCap_enforced() public {
        // 5 charges of $1 = $5 (== MAX_AGG, ok). With MAX_PER_WINDOW=3 we'd hit the freq cap first, so
        // use a fresh delegation per window by advancing time; simplest: raise window cap for this test.
        bytes memory t = abi.encode(TREASURY, USDC, MAX_CHARGE, MAX_AGG, uint32(100), WINDOW);
        for (uint256 i = 1; i <= 5; i++) {
            enf.beforeHook(t, _args(i), DHASH, DELEGATOR, REDEEMER, USDC, 0, _transferCd(TREASURY, MAX_CHARGE));
        }
        // 6th would be $6 > $5
        vm.expectRevert(abi.encodeWithSelector(PaymentEnforcer.AggregateExceeded.selector, MAX_AGG, MAX_AGG, MAX_CHARGE));
        enf.beforeHook(t, _args(6), DHASH, DELEGATOR, REDEEMER, USDC, 0, _transferCd(TREASURY, MAX_CHARGE));
    }

    function test_frequencyCap_enforced_and_rolls() public {
        _charge(1, 1);
        _charge(1, 2);
        _charge(1, 3); // 3 in window (== MAX_PER_WINDOW)
        vm.expectRevert(abi.encodeWithSelector(PaymentEnforcer.FrequencyExceeded.selector, MAX_PER_WINDOW, MAX_PER_WINDOW));
        _charge(1, 4);
        // roll the window → resets
        vm.warp(block.timestamp + WINDOW + 1);
        _charge(1, 5);
        (, , uint32 calls) = enf.getBudget(DELEGATOR, DHASH);
        assertEq(calls, 1);
    }

    // ── replay ──

    function test_nonceReplay_reverts() public {
        _charge(1, 1);
        vm.expectRevert(abi.encodeWithSelector(PaymentEnforcer.NonceReused.selector, bytes32(uint256(1))));
        _charge(1, 1); // same nonce seed
    }

    // ── per-delegation isolation ──

    function test_budgetIsolatedPerDelegation() public {
        _charge(MAX_CHARGE, 1); // delegation DHASH
        bytes32 other = keccak256("delegation-2");
        // a fresh delegation starts at zero budget + nonce 1 is free again under it
        enf.beforeHook(_terms(), _args(1), other, DELEGATOR, REDEEMER, USDC, 0, _transferCd(TREASURY, MAX_CHARGE));
        (uint256 spent,,) = enf.getBudget(DELEGATOR, other);
        assertEq(spent, MAX_CHARGE);
    }
}

/// @notice PaymentReceiptRegistry access control.
contract PaymentReceiptRegistryTest is Test {
    PaymentReceiptRegistry internal registry;

    function setUp() public {
        registry = new PaymentReceiptRegistry();
    }

    function test_onlyEnforcerCanRecord() public {
        registry.setEnforcer(address(0xE1F));
        vm.expectRevert(PaymentReceiptRegistry.NotEnforcer.selector);
        registry.record(bytes32(0), address(1), address(2), address(3), 0, bytes32(0), bytes32(0), bytes32(0));
    }

    function test_setEnforcer_onceOnly() public {
        registry.setEnforcer(address(0xE1F));
        vm.expectRevert(PaymentReceiptRegistry.EnforcerAlreadySet.selector);
        registry.setEnforcer(address(0xE2F));
    }

    function test_setEnforcer_onlyOwner() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(PaymentReceiptRegistry.NotOwner.selector);
        registry.setEnforcer(address(0xE1F));
    }
}
