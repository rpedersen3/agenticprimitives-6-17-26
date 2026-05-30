// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/ApprovedHashRegistry.sol";

contract ApprovedHashRegistryTest is Test {
    ApprovedHashRegistry internal reg;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    bytes32 internal hashA = keccak256("hash-A");
    bytes32 internal hashB = keccak256("hash-B");

    function setUp() public {
        reg = new ApprovedHashRegistry();
    }

    function test_approve_then_isApproved_true() public {
        vm.prank(alice);
        reg.approveHash(hashA);
        assertTrue(reg.isApproved(alice, hashA));
    }

    function test_unapproved_isApproved_false() public view {
        assertFalse(reg.isApproved(alice, hashA));
    }

    function test_approve_is_per_signer_not_global() public {
        vm.prank(alice);
        reg.approveHash(hashA);
        // Bob did not approve; even the same hash returns false for bob.
        assertFalse(reg.isApproved(bob, hashA));
    }

    function test_approve_is_per_hash_not_blanket() public {
        vm.prank(alice);
        reg.approveHash(hashA);
        assertTrue(reg.isApproved(alice, hashA));
        assertFalse(reg.isApproved(alice, hashB));
    }

    function test_revoke_clears_approval() public {
        vm.startPrank(alice);
        reg.approveHash(hashA);
        assertTrue(reg.isApproved(alice, hashA));
        reg.revokeHash(hashA);
        assertFalse(reg.isApproved(alice, hashA));
        vm.stopPrank();
    }

    function test_approve_emits_event() public {
        vm.expectEmit(true, true, false, false);
        emit ApprovedHashRegistry.HashApproved(alice, hashA);
        vm.prank(alice);
        reg.approveHash(hashA);
    }

    function test_revoke_emits_event() public {
        vm.startPrank(alice);
        reg.approveHash(hashA);
        vm.expectEmit(true, true, false, false);
        emit ApprovedHashRegistry.HashRevoked(alice, hashA);
        reg.revokeHash(hashA);
        vm.stopPrank();
    }

    function test_double_approve_is_idempotent() public {
        vm.startPrank(alice);
        reg.approveHash(hashA);
        reg.approveHash(hashA);
        assertTrue(reg.isApproved(alice, hashA));
        vm.stopPrank();
    }

    function test_revoke_without_approval_is_noop() public {
        // Calling revokeHash on a never-approved hash should not revert
        // and leave state false.
        vm.prank(alice);
        reg.revokeHash(hashA);
        assertFalse(reg.isApproved(alice, hashA));
    }
}
