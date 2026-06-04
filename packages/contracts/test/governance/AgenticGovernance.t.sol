// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {AgenticGovernance} from "../../src/governance/AgenticGovernance.sol";
import {GovernanceManaged} from "../../src/governance/GovernanceManaged.sol";
import {AgentAccountFactory} from "../../src/AgentAccountFactory.sol";
import {AgentAccount} from "../../src/AgentAccount.sol";
import {DelegationManager} from "../../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../../src/custody/CustodyPolicy.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {AgentAccountInitParams} from "../../src/IAgentAccount.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * H7-C.9 + H7-C.10 (EXT3-009 / EXT3-010) — end-to-end governance + pause
 * regression tests.
 *
 * The tests deploy the same shape as the production Deploy.s.sol script:
 *   TimelockController(24h) ← AgenticGovernance ← GovernanceManaged contracts
 *
 * Then verify:
 *   1. Guardian can pause without delay.
 *   2. Unpause requires the timelock (24h delay).
 *   3. Factory.createAgentAccount reverts when paused.
 *   4. DelegationManager.redeemDelegation reverts when paused.
 *   5. Slow-path roles (setSigner, forwarded execute) require timelock.
 *   6. Non-guardian cannot pause.
 */
contract AgenticGovernanceTest is Test {
    AgenticGovernance gov;
    TimelockController timelock;
    AgentAccountFactory factory;
    DelegationManager dm;
    CustodyPolicy custodyPolicy;
    EntryPoint entryPoint;

    address deployer = address(0xD3D);
    address guardian = address(0xDA1);
    address attacker = address(0xBAD);

    function setUp() public {
        // ─── Timelock + governance ──
        address[] memory proposers = new address[](1);
        proposers[0] = deployer;
        address[] memory executors = new address[](1);
        executors[0] = deployer;
        timelock = new TimelockController(24 hours, proposers, executors, deployer);

        address[] memory initialSigners = new address[](1);
        initialSigners[0] = deployer;
        gov = new AgenticGovernance(address(timelock), guardian, initialSigners);

        // ─── Production-shaped contracts behind governance ──
        entryPoint = new EntryPoint();
        dm = new DelegationManager(address(gov));
        custodyPolicy = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(entryPoint)),
            address(dm),
            address(custodyPolicy),
            deployer,
            deployer,
            address(gov), address(0)
        );
    }

    // ─── IGovernanceView surface ────────────────────────────────────

    function test_isPaused_defaults_false() public view {
        assertFalse(gov.isPaused());
        assertFalse(factory.paused());
    }

    function test_isSigner_bootstrap_seed() public view {
        assertTrue(gov.isSigner(deployer));
        assertFalse(gov.isSigner(attacker));
    }

    // ─── Guardian pause / unpause ───────────────────────────────────

    function test_guardian_can_pause_without_delay() public {
        vm.prank(guardian);
        gov.pause();
        assertTrue(gov.isPaused());
        assertTrue(factory.paused());
    }

    function test_non_guardian_cannot_pause() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AgenticGovernance.NotGuardian.selector, attacker));
        gov.pause();
    }

    function test_guardian_cannot_unpause_alone() public {
        vm.prank(guardian);
        gov.pause();
        // Guardian tries to unpause — refused; unpause needs timelock.
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(AgenticGovernance.NotTimelock.selector, guardian));
        gov.unpause();
    }

    function test_timelock_can_unpause() public {
        vm.prank(guardian);
        gov.pause();
        // Simulate the timelock executing an unpause after the 24h delay
        // (the timelock would `gov.unpause()` from its address).
        vm.prank(address(timelock));
        gov.unpause();
        assertFalse(gov.isPaused());
    }

    // ─── Factory pause gate (C10) ───────────────────────────────────

    function test_factory_createAgentAccount_reverts_when_paused() public {
        vm.prank(guardian);
        gov.pause();

        address[] memory custodians = new address[](1);
        custodians[0] = deployer;
        AgentAccountInitParams memory p = AgentAccountInitParams({
            mode: 0,
            custodians: custodians,
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0,
            initialPasskeyRpIdHash: bytes32(uint256(0x7270696468617368))
        });
        uint32[7] memory tl;
        vm.expectRevert(GovernanceManaged.SystemPaused.selector);
        factory.createAgentAccount(p, tl, 1);
    }

    function test_factory_createAgentAccount_works_when_unpaused() public {
        // Sanity: clean path still works (no pause set).
        address[] memory custodians = new address[](1);
        custodians[0] = deployer;
        AgentAccountInitParams memory p = AgentAccountInitParams({
            mode: 0,
            custodians: custodians,
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0,
            initialPasskeyRpIdHash: bytes32(uint256(0x7270696468617368))
        });
        uint32[7] memory tl;
        AgentAccount a = factory.createAgentAccount(p, tl, 2);
        assertTrue(address(a) != address(0));
    }

    // ─── DelegationManager pause gate (C10) ─────────────────────────

    function test_redeemDelegation_reverts_when_paused() public {
        vm.prank(guardian);
        gov.pause();
        // No need for real delegation — the pause check fires before any
        // delegation validation. Pass an empty array; we expect SystemPaused
        // before the EmptyChain error.
        DelegationManager.Delegation[] memory dels = new DelegationManager.Delegation[](0);
        vm.expectRevert(DelegationManager.SystemPaused.selector);
        dm.redeemDelegation(dels, address(0), 0, "");
    }

    // ─── Slow-path governance (timelock-only) ───────────────────────

    function test_non_timelock_cannot_setSigner() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AgenticGovernance.NotTimelock.selector, attacker));
        gov.setSigner(attacker, true);
    }

    function test_timelock_can_setSigner() public {
        address newSigner = address(0xBABE);
        vm.prank(address(timelock));
        gov.setSigner(newSigner, true);
        assertTrue(gov.isSigner(newSigner));
    }

    function test_non_timelock_cannot_forwarded_execute() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AgenticGovernance.NotTimelock.selector, attacker));
        gov.execute(address(factory), abi.encodeWithSignature("setBundlerSigner(address)", attacker), 0);
    }

    function test_timelock_forwarded_execute_against_factory() public {
        // The timelock routes a governance call (setBundlerSigner) through
        // gov.execute. Factory sees msg.sender == address(gov) and accepts.
        address newSigner = address(0xCAFE);
        vm.prank(address(timelock));
        gov.execute(
            address(factory),
            abi.encodeWithSignature("setBundlerSigner(address)", newSigner),
            0
        );
        assertEq(factory.bundlerSigner(), newSigner);
    }
}
