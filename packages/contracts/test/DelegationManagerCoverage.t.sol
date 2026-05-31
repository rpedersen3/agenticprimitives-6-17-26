// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {DelegationManager} from "../src/agency/DelegationManager.sol";
import {IDelegationManager} from "../src/agency/IDelegationManager.sol";

/**
 * H7-D.2 — DelegationManager negative + edge coverage.
 *
 * Targets the lowest-covered paths:
 *   - revokeDelegation(bytes32) legacy path (always reverts).
 *   - revokeDelegationByOwner authorization gate.
 *   - redeemDelegation EmptyChain reject.
 *   - hashDelegation determinism + variation across fields.
 *   - SystemPaused gate when governance is wired to a pausing contract.
 */
contract DelegationManagerCoverageTest is Test {
    DelegationManager dm;

    function setUp() public {
        // address(0) governance → no pause gate (legacy mode).
        dm = new DelegationManager(address(0));
    }

    // ─── Legacy revocation surface ──────────────────────────────────

    function test_legacy_revokeDelegation_always_reverts() public {
        vm.expectRevert(DelegationManager.LegacyRevocationDisabled.selector);
        dm.revokeDelegation(bytes32(uint256(0xDEAD)));
    }

    function test_redeemDelegation_empty_chain_reverts() public {
        IDelegationManager.Delegation[] memory empty = new IDelegationManager.Delegation[](0);
        vm.expectRevert(DelegationManager.EmptyChain.selector);
        dm.redeemDelegation(empty, address(0), 0, "");
    }

    // ─── revokeDelegationByOwner authorization ──────────────────────

    function test_revokeDelegationByOwner_rejects_random_caller() public {
        // A delegation owned by alice → bob. A random EOA tries to revoke
        // → NotDelegatorOrDelegate.
        IDelegationManager.Delegation memory d = _buildDelegation(
            address(0xA11CE), // delegator
            address(0xB0B),   // delegate
            42
        );
        address attacker = address(0xBAD);
        vm.prank(attacker);
        vm.expectRevert(DelegationManager.NotDelegatorOrDelegate.selector);
        dm.revokeDelegationByOwner(d);
    }

    // ─── hashDelegation determinism + variation ─────────────────────

    function test_hashDelegation_is_deterministic_for_same_inputs() public view {
        IDelegationManager.Delegation memory a = _buildDelegation(address(0x1), address(0x2), 7);
        IDelegationManager.Delegation memory b = _buildDelegation(address(0x1), address(0x2), 7);
        assertEq(dm.hashDelegation(a), dm.hashDelegation(b));
    }

    function test_hashDelegation_changes_with_delegator() public view {
        IDelegationManager.Delegation memory a = _buildDelegation(address(0x1), address(0x2), 7);
        IDelegationManager.Delegation memory b = _buildDelegation(address(0x9), address(0x2), 7);
        assertTrue(dm.hashDelegation(a) != dm.hashDelegation(b));
    }

    function test_hashDelegation_changes_with_delegate() public view {
        IDelegationManager.Delegation memory a = _buildDelegation(address(0x1), address(0x2), 7);
        IDelegationManager.Delegation memory b = _buildDelegation(address(0x1), address(0x9), 7);
        assertTrue(dm.hashDelegation(a) != dm.hashDelegation(b));
    }

    function test_hashDelegation_changes_with_salt() public view {
        IDelegationManager.Delegation memory a = _buildDelegation(address(0x1), address(0x2), 7);
        IDelegationManager.Delegation memory b = _buildDelegation(address(0x1), address(0x2), 8);
        assertTrue(dm.hashDelegation(a) != dm.hashDelegation(b));
    }

    // ─── DOMAIN_SEPARATOR ───────────────────────────────────────────

    function test_DOMAIN_SEPARATOR_is_set() public view {
        bytes32 sep = dm.DOMAIN_SEPARATOR();
        assertTrue(sep != bytes32(0));
    }

    function test_DELEGATION_TYPEHASH_is_a_known_constant() public view {
        // Locks the contract's non-standard EIP-712 type string from
        // DelegationManager.sol:68. CROSS-STACK-001 (open) tracks the
        // divergence from the off-chain DELEGATION_EIP712_TYPES.
        bytes32 expected = keccak256(
            "Delegation(address delegator,address delegate,bytes32 authority,bytes32 caveatsHash,uint256 salt)"
        );
        assertEq(dm.DELEGATION_TYPEHASH(), expected);
    }

    function test_CAVEAT_TYPEHASH_is_a_known_constant() public view {
        bytes32 expected = keccak256("Caveat(address enforcer,bytes terms)");
        assertEq(dm.CAVEAT_TYPEHASH(), expected);
    }

    // ─── ROOT_AUTHORITY + OPEN_DELEGATION sentinels ─────────────────

    function test_ROOT_AUTHORITY_constant() public view {
        assertEq(dm.ROOT_AUTHORITY(), bytes32(type(uint256).max));
    }

    function test_OPEN_DELEGATION_sentinel() public view {
        assertEq(dm.OPEN_DELEGATION(), address(0xa11));
    }

    // ─── Helpers ────────────────────────────────────────────────────

    function _buildDelegation(address delegator, address delegate, uint256 salt)
        internal
        view
        returns (IDelegationManager.Delegation memory)
    {
        IDelegationManager.Caveat[] memory cs = new IDelegationManager.Caveat[](0);
        return IDelegationManager.Delegation({
            delegator: delegator,
            delegate: delegate,
            authority: dm.ROOT_AUTHORITY(),
            caveats: cs,
            salt: salt,
            signature: hex""
        });
    }
}
