// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
import {AgentAccountInitParams} from "../src/IAgentAccount.sol";

/// @dev Wave R0 — `createAgentAccount` (unified entry replacing
///      `createPersonAgent` + `createMultiSigSmartAgent`). This file
///      covers mode=0 (simple, no CustodyPolicy installed). Mode 1-3
///      tests live in `AgentAccountFactoryMode.t.sol`.
contract AgentAccountFactoryTest is Test {
    function _defaultTimelocks() internal pure returns (uint32[7] memory tl) {}
    AgentAccountFactory factory;
    DelegationManager dm;
    CustodyPolicy custodyPolicy;

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
        custodyPolicy = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(custodyPolicy),
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

    /// @dev Build a mode=0 (simple) AgentAccountInitParams. Trustees are
    ///      not required for mode=0 — CustodyPolicy is never installed.
    function _simpleParams(address[] memory custodians, bytes32 cred, uint256 x, uint256 y)
        internal pure returns (AgentAccountInitParams memory)
    {
        return AgentAccountInitParams({
            mode: 0,
            custodians: custodians,
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: cred,
            initialPasskeyX: x,
            initialPasskeyY: y,

            initialPasskeyRpIdHash: bytes32(uint256(0x7270696468617368))
        });
    }

    // ─── mode=0: EOA-only path ────────────────────────────────────────

    function test_createAgentAccount_mode0_eoa_at_predicted_address() public {
        AgentAccountInitParams memory p = _simpleParams(_eoaArr(owner), bytes32(0), 0, 0);
        address predicted = factory.getAddressForAgentAccount(p, 7);
        assertEq(predicted.code.length, 0);
        AgentAccount acct = factory.createAgentAccount(p, _defaultTimelocks(), 7);
        assertEq(address(acct), predicted);
        assertGt(predicted.code.length, 0);
        assertTrue(acct.isCustodian(owner));
        assertEq(acct.custodianCount(), 1);
        assertEq(acct.passkeyCount(), 0);
        // mode=0 → CustodyPolicy NOT installed.
        assertFalse(custodyPolicy.isInstalledOn(address(acct)));
    }

    function test_createAgentAccount_mode0_eoa_idempotent() public {
        AgentAccountInitParams memory p = _simpleParams(_eoaArr(owner), bytes32(0), 0, 0);
        AgentAccount a1 = factory.createAgentAccount(p, _defaultTimelocks(), 8);
        AgentAccount a2 = factory.createAgentAccount(p, _defaultTimelocks(), 8);
        assertEq(address(a1), address(a2));
    }

    function test_createAgentAccount_mode0_address_changes_with_salt() public view {
        AgentAccountInitParams memory p = _simpleParams(_eoaArr(owner), bytes32(0), 0, 0);
        address a1 = factory.getAddressForAgentAccount(p, 0);
        address a2 = factory.getAddressForAgentAccount(p, 1);
        assertTrue(a1 != a2);
    }

    function test_createAgentAccount_mode0_address_changes_with_custodian() public view {
        address a1 = factory.getAddressForAgentAccount(_simpleParams(_eoaArr(owner), bytes32(0), 0, 0), 0);
        address a2 = factory.getAddressForAgentAccount(_simpleParams(_eoaArr(address(0x99)), bytes32(0), 0, 0), 0);
        assertTrue(a1 != a2);
    }

    function test_createAgentAccount_mode0_emits_event() public {
        AgentAccountInitParams memory p = _simpleParams(_eoaArr(owner), bytes32(0), 0, 0);
        address predicted = factory.getAddressForAgentAccount(p, 9);
        vm.expectEmit(true, false, false, true);
        emit AgentAccountFactory.AgentAccountCreated(predicted, /*mode=*/ 0, 1, /*withPasskey=*/ false, 9);
        factory.createAgentAccount(p, _defaultTimelocks(), 9);
    }

    // ─── mode=0: passkey-only path ────────────────────────────────────

    function test_createAgentAccount_mode0_passkey_at_predicted_address() public {
        AgentAccountInitParams memory p = _simpleParams(_emptyArr(), CRED, PX, PY);
        address predicted = factory.getAddressForAgentAccount(p, 0);
        assertEq(predicted.code.length, 0);
        AgentAccount acct = factory.createAgentAccount(p, _defaultTimelocks(), 0);
        assertEq(address(acct), predicted);
        assertTrue(acct.hasPasskey(CRED));
        assertEq(acct.passkeyCount(), 1);
        assertEq(acct.custodianCount(), 1, "passkey-only account counts PIA as 1 custodian");
        assertTrue(acct.isCustodian(acct.passkeyIdentity(PX, PY)));
    }

    function test_createAgentAccount_mode0_passkey_idempotent() public {
        AgentAccountInitParams memory p = _simpleParams(_emptyArr(), CRED, PX, PY);
        AgentAccount a1 = factory.createAgentAccount(p, _defaultTimelocks(), 11);
        AgentAccount a2 = factory.createAgentAccount(p, _defaultTimelocks(), 11);
        assertEq(address(a1), address(a2));
    }

    function test_createAgentAccount_mode0_passkey_address_changes_with_credId() public view {
        address a1 = factory.getAddressForAgentAccount(_simpleParams(_emptyArr(), CRED, PX, PY), 0);
        address a2 = factory.getAddressForAgentAccount(_simpleParams(_emptyArr(), keccak256("other"), PX, PY), 0);
        assertTrue(a1 != a2);
    }

    function test_createAgentAccount_mode0_passkey_address_changes_with_pubkey() public view {
        address a1 = factory.getAddressForAgentAccount(_simpleParams(_emptyArr(), CRED, PX, PY), 0);
        address a2 = factory.getAddressForAgentAccount(_simpleParams(_emptyArr(), CRED, PX + 1, PY), 0);
        assertTrue(a1 != a2);
    }

    function test_passkey_account_carries_factory_and_dm() public {
        AgentAccount acct = factory.createAgentAccount(_simpleParams(_emptyArr(), CRED, PX, PY), _defaultTimelocks(), 14);
        assertEq(acct.factory(), address(factory));
        assertEq(acct.delegationManager(), address(dm));
        assertEq(acct.bundlerSigner(), bundlerSigner);
        assertEq(acct.sessionIssuer(), sessionIssuer);
    }

    function test_createAgentAccount_mode0_rejects_zero_x() public {
        vm.expectRevert();
        factory.createAgentAccount(_simpleParams(_emptyArr(), CRED, 0, PY), _defaultTimelocks(), 0);
    }

    function test_createAgentAccount_mode0_rejects_zero_y() public {
        vm.expectRevert();
        factory.createAgentAccount(_simpleParams(_emptyArr(), CRED, PX, 0), _defaultTimelocks(), 0);
    }

    function test_createAgentAccount_rejects_no_signers() public {
        vm.expectRevert(AgentAccountFactory.NoInitialSigner.selector);
        factory.createAgentAccount(_simpleParams(_emptyArr(), bytes32(0), 0, 0), _defaultTimelocks(), 0);
    }

    // ─── mode=0: mixed (EOA + passkey) ────────────────────────────────

    function test_createAgentAccount_mode0_mixed_custodianCount_unions() public {
        AgentAccount acct = factory.createAgentAccount(_simpleParams(_eoaArr(owner), CRED, PX, PY), _defaultTimelocks(), 50);
        assertEq(acct.custodianCount(), 2, "EOA + PIA");
        assertTrue(acct.isCustodian(owner));
        assertTrue(acct.isCustodian(acct.passkeyIdentity(PX, PY)));
    }

    // ─── Factory-level capability roles ───────────────────────────────

    function test_factory_exposes_capability_roles() public view {
        assertEq(factory.bundlerSigner(), bundlerSigner);
        assertEq(factory.sessionIssuer(), sessionIssuer);
        assertEq(factory.delegationManager(), address(dm));
        assertEq(factory.custodyPolicy(), address(custodyPolicy));
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

    function test_factory_constructor_rejects_zero_custodyPolicy() public {
        EntryPoint ep = new EntryPoint();
        DelegationManager dm2 = new DelegationManager();
        vm.expectRevert(AgentAccountFactory.ZeroAddress.selector);
        new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm2),
            address(0),
            bundlerSigner,
            sessionIssuer,
            governance
        );
    }
}
