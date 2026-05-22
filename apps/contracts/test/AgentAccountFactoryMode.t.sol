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

/// @dev Phase 6f.4 — `createMultiSigSmartAgent` (renamed + collapsed
///      from the legacy `createAccountWithMode*` family). Covers mode
///      bounds, trustee minima per spec § 8, default threshold matrix,
///      idempotency, counterfactual derivation, and event emission.
contract AgentAccountFactoryModeTest is Test {
    AgentAccountFactory factory;
    DelegationManager   dm;
    CustodyPolicy       validator;

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
            custodians: owners,
            trustees: guardians,
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0
        });
    }

    function _custodians(address a) internal pure returns (address[] memory r) {
        r = new address[](1); r[0] = a;
    }
    function _guardians(uint256 n, address g1, address g2, address g3) internal pure returns (address[] memory r) {
        r = new address[](n);
        if (n >= 1) r[0] = g1;
        if (n >= 2) r[1] = g2;
        if (n >= 3) r[2] = g3;
    }

    // ─── 1. Single mode ─────────────────────────────────────────────

    function test_createMultiSigSmartAgent_single() public {
        AgentAccountInitParams memory p = _params(0, _custodians(owner1), new address[](0));
        AgentAccount acct = factory.createMultiSigSmartAgent(p, address(validator), 0, 1);
        assertTrue(acct.isCustodian(owner1));
        assertEq(validator.custodyMode(address(acct)), 0);
        assertTrue(validator.isInstalledOn(address(acct)));
    }

    // ─── 2. Hybrid mode (consumer default) ──────────────────────────

    function test_createMultiSigSmartAgent_hybrid_with_one_owner() public {
        AgentAccountInitParams memory p = _params(1, _custodians(owner1), new address[](0));
        AgentAccount acct = factory.createMultiSigSmartAgent(p, address(validator), 0, 2);
        assertEq(validator.custodyMode(address(acct)), 1);
        assertEq(validator.approvalsRequired(address(acct), 4), 1);
        assertEq(validator.safetyDelay(address(acct), 5), 24 hours);
    }

    // ─── 3. Threshold mode (≥ 2 guardians required) ─────────────────

    function test_createMultiSigSmartAgent_threshold_n3() public {
        address[] memory owners = new address[](3);
        owners[0] = owner1; owners[1] = owner2; owners[2] = owner3;
        AgentAccountInitParams memory p = _params(2, owners, _guardians(2, guardian1, guardian2, address(0)));
        AgentAccount acct = factory.createMultiSigSmartAgent(p, address(validator), 0, 3);

        assertEq(validator.custodyMode(address(acct)), 2);
        assertEq(validator.approvalsRequired(address(acct), 4), 3);
        assertEq(validator.approvalsRequired(address(acct), 5), 3);
        assertEq(validator.trusteeCount(address(acct)), 2);
        assertEq(validator.recoveryApprovals(address(acct)), 2);
    }

    // ─── 4. Org mode (≥ 3 guardians required) ───────────────────────

    function test_createMultiSigSmartAgent_org_n5() public {
        address[] memory owners = new address[](5);
        owners[0] = owner1; owners[1] = owner2; owners[2] = owner3;
        owners[3] = owner4; owners[4] = owner5;
        AgentAccountInitParams memory p = _params(3, owners, _guardians(3, guardian1, guardian2, guardian3));
        AgentAccount acct = factory.createMultiSigSmartAgent(p, address(validator), 0, 4);

        assertEq(validator.custodyMode(address(acct)), 3);
        assertEq(validator.approvalsRequired(address(acct), 4), 4);
        assertEq(validator.approvalsRequired(address(acct), 5), 5);
        assertEq(validator.trusteeCount(address(acct)), 3);
    }

    // ─── 5. Idempotent return ───────────────────────────────────────

    function test_createMultiSigSmartAgent_idempotent() public {
        AgentAccountInitParams memory p = _params(1, _custodians(owner1), new address[](0));
        AgentAccount acct1 = factory.createMultiSigSmartAgent(p, address(validator), 0, 99);
        AgentAccount acct2 = factory.createMultiSigSmartAgent(p, address(validator), 0, 99);
        assertEq(address(acct1), address(acct2));
    }

    // ─── 6. Counterfactual address derivation ──────────────────────

    function test_getAddressForMultiSigSmartAgent_matches_deploy() public {
        AgentAccountInitParams memory p = _params(1, _custodians(owner1), new address[](0));
        address predicted = factory.getAddressForMultiSigSmartAgent(p, 7);
        AgentAccount actual = factory.createMultiSigSmartAgent(p, address(validator), 0, 7);
        assertEq(predicted, address(actual));
    }

    // ─── 7. Validation: zero signers (no external + no passkey) ────

    function test_createMultiSigSmartAgent_rejects_no_signers() public {
        AgentAccountInitParams memory p = _params(1, new address[](0), new address[](0));
        // Initializer reverts with ZeroAddress (signer-set empty).
        vm.expectRevert(AgentAccount.ZeroAddress.selector);
        factory.createMultiSigSmartAgent(p, address(validator), 0, 8);
    }

    // ─── 8. Threshold mode requires ≥ 2 guardians ──────────────────

    function test_createMultiSigSmartAgent_rejects_thresholdWith1Guardian() public {
        address[] memory owners = new address[](2);
        owners[0] = owner1; owners[1] = owner2;
        AgentAccountInitParams memory p = _params(2, owners, _guardians(1, guardian1, address(0), address(0)));
        vm.expectRevert(abi.encodeWithSelector(
            AgentAccountFactory.InsufficientTrusteesForMode.selector, uint8(2), uint256(1), uint256(2)
        ));
        factory.createMultiSigSmartAgent(p, address(validator), 0, 9);
    }

    // ─── 9. Org mode requires ≥ 3 guardians ────────────────────────

    function test_createMultiSigSmartAgent_rejects_orgWith2Guardians() public {
        address[] memory owners = new address[](3);
        owners[0] = owner1; owners[1] = owner2; owners[2] = owner3;
        AgentAccountInitParams memory p = _params(3, owners, _guardians(2, guardian1, guardian2, address(0)));
        vm.expectRevert(abi.encodeWithSelector(
            AgentAccountFactory.InsufficientTrusteesForMode.selector, uint8(3), uint256(2), uint256(3)
        ));
        factory.createMultiSigSmartAgent(p, address(validator), 0, 10);
    }

    // ─── 10. Invalid mode value ─────────────────────────────────────

    function test_createMultiSigSmartAgent_rejects_invalidMode() public {
        AgentAccountInitParams memory p = _params(7, _custodians(owner1), new address[](0));
        vm.expectRevert(abi.encodeWithSelector(AgentAccountFactory.InvalidMode.selector, uint8(7)));
        factory.createMultiSigSmartAgent(p, address(validator), 0, 11);
    }

    // ─── 11. Zero validator address rejected ────────────────────────

    function test_createMultiSigSmartAgent_rejects_zeroValidator() public {
        AgentAccountInitParams memory p = _params(1, _custodians(owner1), new address[](0));
        vm.expectRevert(AgentAccountFactory.ValidatorRequired.selector);
        factory.createMultiSigSmartAgent(p, address(0), 0, 12);
    }

    // ─── 12. Event emission ─────────────────────────────────────────

    function test_createMultiSigSmartAgent_emitsEvent() public {
        AgentAccountInitParams memory p = _params(1, _custodians(owner1), new address[](0));
        address predicted = factory.getAddressForMultiSigSmartAgent(p, 13);

        vm.expectEmit(true, false, false, true, address(factory));
        emit AgentAccountFactory.AgentAccountCreated(
            predicted, /*withValidator=*/ true, 1, /*withPasskey=*/ false, 13
        );
        factory.createMultiSigSmartAgent(p, address(validator), 0, 13);
    }

    // ─── 13. Phase 6f.4 — passkey-direct init for multi-sig accounts

    bytes32 internal constant TEST_CRED = keccak256("alice-cred");
    uint256 internal constant TEST_X = uint256(keccak256("alice-x"));
    uint256 internal constant TEST_Y = uint256(keccak256("alice-y"));

    function _pia(uint256 x, uint256 y) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode(x, y)))));
    }

    function test_createMultiSigSmartAgent_passkeyOnly() public {
        // Hybrid Org-like deploy: no external custodians, one passkey
        // PIA — the demo's Act 2 shape post-pivot.
        AgentAccountInitParams memory p = AgentAccountInitParams({
            mode: 1,
            custodians: new address[](0),
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: TEST_CRED,
            initialPasskeyX: TEST_X,
            initialPasskeyY: TEST_Y
        });
        AgentAccount acct = factory.createMultiSigSmartAgent(p, address(validator), 0, 20);

        assertTrue(acct.isCustodian(_pia(TEST_X, TEST_Y)));
        assertEq(acct.custodianCount(), 1);
        assertTrue(acct.hasPasskey(TEST_CRED));
        assertTrue(validator.isInstalledOn(address(acct)));
        // N=1 (just the PIA) → T4=1.
        assertEq(validator.approvalsRequired(address(acct), 4), 1);
    }
}
