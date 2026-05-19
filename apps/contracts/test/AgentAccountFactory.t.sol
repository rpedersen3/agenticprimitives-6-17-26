// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/DelegationManager.sol";

contract AgentAccountFactoryTest is Test {
    AgentAccountFactory factory;
    DelegationManager dm;

    address internal owner = address(0xAA);
    address internal bundlerSigner = address(0xBB);
    address internal sessionIssuer = address(0xCC);
    address internal governance = address(0xDD);

    function setUp() public {
        EntryPoint ep = new EntryPoint();
        dm = new DelegationManager();
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            bundlerSigner,
            sessionIssuer,
            governance
        );
    }

    function test_getAddress_is_deterministic_pure_function() public view {
        address a1 = factory.getAddress(owner, 0);
        address a2 = factory.getAddress(owner, 0);
        assertEq(a1, a2);
    }

    function test_getAddress_changes_with_salt() public view {
        address a1 = factory.getAddress(owner, 0);
        address a2 = factory.getAddress(owner, 1);
        assertTrue(a1 != a2);
    }

    function test_getAddress_changes_with_owner() public view {
        address a1 = factory.getAddress(owner, 0);
        address a2 = factory.getAddress(address(0x99), 0);
        assertTrue(a1 != a2);
    }

    function test_createAccount_deploys_at_predicted_address() public {
        address predicted = factory.getAddress(owner, 7);
        assertEq(predicted.code.length, 0, "should not be deployed yet");
        AgentAccount acct = factory.createAccount(owner, 7);
        assertEq(address(acct), predicted, "deployed address must match prediction");
        assertGt(predicted.code.length, 0, "should now have code");
    }

    function test_createAccount_is_idempotent() public {
        AgentAccount a1 = factory.createAccount(owner, 8);
        AgentAccount a2 = factory.createAccount(owner, 8);
        assertEq(address(a1), address(a2), "second call returns same instance");
    }

    function test_createAccount_emits_event() public {
        address predicted = factory.getAddress(owner, 9);
        vm.expectEmit(true, true, false, true);
        emit AgentAccountFactory.AgentAccountCreated(predicted, owner, 9);
        factory.createAccount(owner, 9);
    }

    function test_factory_exposes_capability_roles() public view {
        assertEq(factory.bundlerSigner(), bundlerSigner);
        assertEq(factory.sessionIssuer(), sessionIssuer);
        assertEq(factory.delegationManager(), address(dm));
    }

    function test_setBundlerSigner_requires_governance() public {
        vm.expectRevert();
        factory.setBundlerSigner(address(0xFF));
    }

    function test_setBundlerSigner_succeeds_under_governance() public {
        vm.prank(governance);
        factory.setBundlerSigner(address(0xFF));
        assertEq(factory.bundlerSigner(), address(0xFF));
    }

    function test_setSessionIssuer_requires_governance() public {
        vm.expectRevert();
        factory.setSessionIssuer(address(0xEE));
    }

    function test_setSessionIssuer_succeeds_under_governance() public {
        vm.prank(governance);
        factory.setSessionIssuer(address(0xEE));
        assertEq(factory.sessionIssuer(), address(0xEE));
    }

    function test_setBundlerSigner_emits_event() public {
        vm.expectEmit(true, true, false, false);
        emit AgentAccountFactory.BundlerSignerChanged(bundlerSigner, address(0xFF));
        vm.prank(governance);
        factory.setBundlerSigner(address(0xFF));
    }
}
