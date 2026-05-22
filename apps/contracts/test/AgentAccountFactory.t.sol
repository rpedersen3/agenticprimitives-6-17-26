// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/agency/DelegationManager.sol";

/// @dev Phase 6f.4 — the factory was collapsed to two entries
///      (`createPersonAgent` + `createMultiSigSmartAgent`). These tests
///      cover deterministic address derivation, idempotency, event
///      emission, and the factory-level capability roles.
///      Tests for `createMultiSigSmartAgent` (CustodyPolicy install)
///      live in `AgentAccountFactoryMode.t.sol`.
contract AgentAccountFactoryTest is Test {
    AgentAccountFactory factory;
    DelegationManager dm;

    address internal owner = address(0xAA);
    address internal bundlerSigner = address(0xBB);
    address internal sessionIssuer = address(0xCC);
    address internal governance = address(0xDD);

    bytes32 internal constant CRED = keccak256("test-credential-id");
    uint256 internal constant PX = uint256(keccak256("test-x"));
    uint256 internal constant PY = uint256(keccak256("test-y"));

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

    function _eoaArr(address a) internal pure returns (address[] memory r) {
        r = new address[](1); r[0] = a;
    }

    function _emptyArr() internal pure returns (address[] memory r) {
        r = new address[](0);
    }

    // ─── createPersonAgent: EOA-only path ─────────────────────────────

    function test_createPersonAgent_eoa_at_predicted_address() public {
        address[] memory custodians = _eoaArr(owner);
        address predicted = factory.getAddressForPersonAgent(custodians, bytes32(0), 0, 0, 7);
        assertEq(predicted.code.length, 0);
        AgentAccount acct = factory.createPersonAgent(custodians, bytes32(0), 0, 0, 7);
        assertEq(address(acct), predicted);
        assertGt(predicted.code.length, 0);
        assertTrue(acct.isCustodian(owner));
        assertEq(acct.custodianCount(), 1);
        assertEq(acct.passkeyCount(), 0);
    }

    function test_createPersonAgent_eoa_idempotent() public {
        address[] memory custodians = _eoaArr(owner);
        AgentAccount a1 = factory.createPersonAgent(custodians, bytes32(0), 0, 0, 8);
        AgentAccount a2 = factory.createPersonAgent(custodians, bytes32(0), 0, 0, 8);
        assertEq(address(a1), address(a2));
    }

    function test_createPersonAgent_address_changes_with_salt() public view {
        address[] memory custodians = _eoaArr(owner);
        address a1 = factory.getAddressForPersonAgent(custodians, bytes32(0), 0, 0, 0);
        address a2 = factory.getAddressForPersonAgent(custodians, bytes32(0), 0, 0, 1);
        assertTrue(a1 != a2);
    }

    function test_createPersonAgent_address_changes_with_custodian() public view {
        address a1 = factory.getAddressForPersonAgent(_eoaArr(owner), bytes32(0), 0, 0, 0);
        address a2 = factory.getAddressForPersonAgent(_eoaArr(address(0x99)), bytes32(0), 0, 0, 0);
        assertTrue(a1 != a2);
    }

    function test_createPersonAgent_emits_event() public {
        address[] memory custodians = _eoaArr(owner);
        address predicted = factory.getAddressForPersonAgent(custodians, bytes32(0), 0, 0, 9);
        vm.expectEmit(true, false, false, true);
        emit AgentAccountFactory.AgentAccountCreated(predicted, /*withValidator=*/ false, 1, /*withPasskey=*/ false, 9);
        factory.createPersonAgent(custodians, bytes32(0), 0, 0, 9);
    }

    // ─── createPersonAgent: passkey-only path ─────────────────────────

    function test_createPersonAgent_passkey_at_predicted_address() public {
        address[] memory empty = _emptyArr();
        address predicted = factory.getAddressForPersonAgent(empty, CRED, PX, PY, 0);
        assertEq(predicted.code.length, 0);
        AgentAccount acct = factory.createPersonAgent(empty, CRED, PX, PY, 0);
        assertEq(address(acct), predicted);
        assertTrue(acct.hasPasskey(CRED));
        assertEq(acct.passkeyCount(), 1);
        assertEq(acct.custodianCount(), 1, "passkey-only account counts PIA as 1 custodian");
        assertTrue(acct.isCustodian(acct.passkeyIdentity(PX, PY)));
    }

    function test_createPersonAgent_passkey_idempotent() public {
        address[] memory empty = _emptyArr();
        AgentAccount a1 = factory.createPersonAgent(empty, CRED, PX, PY, 11);
        AgentAccount a2 = factory.createPersonAgent(empty, CRED, PX, PY, 11);
        assertEq(address(a1), address(a2));
    }

    function test_createPersonAgent_passkey_address_changes_with_credId() public view {
        address[] memory empty = _emptyArr();
        address a1 = factory.getAddressForPersonAgent(empty, CRED, PX, PY, 0);
        address a2 = factory.getAddressForPersonAgent(empty, keccak256("other"), PX, PY, 0);
        assertTrue(a1 != a2);
    }

    function test_createPersonAgent_passkey_address_changes_with_pubkey() public view {
        address[] memory empty = _emptyArr();
        address a1 = factory.getAddressForPersonAgent(empty, CRED, PX, PY, 0);
        address a2 = factory.getAddressForPersonAgent(empty, CRED, PX + 1, PY, 0);
        assertTrue(a1 != a2);
    }

    function test_passkey_account_carries_factory_and_dm() public {
        address[] memory empty = _emptyArr();
        AgentAccount acct = factory.createPersonAgent(empty, CRED, PX, PY, 14);
        assertEq(acct.factory(), address(factory));
        assertEq(acct.delegationManager(), address(dm));
        assertEq(acct.bundlerSigner(), bundlerSigner);
        assertEq(acct.sessionIssuer(), sessionIssuer);
    }

    function test_createPersonAgent_rejects_zero_x() public {
        address[] memory empty = _emptyArr();
        vm.expectRevert();
        factory.createPersonAgent(empty, CRED, 0, PY, 0);
    }

    function test_createPersonAgent_rejects_zero_y() public {
        address[] memory empty = _emptyArr();
        vm.expectRevert();
        factory.createPersonAgent(empty, CRED, PX, 0, 0);
    }

    function test_createPersonAgent_rejects_no_signers() public {
        address[] memory empty = _emptyArr();
        vm.expectRevert(AgentAccountFactory.NoInitialSigner.selector);
        factory.createPersonAgent(empty, bytes32(0), 0, 0, 0);
    }

    // ─── createPersonAgent: mixed (EOA + passkey) ─────────────────────

    function test_createPersonAgent_mixed_custodianCount_unions() public {
        AgentAccount acct = factory.createPersonAgent(_eoaArr(owner), CRED, PX, PY, 50);
        assertEq(acct.custodianCount(), 2, "EOA + PIA");
        assertTrue(acct.isCustodian(owner));
        assertTrue(acct.isCustodian(acct.passkeyIdentity(PX, PY)));
    }

    // ─── Factory-level capability roles ───────────────────────────────

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
