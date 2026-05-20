// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import "../src/SmartAgentPaymaster.sol";
import "../src/governance/IGovernance.sol";

/// Minimal governance stub for testing — exposes isPaused().
contract MockGovernance {
    bool public isPaused;
    function setPaused(bool p) external { isPaused = p; }
    function isSigner(address) external pure returns (bool) { return false; }
}

contract SmartAgentPaymasterTest is Test {
    EntryPoint internal ep;
    SmartAgentPaymaster internal pm;
    MockGovernance internal gov;

    address internal deployer = address(0xD1);
    address internal someSender = address(0x1234);

    function setUp() public {
        ep = new EntryPoint();
        gov = new MockGovernance();
        vm.prank(deployer);
        pm = new SmartAgentPaymaster(IEntryPoint(address(ep)), deployer, address(gov));
    }

    // ─── Construction ───────────────────────────────────────────────

    function test_ships_in_dev_mode() public view {
        assertTrue(pm.devMode());
    }

    function test_governance_address_stored() public view {
        assertEq(pm.governance(), address(gov));
    }

    function test_rejects_zero_governance() public {
        vm.expectRevert(SmartAgentPaymaster.ZeroGovernance.selector);
        new SmartAgentPaymaster(IEntryPoint(address(ep)), deployer, address(0));
    }

    function test_owner_is_initial_deployer() public view {
        assertEq(pm.owner(), deployer);
    }

    // ─── Allow-list state (production-mode prerequisites) ──────────

    function test_setDevMode_toggles_flag() public {
        vm.prank(address(gov));
        pm.setDevMode(false);
        assertFalse(pm.devMode());
    }

    function test_isAccepted_starts_false_for_random_address() public view {
        assertFalse(pm.isAccepted(someSender));
    }

    function test_setAccepted_marks_sender() public {
        vm.prank(address(gov));
        pm.setAccepted(someSender, true);
        assertTrue(pm.isAccepted(someSender));
    }

    function test_setAcceptedBatch_marks_all() public {
        address[] memory senders = new address[](3);
        senders[0] = address(0x1);
        senders[1] = address(0x2);
        senders[2] = address(0x3);
        vm.prank(address(gov));
        pm.setAcceptedBatch(senders, true);
        assertTrue(pm.isAccepted(address(0x1)));
        assertTrue(pm.isAccepted(address(0x2)));
        assertTrue(pm.isAccepted(address(0x3)));
    }

    // ─── Governance gating ─────────────────────────────────────────

    function test_setDevMode_requires_governance() public {
        vm.expectRevert(SmartAgentPaymaster.NotGovernance.selector);
        pm.setDevMode(false);
    }

    function test_setAccepted_requires_governance() public {
        vm.expectRevert(SmartAgentPaymaster.NotGovernance.selector);
        pm.setAccepted(someSender, true);
    }

    function test_setAcceptedBatch_requires_governance() public {
        address[] memory senders = new address[](1);
        senders[0] = someSender;
        vm.expectRevert(SmartAgentPaymaster.NotGovernance.selector);
        pm.setAcceptedBatch(senders, true);
    }

    function test_setDevMode_emits_event() public {
        vm.prank(address(gov));
        vm.expectEmit(false, false, false, true);
        emit SmartAgentPaymaster.DevModeSet(false);
        pm.setDevMode(false);
    }

    function test_setAccepted_emits_event() public {
        vm.prank(address(gov));
        vm.expectEmit(true, false, false, true);
        emit SmartAgentPaymaster.SenderAcceptedSet(someSender, true);
        pm.setAccepted(someSender, true);
    }

    // ─── Stake / Deposit (BasePaymaster surface) ───────────────────

    function test_can_addStake_and_deposit() public {
        vm.deal(deployer, 1 ether);
        vm.startPrank(deployer);
        pm.addStake{value: 0.1 ether}(1 days);
        pm.deposit{value: 0.5 ether}();
        vm.stopPrank();
        assertEq(pm.getDeposit(), 0.5 ether);
    }

    function test_addStake_records_stake_on_entryPoint() public {
        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        pm.addStake{value: 0.1 ether}(1 days);
        // EntryPoint records the stake; lookup via getDepositInfo.
        IEntryPoint.DepositInfo memory info = ep.getDepositInfo(address(pm));
        assertEq(info.stake, 0.1 ether);
    }
}
