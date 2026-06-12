// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/mocks/MockUSDC.sol";

/// @notice Spec 272 PAY-CON-3 — MockUSDC faucet + EIP-3009 (present for Wave-5 interop; unused in W1).
contract MockUSDCTest is Test {
    MockUSDC internal usdc;
    uint256 internal constant FROM_PK = 0xA11CE;
    address internal from;
    address internal constant TO = address(0x7EEA);

    function setUp() public {
        usdc = new MockUSDC();
        from = vm.addr(FROM_PK);
        usdc.mint(from, 1_000_000);
        vm.warp(1_000_000); // non-zero time so validAfter checks are meaningful
    }

    function test_decimalsAndFaucet() public {
        assertEq(usdc.decimals(), 6);
        vm.prank(TO);
        usdc.faucet(500);
        assertEq(usdc.balanceOf(TO), 500);
    }

    function _sign(uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (bytes memory sig)
    {
        bytes32 structHash = keccak256(
            abi.encode(usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), from, TO, value, validAfter, validBefore, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(FROM_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_transferWithAuthorization_valid() public {
        bytes32 nonce = keccak256("n1");
        bytes memory sig = _sign(1000, 0, block.timestamp + 100, nonce);
        usdc.transferWithAuthorization(from, TO, 1000, 0, block.timestamp + 100, nonce, sig);
        assertEq(usdc.balanceOf(TO), 1000);
        assertTrue(usdc.authorizationState(from, nonce));
    }

    function test_transferWithAuthorization_replayReverts() public {
        bytes32 nonce = keccak256("n1");
        bytes memory sig = _sign(1000, 0, block.timestamp + 100, nonce);
        usdc.transferWithAuthorization(from, TO, 1000, 0, block.timestamp + 100, nonce, sig);
        vm.expectRevert(MockUSDC.AuthUsedOrCanceled.selector);
        usdc.transferWithAuthorization(from, TO, 1000, 0, block.timestamp + 100, nonce, sig);
    }

    function test_transferWithAuthorization_expiredReverts() public {
        bytes32 nonce = keccak256("n2");
        uint256 validBefore = block.timestamp + 10;
        bytes memory sig = _sign(1000, 0, validBefore, nonce);
        vm.warp(validBefore + 1);
        vm.expectRevert(MockUSDC.AuthExpired.selector);
        usdc.transferWithAuthorization(from, TO, 1000, 0, validBefore, nonce, sig);
    }

    function test_transferWithAuthorization_badSigReverts() public {
        bytes32 nonce = keccak256("n3");
        bytes memory sig = _sign(1000, 0, block.timestamp + 100, nonce);
        vm.expectRevert(MockUSDC.InvalidSignature.selector);
        usdc.transferWithAuthorization(from, TO, 999, 0, block.timestamp + 100, nonce, sig); // value tampered
    }

    function test_cancelAuthorization() public {
        bytes32 nonce = keccak256("n4");
        bytes32 structHash = keccak256(abi.encode(usdc.CANCEL_AUTHORIZATION_TYPEHASH(), from, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(FROM_PK, digest);
        usdc.cancelAuthorization(from, nonce, abi.encodePacked(r, s, v));
        assertTrue(usdc.authorizationState(from, nonce));
    }
}
