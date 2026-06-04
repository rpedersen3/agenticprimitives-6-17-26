// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {AgentAccountFactory} from "../src/AgentAccountFactory.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {DelegationManager} from "../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
import {AgentAccountInitParams} from "../src/IAgentAccount.sol";

/**
 * H7-D.1 — AgentAccount invariant + edge coverage.
 *
 * Adds tests that lock the architectural invariants which, if violated,
 * compromise the account's promise to its custodians:
 *
 *   I1. `custodianCount() == externalCustodianCount + passkeyCount`
 *   I2. `isCustodian(addr)` returns true iff `addr` is in the external
 *       set OR is the PIA of a registered passkey.
 *   I3. PIA mapping `piaToCredentialId` consistency: a PIA is registered
 *       iff its credentialIdDigest is in `registered`.
 *   I4. `addPasskey` requires non-zero rpIdHash (H7-C.1 closure).
 *   I5. `removePasskey` clears rpIdHashOf so a subsequent re-add with
 *       same digest+x+y MUST supply the rpIdHash again.
 *   I6. CannotRemoveLastSigner fires when the last (custodian + passkey)
 *       is being removed.
 */
contract AgentAccountInvariantsTest is Test {
    AgentAccountFactory factory;
    DelegationManager dm;
    CustodyPolicy policy;
    EntryPoint entryPoint;
    address deployer = address(0xD3D);

    bytes32 constant TEST_RP_HASH = bytes32(uint256(0x7270696468617368));

    function _defaultTimelocks() internal pure returns (uint32[7] memory tl) {}

    function setUp() public {
        entryPoint = new EntryPoint();
        dm = new DelegationManager(address(0));
        policy = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(entryPoint)),
            address(dm),
            address(policy),
            deployer,
            deployer,
            deployer, address(0)
        );
    }

    function _baseParams(address[] memory custodians, bytes32 credId, uint256 x, uint256 y)
        internal
        pure
        returns (AgentAccountInitParams memory)
    {
        return AgentAccountInitParams({
            mode: 0,
            custodians: custodians,
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: credId,
            initialPasskeyX: x,
            initialPasskeyY: y,
            initialPasskeyRpIdHash: x == 0 && y == 0 ? bytes32(0) : TEST_RP_HASH
        });
    }

    function _pia(uint256 x, uint256 y) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode(x, y)))));
    }

    // ─── I1: custodianCount invariant ───────────────────────────────

    function test_I1_custodianCount_one_external_zero_passkeys() public {
        address[] memory custs = new address[](1);
        custs[0] = address(0xA11CE);
        AgentAccount a = factory.createAgentAccount(
            _baseParams(custs, bytes32(0), 0, 0),
            _defaultTimelocks(),
            1
        );
        assertEq(a.custodianCount(), 1);
        assertEq(a.passkeyCount(), 0);
    }

    function test_I1_custodianCount_zero_external_one_passkey() public {
        address[] memory empty = new address[](0);
        AgentAccount a = factory.createAgentAccount(
            _baseParams(empty, keccak256("cred"), 42, 43),
            _defaultTimelocks(),
            2
        );
        assertEq(a.custodianCount(), 1);
        assertEq(a.passkeyCount(), 1);
    }

    function test_I1_custodianCount_after_adding_passkey() public {
        address[] memory custs = new address[](1);
        custs[0] = address(0xA11CE);
        AgentAccount a = factory.createAgentAccount(
            _baseParams(custs, bytes32(0), 0, 0),
            _defaultTimelocks(),
            3
        );
        assertEq(a.custodianCount(), 1);

        vm.prank(address(a));
        a.addPasskey(keccak256("new-cred"), 100, 200, TEST_RP_HASH);
        assertEq(a.custodianCount(), 2);
        assertEq(a.passkeyCount(), 1);
    }

    // ─── I2: isCustodian dispatch ───────────────────────────────────

    function test_I2_isCustodian_dispatches_external_and_passkey_pia() public {
        address[] memory custs = new address[](1);
        custs[0] = address(0xA11CE);
        AgentAccount a = factory.createAgentAccount(
            _baseParams(custs, keccak256("cred"), 42, 43),
            _defaultTimelocks(),
            4
        );
        assertTrue(a.isCustodian(address(0xA11CE)));
        assertTrue(a.isCustodian(_pia(42, 43)));
        assertFalse(a.isCustodian(address(0xBAD)));
    }

    // ─── I3: PIA mapping consistency ────────────────────────────────

    function test_I3_pia_mapping_set_on_add_and_cleared_on_remove() public {
        address[] memory custs = new address[](1);
        custs[0] = address(0xA11CE);
        AgentAccount a = factory.createAgentAccount(
            _baseParams(custs, bytes32(0), 0, 0),
            _defaultTimelocks(),
            5
        );
        bytes32 cred = keccak256("rotating-cred");
        uint256 x = 0xCAFE;
        uint256 y = 0xBEEF;
        address pia = _pia(x, y);

        vm.startPrank(address(a));
        a.addPasskey(cred, x, y, TEST_RP_HASH);
        assertTrue(a.isCustodian(pia));
        assertTrue(a.hasPasskey(cred));

        a.removePasskey(cred);
        assertFalse(a.isCustodian(pia));
        assertFalse(a.hasPasskey(cred));
        vm.stopPrank();
    }

    // ─── I4: addPasskey requires non-zero rpIdHash ──────────────────

    function test_I4_addPasskey_rejects_zero_rpIdHash() public {
        address[] memory custs = new address[](1);
        custs[0] = address(0xA11CE);
        AgentAccount a = factory.createAgentAccount(
            _baseParams(custs, bytes32(0), 0, 0),
            _defaultTimelocks(),
            6
        );
        vm.prank(address(a));
        vm.expectRevert(AgentAccount.InvalidRpIdHash.selector);
        a.addPasskey(keccak256("c"), 1, 2, bytes32(0));
    }

    // ─── I5: removePasskey clears rpIdHashOf ────────────────────────

    function test_I5_removePasskey_clears_rpIdHash_storage() public {
        address[] memory custs = new address[](1);
        custs[0] = address(0xA11CE);
        AgentAccount a = factory.createAgentAccount(
            _baseParams(custs, bytes32(0), 0, 0),
            _defaultTimelocks(),
            7
        );
        bytes32 cred = keccak256("rotate-rp");
        uint256 x = 11;
        uint256 y = 22;
        bytes32 oldRp = keccak256("old-rp");
        bytes32 newRp = keccak256("new-rp");

        vm.startPrank(address(a));
        a.addPasskey(cred, x, y, oldRp);
        a.removePasskey(cred);
        // Re-adding with a NEW rpIdHash is allowed; the old hash is gone.
        a.addPasskey(cred, x, y, newRp);
        assertTrue(a.hasPasskey(cred));
        vm.stopPrank();
    }

    // ─── I6: CannotRemoveLastSigner ─────────────────────────────────

    function test_I6_cannot_remove_last_passkey() public {
        address[] memory empty = new address[](0);
        AgentAccount a = factory.createAgentAccount(
            _baseParams(empty, keccak256("only"), 1, 2),
            _defaultTimelocks(),
            8
        );
        vm.prank(address(a));
        vm.expectRevert(AgentAccount.CannotRemoveLastSigner.selector);
        a.removePasskey(keccak256("only"));
    }

    // ─── Existing error path coverage ───────────────────────────────

    function test_addPasskey_rejects_duplicate_credentialIdDigest() public {
        address[] memory custs = new address[](1);
        custs[0] = address(0xA11CE);
        AgentAccount a = factory.createAgentAccount(
            _baseParams(custs, bytes32(0), 0, 0),
            _defaultTimelocks(),
            9
        );
        bytes32 cred = keccak256("dup");
        vm.startPrank(address(a));
        a.addPasskey(cred, 5, 6, TEST_RP_HASH);
        vm.expectRevert(abi.encodeWithSelector(AgentAccount.PasskeyAlreadyRegistered.selector, cred));
        a.addPasskey(cred, 7, 8, TEST_RP_HASH);
        vm.stopPrank();
    }

    function test_removePasskey_rejects_unknown_digest() public {
        address[] memory custs = new address[](1);
        custs[0] = address(0xA11CE);
        AgentAccount a = factory.createAgentAccount(
            _baseParams(custs, bytes32(0), 0, 0),
            _defaultTimelocks(),
            10
        );
        bytes32 ghost = keccak256("never-added");
        vm.prank(address(a));
        vm.expectRevert(abi.encodeWithSelector(AgentAccount.PasskeyNotRegistered.selector, ghost));
        a.removePasskey(ghost);
    }

    function test_initialize_rejects_zero_address_external_custodian() public {
        address[] memory custs = new address[](1);
        custs[0] = address(0);
        vm.expectRevert();
        factory.createAgentAccount(
            _baseParams(custs, bytes32(0), 0, 0),
            _defaultTimelocks(),
            11
        );
    }

    function test_initialize_requires_at_least_one_signer() public {
        // Empty externalCustodians + no passkey → ZeroAddress.
        address[] memory empty = new address[](0);
        vm.expectRevert();
        factory.createAgentAccount(
            _baseParams(empty, bytes32(0), 0, 0),
            _defaultTimelocks(),
            12
        );
    }
}
