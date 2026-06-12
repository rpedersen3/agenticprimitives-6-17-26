// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/payments/PaymentEscrow.sol";
import "../src/mocks/MockUSDC.sol";

/// @notice Spec 243 §5.5 escrow rail (FG-PAY-7) — hold-and-capture lifecycle + adversarial paths.
contract PaymentEscrowTest is Test {
    PaymentEscrow internal escrow;
    MockUSDC internal usdc;

    address internal constant PAYER = address(0xA11CE);
    address internal constant PAYEE = address(0x9A4EE);
    address internal constant RELEASER = address(0x9E1EA);
    address internal constant STRANGER = address(0xBAD);

    bytes32 internal constant ORDER = keccak256("order-1");
    uint256 internal constant AMOUNT = 2_500_000; // $2.50, 6-dec
    uint64 internal expiry;

    event EscrowDeposited(bytes32 indexed orderHash);
    event EscrowReleased(bytes32 indexed orderHash);
    event EscrowRefunded(bytes32 indexed orderHash);
    event EscrowReclaimed(bytes32 indexed orderHash);

    function setUp() public {
        escrow = new PaymentEscrow();
        usdc = new MockUSDC();
        usdc.mint(PAYER, 10_000_000);
        vm.prank(PAYER);
        usdc.approve(address(escrow), type(uint256).max);
        expiry = uint64(block.timestamp + 1 hours);
    }

    function _deposit(address releaser) internal {
        vm.prank(PAYER);
        escrow.deposit(ORDER, address(usdc), AMOUNT, PAYEE, PAYER, releaser, expiry);
    }

    // ── happy paths ────────────────────────────────────────────────

    function test_deposit_pullsFunds_andHolds() public {
        vm.expectEmit(true, false, false, false);
        emit EscrowDeposited(ORDER);
        _deposit(address(0));
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
        assertEq(uint8(escrow.statusOf(ORDER)), uint8(PaymentEscrow.Status.Held));
        PaymentEscrow.Hold memory h = escrow.getHold(ORDER);
        assertEq(h.payer, PAYER);
        assertEq(h.payee, PAYEE);
        assertEq(h.amount, AMOUNT);
    }

    function test_release_capturesToPayee() public {
        _deposit(address(0));
        vm.expectEmit(true, false, false, false);
        emit EscrowReleased(ORDER);
        vm.prank(PAYEE);
        escrow.release(ORDER);
        assertEq(usdc.balanceOf(PAYEE), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.statusOf(ORDER)), uint8(PaymentEscrow.Status.Captured));
    }

    function test_release_byConfiguredReleaser() public {
        _deposit(RELEASER);
        vm.prank(RELEASER);
        escrow.release(ORDER);
        assertEq(usdc.balanceOf(PAYEE), AMOUNT);
    }

    function test_refund_payeeConsented_returnsToPayer() public {
        _deposit(address(0));
        vm.prank(PAYEE);
        escrow.refund(ORDER);
        assertEq(usdc.balanceOf(PAYER), 10_000_000); // got the held amount back
        assertEq(uint8(escrow.statusOf(ORDER)), uint8(PaymentEscrow.Status.Refunded));
    }

    function test_reclaim_afterExpiry_returnsToPayer() public {
        _deposit(address(0));
        vm.warp(expiry + 1);
        vm.prank(PAYER);
        escrow.reclaim(ORDER);
        assertEq(usdc.balanceOf(PAYER), 10_000_000);
        assertEq(uint8(escrow.statusOf(ORDER)), uint8(PaymentEscrow.Status.Reclaimed));
    }

    // ── one terminal path only ─────────────────────────────────────

    function test_doubleRelease_reverts() public {
        _deposit(address(0));
        vm.prank(PAYEE);
        escrow.release(ORDER);
        vm.prank(PAYEE);
        vm.expectRevert(PaymentEscrow.NotHeld.selector);
        escrow.release(ORDER);
    }

    function test_refundAfterRelease_reverts() public {
        _deposit(address(0));
        vm.prank(PAYEE);
        escrow.release(ORDER);
        vm.prank(PAYEE);
        vm.expectRevert(PaymentEscrow.NotHeld.selector);
        escrow.refund(ORDER);
    }

    function test_reclaimAfterRefund_reverts() public {
        _deposit(address(0));
        vm.prank(PAYEE);
        escrow.refund(ORDER);
        vm.warp(expiry + 1);
        vm.prank(PAYER);
        vm.expectRevert(PaymentEscrow.NotHeld.selector);
        escrow.reclaim(ORDER);
    }

    // ── adversarial ────────────────────────────────────────────────

    function test_earlyReclaim_reverts() public {
        _deposit(address(0));
        vm.prank(PAYER);
        vm.expectRevert(PaymentEscrow.NotYetExpired.selector);
        escrow.reclaim(ORDER);
    }

    function test_strangerRelease_reverts() public {
        _deposit(RELEASER);
        vm.prank(STRANGER);
        vm.expectRevert(PaymentEscrow.NotAuthorized.selector);
        escrow.release(ORDER);
    }

    function test_payerCannotRelease_whenNotReleaser() public {
        _deposit(address(0));
        vm.prank(PAYER);
        vm.expectRevert(PaymentEscrow.NotAuthorized.selector);
        escrow.release(ORDER);
    }

    function test_nonPayeeRefund_reverts() public {
        _deposit(address(0));
        vm.prank(STRANGER);
        vm.expectRevert(PaymentEscrow.NotAuthorized.selector);
        escrow.refund(ORDER);
    }

    function test_nonPayerReclaim_reverts() public {
        _deposit(address(0));
        vm.warp(expiry + 1);
        vm.prank(STRANGER);
        vm.expectRevert(PaymentEscrow.NotAuthorized.selector);
        escrow.reclaim(ORDER);
    }

    function test_duplicateDeposit_reverts() public {
        _deposit(address(0));
        vm.prank(PAYER);
        vm.expectRevert(PaymentEscrow.HoldExists.selector);
        escrow.deposit(ORDER, address(usdc), AMOUNT, PAYEE, PAYER, address(0), expiry);
    }

    function test_releaseUnknownOrder_reverts() public {
        vm.prank(PAYEE);
        vm.expectRevert(PaymentEscrow.NoHold.selector);
        escrow.release(keccak256("nope"));
    }

    // ── input validation ───────────────────────────────────────────

    function test_zeroAmount_reverts() public {
        vm.prank(PAYER);
        vm.expectRevert(PaymentEscrow.ZeroAmount.selector);
        escrow.deposit(ORDER, address(usdc), 0, PAYEE, PAYER, address(0), expiry);
    }

    function test_zeroPayee_reverts() public {
        vm.prank(PAYER);
        vm.expectRevert(PaymentEscrow.ZeroAddress.selector);
        escrow.deposit(ORDER, address(usdc), AMOUNT, address(0), PAYER, address(0), expiry);
    }

    function test_pastExpiry_reverts() public {
        vm.prank(PAYER);
        vm.expectRevert(PaymentEscrow.BadExpiry.selector);
        escrow.deposit(ORDER, address(usdc), AMOUNT, PAYEE, PAYER, address(0), uint64(block.timestamp));
    }

    function test_refundToDefaultsToPayer() public {
        vm.prank(PAYER);
        escrow.deposit(ORDER, address(usdc), AMOUNT, PAYEE, address(0), address(0), expiry);
        assertEq(escrow.getHold(ORDER).refundTo, PAYER);
    }
}
