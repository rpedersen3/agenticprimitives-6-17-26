// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/DelegationManager.sol";
import {CustodyPolicy} from "../src/modules/CustodyPolicy.sol";
import {AgentAccountInitParams} from "../src/IAgentAccount.sol";

/// @dev Phase 6c.5-d.1.c — factory createAccountWithMode tests, restored
///      against the new CustodyPolicy install path. Replaces the
///      pre-d.1 file that drove `initializeWithThresholdPolicy` directly
///      on the account.
contract AgentAccountFactoryModeTest is Test {
    AgentAccountFactory factory;
    DelegationManager   dm;
    CustodyPolicy  validator;

    uint256 internal constant MODULE_TYPE_EXECUTOR = 2;

    address internal owner1 = address(0xA1);
    address internal owner2 = address(0xA2);
    address internal owner3 = address(0xA3);
    address internal owner4 = address(0xA4);
    address internal owner5 = address(0xA5);
    address internal guardian1 = address(0xB1);
    address internal guardian2 = address(0xB2);
    address internal guardian3 = address(0xB3);

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
        validator = new CustodyPolicy();
    }

    function _params(uint8 mode_, address[] memory owners, address[] memory guardians)
        internal pure returns (AgentAccountInitParams memory)
    {
        return AgentAccountInitParams({
            mode: mode_,
            owners: owners,
            guardians: guardians,
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0
        });
    }

    function _owners(address a) internal pure returns (address[] memory r) {
        r = new address[](1); r[0] = a;
    }
    function _ownersN(address[] memory addrs) internal pure returns (address[] memory) {
        return addrs;
    }
    function _guardians(uint256 n, address g1, address g2, address g3) internal pure returns (address[] memory r) {
        r = new address[](n);
        if (n >= 1) r[0] = g1;
        if (n >= 2) r[1] = g2;
        if (n >= 3) r[2] = g3;
    }

    // ─── 1. Single mode ─────────────────────────────────────────────

    function test_createAccountWithMode_single() public {
        AgentAccountInitParams memory p = _params(0, _owners(owner1), new address[](0));
        AgentAccount acct = factory.createAccountWithMode(p, address(validator), 1);
        assertTrue(acct.isOwner(owner1));
        assertEq(validator.custodyMode(address(acct)), 0);
        assertTrue(validator.isInstalledOn(address(acct)));
    }

    // ─── 2. Hybrid mode (consumer default) ──────────────────────────

    function test_createAccountWithMode_hybrid_with_one_owner() public {
        AgentAccountInitParams memory p = _params(1, _owners(owner1), new address[](0));
        AgentAccount acct = factory.createAccountWithMode(p, address(validator), 2);
        assertEq(validator.custodyMode(address(acct)), 1);
        // Default T4 threshold for N=1 is 1
        assertEq(validator.approvalsRequired(address(acct), 4), 1);
        // T5 timelock should be 24h
        assertEq(validator.safetyDelay(address(acct), 5), 24 hours);
    }

    // ─── 3. Threshold mode (≥ 2 guardians required) ─────────────────

    function test_createAccountWithMode_threshold_n3() public {
        address[] memory owners = new address[](3);
        owners[0] = owner1; owners[1] = owner2; owners[2] = owner3;
        AgentAccountInitParams memory p = _params(2, owners, _guardians(2, guardian1, guardian2, address(0)));
        AgentAccount acct = factory.createAccountWithMode(p, address(validator), 3);

        assertEq(validator.custodyMode(address(acct)), 2);
        // N=3 matrix from spec § 5.1: T4 = 3 (unanimous for N≤3)
        assertEq(validator.approvalsRequired(address(acct), 4), 3);
        // T5 = 3 (unanimous for N≤5)
        assertEq(validator.approvalsRequired(address(acct), 5), 3);
        assertEq(validator.trusteeCount(address(acct)), 2);
        // recoveryApprovals = floor(2/2)+1 = 2 (i.e. unanimous for n=2)
        assertEq(validator.recoveryApprovals(address(acct)), 2);
    }

    // ─── 4. Org mode (≥ 3 guardians required) ───────────────────────

    function test_createAccountWithMode_org_n5() public {
        address[] memory owners = new address[](5);
        owners[0] = owner1; owners[1] = owner2; owners[2] = owner3;
        owners[3] = owner4; owners[4] = owner5;
        AgentAccountInitParams memory p = _params(3, owners, _guardians(3, guardian1, guardian2, guardian3));
        AgentAccount acct = factory.createAccountWithMode(p, address(validator), 4);

        assertEq(validator.custodyMode(address(acct)), 3);
        // N=5 matrix: T4 = N-1 = 4, T5 = N = 5
        assertEq(validator.approvalsRequired(address(acct), 4), 4);
        assertEq(validator.approvalsRequired(address(acct), 5), 5);
        assertEq(validator.trusteeCount(address(acct)), 3);
    }

    // ─── 5. Idempotent return ───────────────────────────────────────

    function test_createAccountWithMode_idempotent() public {
        AgentAccountInitParams memory p = _params(1, _owners(owner1), new address[](0));
        AgentAccount acct1 = factory.createAccountWithMode(p, address(validator), 99);
        AgentAccount acct2 = factory.createAccountWithMode(p, address(validator), 99);
        assertEq(address(acct1), address(acct2));
    }

    // ─── 6. Counterfactual address derivation ──────────────────────

    function test_getAddressForMode_matches_deploy() public {
        AgentAccountInitParams memory p = _params(1, _owners(owner1), new address[](0));
        address predicted = factory.getAddressForMode(p, 7);
        AgentAccount actual = factory.createAccountWithMode(p, address(validator), 7);
        assertEq(predicted, address(actual));
    }

    // ─── 7. Validation: missing primary signer ─────────────────────

    function test_createAccountWithMode_rejects_zeroOwners() public {
        AgentAccountInitParams memory p = _params(1, new address[](0), new address[](0));
        vm.expectRevert(AgentAccountFactory.NoPrimarySigner.selector);
        factory.createAccountWithMode(p, address(validator), 8);
    }

    // ─── 8. Validation: threshold mode requires ≥ 2 guardians ─────

    function test_createAccountWithMode_rejects_thresholdWith1Guardian() public {
        address[] memory owners = new address[](2);
        owners[0] = owner1; owners[1] = owner2;
        AgentAccountInitParams memory p = _params(2, owners, _guardians(1, guardian1, address(0), address(0)));
        vm.expectRevert(abi.encodeWithSelector(
            AgentAccountFactory.InsufficientGuardiansForMode.selector, uint8(2), uint256(1), uint256(2)
        ));
        factory.createAccountWithMode(p, address(validator), 9);
    }

    // ─── 9. Validation: org mode requires ≥ 3 guardians ────────────

    function test_createAccountWithMode_rejects_orgWith2Guardians() public {
        address[] memory owners = new address[](3);
        owners[0] = owner1; owners[1] = owner2; owners[2] = owner3;
        AgentAccountInitParams memory p = _params(3, owners, _guardians(2, guardian1, guardian2, address(0)));
        vm.expectRevert(abi.encodeWithSelector(
            AgentAccountFactory.InsufficientGuardiansForMode.selector, uint8(3), uint256(2), uint256(3)
        ));
        factory.createAccountWithMode(p, address(validator), 10);
    }

    // ─── 10. Invalid mode value ─────────────────────────────────────

    function test_createAccountWithMode_rejects_invalidMode() public {
        AgentAccountInitParams memory p = _params(7, _owners(owner1), new address[](0));
        vm.expectRevert(abi.encodeWithSelector(AgentAccountFactory.InvalidMode.selector, uint8(7)));
        factory.createAccountWithMode(p, address(validator), 11);
    }

    // ─── 11. Zero validator address rejected ────────────────────────

    function test_createAccountWithMode_rejects_zeroValidator() public {
        AgentAccountInitParams memory p = _params(1, _owners(owner1), new address[](0));
        vm.expectRevert(AgentAccountFactory.ZeroAddress.selector);
        factory.createAccountWithMode(p, address(0), 12);
    }

    // ─── 12. Module install event observable ────────────────────────

    function test_createAccountWithMode_emitsEvents() public {
        AgentAccountInitParams memory p = _params(1, _owners(owner1), new address[](0));
        address predicted = factory.getAddressForMode(p, 13);

        vm.expectEmit(true, true, true, true, address(factory));
        emit AgentAccountFactory.AgentAccountCreatedWithMode(
            predicted, address(validator), 1, 1, 0, 13
        );
        factory.createAccountWithMode(p, address(validator), 13);
    }
}
