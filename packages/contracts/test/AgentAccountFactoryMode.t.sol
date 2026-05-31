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

/// @dev Wave R0 — `createAgentAccount` mode 1-3 paths (CustodyPolicy
///      installed at birth, trustees required per spec § 8). Covers
///      mode bounds, trustee minima, default threshold matrix,
///      idempotency, counterfactual derivation, and event emission.
contract AgentAccountFactoryModeTest is Test {
    function _defaultTimelocks() internal pure returns (uint32[7] memory tl) {}
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
        dm = new DelegationManager(address(0));
        validator = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(validator),
            address(0xBB),
            address(0xCC),
            address(0xDD)
        );
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
            initialPasskeyY: 0,

            initialPasskeyRpIdHash: bytes32(uint256(0x7270696468617368))
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

    // ─── 1. Hybrid mode (mode 1) ────────────────────────────────────

    function test_createAgentAccount_hybrid_with_one_owner() public {
        // Mode 1 requires ≥1 trustee.
        AgentAccountInitParams memory p = _params(1, _custodians(owner1), _guardians(1, guardian1, address(0), address(0)));
        AgentAccount acct = factory.createAgentAccount(p, _defaultTimelocks(), 2);
        assertEq(validator.custodyMode(address(acct)), 1);
        assertEq(validator.approvalsRequired(address(acct), 4), 1);
        assertEq(validator.safetyDelay(address(acct), 5), 24 hours);
        assertTrue(validator.isInstalledOn(address(acct)));
    }

    // ─── 2. Threshold mode (≥ 2 trustees required) ─────────────────

    function test_createAgentAccount_threshold_n3() public {
        address[] memory owners = new address[](3);
        owners[0] = owner1; owners[1] = owner2; owners[2] = owner3;
        AgentAccountInitParams memory p = _params(2, owners, _guardians(2, guardian1, guardian2, address(0)));
        AgentAccount acct = factory.createAgentAccount(p, _defaultTimelocks(), 3);

        assertEq(validator.custodyMode(address(acct)), 2);
        assertEq(validator.approvalsRequired(address(acct), 4), 3);
        assertEq(validator.approvalsRequired(address(acct), 5), 3);
        assertEq(validator.trusteeCount(address(acct)), 2);
        assertEq(validator.recoveryApprovals(address(acct)), 2);
    }

    // ─── 3. Org mode (≥ 3 trustees required) ───────────────────────

    function test_createAgentAccount_org_n5() public {
        address[] memory owners = new address[](5);
        owners[0] = owner1; owners[1] = owner2; owners[2] = owner3;
        owners[3] = owner4; owners[4] = owner5;
        AgentAccountInitParams memory p = _params(3, owners, _guardians(3, guardian1, guardian2, guardian3));
        AgentAccount acct = factory.createAgentAccount(p, _defaultTimelocks(), 4);

        assertEq(validator.custodyMode(address(acct)), 3);
        assertEq(validator.approvalsRequired(address(acct), 4), 4);
        assertEq(validator.approvalsRequired(address(acct), 5), 5);
        assertEq(validator.trusteeCount(address(acct)), 3);
    }

    // ─── 4. Idempotent return ───────────────────────────────────────

    function test_createAgentAccount_idempotent() public {
        AgentAccountInitParams memory p = _params(1, _custodians(owner1), _guardians(1, guardian1, address(0), address(0)));
        AgentAccount acct1 = factory.createAgentAccount(p, _defaultTimelocks(), 99);
        AgentAccount acct2 = factory.createAgentAccount(p, _defaultTimelocks(), 99);
        assertEq(address(acct1), address(acct2));
    }

    // ─── 5. Counterfactual address derivation ──────────────────────

    function test_getAddressForAgentAccount_matches_deploy() public {
        AgentAccountInitParams memory p = _params(1, _custodians(owner1), _guardians(1, guardian1, address(0), address(0)));
        address predicted = factory.getAddressForAgentAccount(p, 7);
        AgentAccount actual = factory.createAgentAccount(p, _defaultTimelocks(), 7);
        assertEq(predicted, address(actual));
    }

    // ─── 6. Validation: zero signers ───────────────────────────────

    function test_createAgentAccount_rejects_no_signers() public {
        AgentAccountInitParams memory p = _params(1, new address[](0), _guardians(1, guardian1, address(0), address(0)));
        // Factory rejects no-signer config before reaching the initializer.
        vm.expectRevert(AgentAccountFactory.NoInitialSigner.selector);
        factory.createAgentAccount(p, _defaultTimelocks(), 8);
    }

    // ─── 7. Mode 1 requires ≥ 1 trustee (Wave R0 invariant) ────────

    function test_createAgentAccount_hybrid_rejects_zero_trustees() public {
        AgentAccountInitParams memory p = _params(1, _custodians(owner1), new address[](0));
        vm.expectRevert(abi.encodeWithSelector(
            AgentAccountFactory.TrusteesRequiredForRecoverableMode.selector, uint8(1)
        ));
        factory.createAgentAccount(p, _defaultTimelocks(), 14);
    }

    // ─── 8. Threshold mode requires ≥ 2 trustees ───────────────────

    function test_createAgentAccount_rejects_thresholdWith1Trustee() public {
        address[] memory owners = new address[](2);
        owners[0] = owner1; owners[1] = owner2;
        AgentAccountInitParams memory p = _params(2, owners, _guardians(1, guardian1, address(0), address(0)));
        vm.expectRevert(abi.encodeWithSelector(
            AgentAccountFactory.InsufficientTrusteesForMode.selector, uint8(2), uint256(1), uint256(2)
        ));
        factory.createAgentAccount(p, _defaultTimelocks(), 9);
    }

    // ─── 9. Org mode requires ≥ 3 trustees ─────────────────────────

    function test_createAgentAccount_rejects_orgWith2Trustees() public {
        address[] memory owners = new address[](3);
        owners[0] = owner1; owners[1] = owner2; owners[2] = owner3;
        AgentAccountInitParams memory p = _params(3, owners, _guardians(2, guardian1, guardian2, address(0)));
        vm.expectRevert(abi.encodeWithSelector(
            AgentAccountFactory.InsufficientTrusteesForMode.selector, uint8(3), uint256(2), uint256(3)
        ));
        factory.createAgentAccount(p, _defaultTimelocks(), 10);
    }

    // ─── 10. Invalid mode value ─────────────────────────────────────

    function test_createAgentAccount_rejects_invalidMode() public {
        AgentAccountInitParams memory p = _params(7, _custodians(owner1), _guardians(1, guardian1, address(0), address(0)));
        vm.expectRevert(abi.encodeWithSelector(AgentAccountFactory.InvalidMode.selector, uint8(7)));
        factory.createAgentAccount(p, _defaultTimelocks(), 11);
    }

    // ─── 11. Event emission ─────────────────────────────────────────

    function test_createAgentAccount_emitsEvent() public {
        AgentAccountInitParams memory p = _params(1, _custodians(owner1), _guardians(1, guardian1, address(0), address(0)));
        address predicted = factory.getAddressForAgentAccount(p, 13);

        vm.expectEmit(true, false, false, true, address(factory));
        emit AgentAccountFactory.AgentAccountCreated(
            predicted, /*mode=*/ 1, 1, /*withPasskey=*/ false, 13
        );
        factory.createAgentAccount(p, _defaultTimelocks(), 13);
    }

    // ─── 12. Phase 6f.4 — passkey-direct init for multi-sig accounts

    bytes32 internal constant TEST_CRED = keccak256("alice-cred");
    uint256 internal constant TEST_X = uint256(keccak256("alice-x"));
    uint256 internal constant TEST_Y = uint256(keccak256("alice-y"));

    function _pia(uint256 x, uint256 y) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode(x, y)))));
    }

    function test_createAgentAccount_passkeyOnly() public {
        // Hybrid Org-like deploy: no external custodians, one passkey
        // PIA + one trustee (required for mode>0 post-R0).
        AgentAccountInitParams memory p = AgentAccountInitParams({
            mode: 1,
            custodians: new address[](0),
            trustees: _guardians(1, guardian1, address(0), address(0)),
            initialPasskeyCredentialIdDigest: TEST_CRED,
            initialPasskeyX: TEST_X,
            initialPasskeyY: TEST_Y,

            initialPasskeyRpIdHash: bytes32(uint256(0x7270696468617368))
        });
        AgentAccount acct = factory.createAgentAccount(p, _defaultTimelocks(), 20);

        assertTrue(acct.isCustodian(_pia(TEST_X, TEST_Y)));
        assertEq(acct.custodianCount(), 1);
        assertTrue(acct.hasPasskey(TEST_CRED));
        assertTrue(validator.isInstalledOn(address(acct)));
        // N=1 (just the PIA) → T4=1.
        assertEq(validator.approvalsRequired(address(acct), 4), 1);
    }
}
