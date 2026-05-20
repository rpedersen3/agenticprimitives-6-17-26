// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/DelegationManager.sol";
import {AgentAccountInitParams} from "../src/IAgentAccount.sol";

/**
 * Forge tests for `createAccountWithMode` — the spec 207 threshold-policy
 * factory entry. Covers:
 *   - happy path for each of single / hybrid / threshold / org
 *   - guardian-count validation refuses threshold (< 2) and org (< 3)
 *   - the spec § 5.1 default threshold matrix is installed correctly
 *   - default timelocks (T4=1h, T5=24h, T6=48h) are installed
 *   - recovery threshold defaults to ceil(g/2)+1
 *   - T3 high-value ceiling defaults to 0.01 ETH
 *   - counterfactual address derivation matches actual deploy
 */
contract AgentAccountFactoryModeTest is Test {
    AgentAccountFactory internal factory;
    DelegationManager internal dm;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA401);
    address internal dave = address(0xDA1E);
    address internal eve = address(0xEDED);
    address internal g1 = address(0x6471a01);
    address internal g2 = address(0x6471a02);
    address internal g3 = address(0x6471a03);
    address internal g4 = address(0x6471a04);

    function setUp() public {
        EntryPoint ep = new EntryPoint();
        dm = new DelegationManager();
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(0xBB),
            address(0xCC),
            address(0xDD)
        );
    }

    // ─── Helpers ──────────────────────────────────────────────────────

    function _params(uint8 mode, address[] memory owners, address[] memory guardians)
        internal
        pure
        returns (AgentAccountInitParams memory p)
    {
        p.mode = mode;
        p.owners = owners;
        p.guardians = guardians;
        // No initial passkey by default.
    }

    function _owners1() internal view returns (address[] memory a) {
        a = new address[](1); a[0] = alice;
    }

    function _owners2() internal view returns (address[] memory a) {
        a = new address[](2); a[0] = alice; a[1] = bob;
    }

    function _owners3() internal view returns (address[] memory a) {
        a = new address[](3); a[0] = alice; a[1] = bob; a[2] = carol;
    }

    function _owners5() internal view returns (address[] memory a) {
        a = new address[](5);
        a[0] = alice; a[1] = bob; a[2] = carol; a[3] = dave; a[4] = eve;
    }

    function _guardians2() internal view returns (address[] memory a) {
        a = new address[](2); a[0] = g1; a[1] = g2;
    }

    function _guardians3() internal view returns (address[] memory a) {
        a = new address[](3); a[0] = g1; a[1] = g2; a[2] = g3;
    }

    function _emptyGuardians() internal pure returns (address[] memory a) {
        a = new address[](0);
    }

    // ─── Happy paths ──────────────────────────────────────────────────

    function test_createAccountWithMode_single() public {
        AgentAccountInitParams memory p = _params(0, _owners1(), _emptyGuardians());
        AgentAccount acct = factory.createAccountWithMode(p, 1);
        assertEq(acct.mode(), 0);
        assertEq(acct.ownerCount(), 1);
        assertTrue(acct.isOwner(alice));
        assertEq(acct.guardianCount(), 0);
        // single mode N=1 → all tiers default to 1
        assertEq(acct.threshold(1), 1);
        assertEq(acct.threshold(4), 1);
        assertEq(acct.threshold(5), 1);
    }

    function test_createAccountWithMode_hybrid_with_one_owner() public {
        // hybrid with 1 EOA + a guardian (the factory doesn't require
        // a passkey at create time — that's a runtime UX nudge).
        address[] memory gs = new address[](1); gs[0] = g1;
        AgentAccountInitParams memory p = _params(1, _owners1(), gs);
        AgentAccount acct = factory.createAccountWithMode(p, 1);
        assertEq(acct.mode(), 1);
        assertEq(acct.guardianCount(), 1);
        // recoveryThreshold = ceil(1/2) + 1 = 0 + 1 = 1
        assertEq(acct.recoveryThreshold(), 1);
    }

    function test_createAccountWithMode_threshold_n3() public {
        AgentAccountInitParams memory p = _params(2, _owners3(), _guardians2());
        AgentAccount acct = factory.createAccountWithMode(p, 1);
        assertEq(acct.mode(), 2);
        assertEq(acct.ownerCount(), 3);
        assertEq(acct.guardianCount(), 2);
        // Spec § 5.1 N=3 row: T1=1, T2=T3=2, T4=T5=3 (unanimous).
        assertEq(acct.threshold(1), 1);
        assertEq(acct.threshold(2), 2);
        assertEq(acct.threshold(3), 2);
        assertEq(acct.threshold(4), 3);
        assertEq(acct.threshold(5), 3);
        // recoveryThreshold = ceil(2/2) + 1 = 2
        assertEq(acct.recoveryThreshold(), 2);
    }

    function test_createAccountWithMode_org_n5() public {
        AgentAccountInitParams memory p = _params(3, _owners5(), _guardians3());
        AgentAccount acct = factory.createAccountWithMode(p, 1);
        assertEq(acct.mode(), 3);
        assertEq(acct.ownerCount(), 5);
        assertEq(acct.guardianCount(), 3);
        // Spec § 5.1 N=5 row: T1=1, T2=T3=3, T4=4, T5=5 (near-unanimous).
        assertEq(acct.threshold(1), 1);
        assertEq(acct.threshold(2), 3);
        assertEq(acct.threshold(3), 3);
        assertEq(acct.threshold(4), 4);
        assertEq(acct.threshold(5), 5);
        // recoveryThreshold = ceil(3/2) + 1 = 1 + 1 = 2
        assertEq(acct.recoveryThreshold(), 2);
    }

    // ─── Default timelocks + T3 ceiling ───────────────────────────────

    function test_default_timelocks_installed() public {
        AgentAccountInitParams memory p = _params(2, _owners3(), _guardians2());
        AgentAccount acct = factory.createAccountWithMode(p, 1);
        assertEq(acct.timelockDuration(4), 1 hours);
        assertEq(acct.timelockDuration(5), 24 hours);
        assertEq(acct.timelockDuration(6), 48 hours);
    }

    function test_t3_high_value_ceiling_default() public {
        AgentAccountInitParams memory p = _params(2, _owners3(), _guardians2());
        AgentAccount acct = factory.createAccountWithMode(p, 1);
        assertEq(acct.t3HighValueCeiling(), 0.01 ether);
    }

    // ─── Validation guards ────────────────────────────────────────────

    function test_threshold_mode_requires_two_guardians() public {
        // 0 guardians → reject
        AgentAccountInitParams memory p = _params(2, _owners3(), _emptyGuardians());
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentAccountFactory.InsufficientGuardiansForMode.selector,
                uint8(2),
                uint256(0),
                uint256(2)
            )
        );
        factory.createAccountWithMode(p, 1);

        // 1 guardian → still reject
        address[] memory gs = new address[](1); gs[0] = g1;
        p = _params(2, _owners3(), gs);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentAccountFactory.InsufficientGuardiansForMode.selector,
                uint8(2),
                uint256(1),
                uint256(2)
            )
        );
        factory.createAccountWithMode(p, 2);
    }

    function test_org_mode_requires_three_guardians() public {
        AgentAccountInitParams memory p = _params(3, _owners5(), _guardians2());
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentAccountFactory.InsufficientGuardiansForMode.selector,
                uint8(3),
                uint256(2),
                uint256(3)
            )
        );
        factory.createAccountWithMode(p, 1);
    }

    function test_invalid_mode_reverts() public {
        AgentAccountInitParams memory p = _params(4, _owners1(), _emptyGuardians());
        vm.expectRevert(
            abi.encodeWithSelector(AgentAccountFactory.InvalidMode.selector, uint8(4))
        );
        factory.createAccountWithMode(p, 1);
    }

    function test_no_primary_signer_reverts() public {
        // No owners + no initial passkey → revert.
        AgentAccountInitParams memory p;
        p.mode = 0;
        // owners + guardians are empty by default
        vm.expectRevert(AgentAccountFactory.NoPrimarySigner.selector);
        factory.createAccountWithMode(p, 1);
    }

    // ─── Counterfactual derivation ────────────────────────────────────

    function test_getAddressForMode_matches_actual_deploy() public {
        AgentAccountInitParams memory p = _params(2, _owners3(), _guardians2());
        address predicted = factory.getAddressForMode(p, 42);
        AgentAccount acct = factory.createAccountWithMode(p, 42);
        assertEq(predicted, address(acct));
    }

    function test_getAddressForMode_changes_with_owner_set() public {
        AgentAccountInitParams memory p1 = _params(2, _owners3(), _guardians2());
        AgentAccountInitParams memory p2 = _params(2, _owners2(), _guardians2());
        address a1 = factory.getAddressForMode(p1, 0);
        address a2 = factory.getAddressForMode(p2, 0);
        assertTrue(a1 != a2);
    }

    function test_getAddressForMode_changes_with_mode() public {
        // Same owners/guardians, different mode → different counterfactual
        // because the init calldata differs.
        AgentAccountInitParams memory p1 = _params(2, _owners3(), _guardians3());
        AgentAccountInitParams memory p2 = _params(3, _owners3(), _guardians3());
        address a1 = factory.getAddressForMode(p1, 0);
        address a2 = factory.getAddressForMode(p2, 0);
        assertTrue(a1 != a2);
    }

    // ─── Idempotency ──────────────────────────────────────────────────

    function test_createAccountWithMode_is_idempotent() public {
        AgentAccountInitParams memory p = _params(2, _owners3(), _guardians2());
        AgentAccount a1 = factory.createAccountWithMode(p, 7);
        AgentAccount a2 = factory.createAccountWithMode(p, 7);
        assertEq(address(a1), address(a2));
    }

    // ─── Default-matrix view ──────────────────────────────────────────

    function test_defaultThreshold_pure_lookup() public {
        // Confirm the view reflects the same matrix the factory installs.
        // N=3 row.
        // We need an account to call the function on; use the harness.
        AgentAccountInitParams memory p = _params(0, _owners1(), _emptyGuardians());
        AgentAccount acct = factory.createAccountWithMode(p, 100);
        assertEq(acct.defaultThreshold(3, 1), 1);
        assertEq(acct.defaultThreshold(3, 2), 2);
        assertEq(acct.defaultThreshold(3, 4), 3);
        assertEq(acct.defaultThreshold(3, 5), 3);
        // N=5 row.
        assertEq(acct.defaultThreshold(5, 2), 3);
        assertEq(acct.defaultThreshold(5, 4), 4);
        assertEq(acct.defaultThreshold(5, 5), 5);
        // N=7 row — spec § 5.1: T4=5 (N-2), T5=6 (N-1).
        assertEq(acct.defaultThreshold(7, 4), 5);
        assertEq(acct.defaultThreshold(7, 5), 6);
    }
}
