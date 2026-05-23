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

/// @dev Phase 6c.5-d.1 smoke-test suite for the CustodyPolicy
///      module. Verifies end-to-end: install → propose → execute (with
///      account state actually mutated by the executor self-call path
///      via executeFromModule). The deep test suite (matrix of all 15
///      AdminActions, org-mode SoD, T6 recovery, etc.) is the
///      relocated AgentAccountAdmin.t.sol — that migration is part of
///      the same phase but lives in a separate commit so the green
///      bar moves in checkable steps.
contract CustodyPolicyTest is Test {
    function _defaultTimelocks() internal pure returns (uint32[7] memory tl) {}
    AgentAccountFactory factory;
    DelegationManager   dm;
    AgentAccount        acct;
    CustodyPolicy  validator;

    uint256 internal constant OWNER_PK = 0xA11CE;
    uint256 internal constant OWNER2_PK = 0xBEEF;
    uint256 internal constant MODULE_TYPE_EXECUTOR = 2;

    address internal owner;
    address internal owner2;

    function setUp() public {
        EntryPoint ep = new EntryPoint();
        dm = new DelegationManager();
        owner  = vm.addr(OWNER_PK);
        owner2 = vm.addr(OWNER2_PK);

        validator = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(validator),
            address(0xBB),
            address(0xCC),
            address(0xDD)
        );
        address[] memory custodians = new address[](1);
        custodians[0] = owner;
        acct = factory.createAgentAccount(_simpleParams(custodians), _defaultTimelocks(), 42);
    }

    function _simpleParams(address[] memory custodians)
        internal pure returns (AgentAccountInitParams memory)
    {
        return AgentAccountInitParams({
            mode: 0,
            custodians: custodians,
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0
        });
    }

    function _installValidator(uint8 modeVal, uint8[7] memory thresholds, uint32[7] memory timelocks) internal {
        address[] memory guardians = new address[](0);
        bytes memory initData = abi.encode(
            modeVal,
            uint8(0),                       // recoveryApprovals
            guardians,
            thresholds,
            timelocks,
            uint256(0),                     // t3HighValueCeiling
            address(0)                      // approvedHashRegistry
        );
        // Wave 2A: install MUST come from the account itself (self-call)
        // — no more direct custodian / EOA install path. In production
        // this self-call routes through CustodyPolicy.ApplySystemUpdate
        // or the factory's one-time init exception; here we vm.prank
        // the account to simulate the policy-quorum self-dispatch.
        vm.prank(address(acct));
        acct.installModule(MODULE_TYPE_EXECUTOR, address(validator), initData);
    }

    function _signRaw(uint256 pk, bytes32 hash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hash);
        return abi.encodePacked(r, s, v);
    }

    // ─── EIP-712 hash helpers (spec 207 § 15) ─────────────────────────

    bytes32 constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 constant PROPOSE_TYPEHASH = keccak256(
        "ScheduleCustodyChangeRequest(address account,uint8 action,bytes32 argsHash,uint256 changeId)"
    );
    bytes32 constant EXECUTE_TYPEHASH = keccak256(
        "ApplyCustodyChangeRequest(address account,uint8 action,bytes32 argsHash,uint256 changeId,uint64 eta)"
    );
    bytes32 constant CANCEL_TYPEHASH = keccak256(
        "CancelScheduledChangeRequest(address account,uint8 action,bytes32 argsHash,uint256 changeId,uint64 eta)"
    );

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256("agenticprimitives.CustodyPolicy"),
                keccak256("1"),
                block.chainid,
                address(validator)
            )
        );
    }

    function _hashTypedData(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(bytes2(0x1901), _domainSeparator(), structHash));
    }

    function _hashPropose(
        uint256 changeId,
        CustodyPolicy.CustodyAction action,
        bytes memory args
    ) internal view returns (bytes32) {
        return _hashTypedData(
            keccak256(abi.encode(PROPOSE_TYPEHASH, address(acct), uint8(action), keccak256(args), changeId))
        );
    }

    function _hashExecute(
        uint256 changeId,
        CustodyPolicy.CustodyAction action,
        bytes memory args,
        uint64 eta
    ) internal view returns (bytes32) {
        return _hashTypedData(
            keccak256(abi.encode(EXECUTE_TYPEHASH, address(acct), uint8(action), keccak256(args), changeId, eta))
        );
    }

    // ─── 1. Install + uninstall ───────────────────────────────────────

    function test_install_succeeds_with_valid_init_data() public {
        uint8[7] memory thresholds; thresholds[4] = 1;
        uint32[7] memory timelocks;
        _installValidator(1, thresholds, timelocks);

        assertTrue(validator.isInstalledOn(address(acct)));
        assertEq(validator.custodyMode(address(acct)), 1);
        assertEq(validator.approvalsRequired(address(acct), 4), 1);
        assertTrue(acct.isModuleInstalled(MODULE_TYPE_EXECUTOR, address(validator), hex""));
    }

    function test_uninstall_clears_installed_flag() public {
        uint8[7] memory thresholds; thresholds[4] = 1;
        uint32[7] memory timelocks;
        _installValidator(1, thresholds, timelocks);

        // Wave 2A: uninstall is `onlySelf` (no factory exception).
        vm.prank(address(acct));
        acct.uninstallModule(MODULE_TYPE_EXECUTOR, address(validator), hex"");
        assertFalse(validator.isInstalledOn(address(acct)));
    }

    function test_install_rejects_double_install() public {
        uint8[7] memory thresholds; thresholds[4] = 1;
        uint32[7] memory timelocks;
        _installValidator(1, thresholds, timelocks);

        // Second install via self-call. Account-side gate would
        // catch this via "module already installed" — verify both layers
        // are coherent.
        vm.prank(address(acct));
        vm.expectRevert();
        acct.installModule(MODULE_TYPE_EXECUTOR, address(validator), abi.encode(
            uint8(1), uint8(0), new address[](0), thresholds, timelocks, uint256(0), address(0)
        ));
    }

    // ─── 2. Propose + execute end-to-end (AddCustodian) ───────────────────

    function test_propose_execute_addOwner_round_trip() public {
        uint8[7] memory thresholds; thresholds[4] = 1;   // T4 = 1-of-N
        uint32[7] memory timelocks;                       // all 0 — execute immediately
        _installValidator(1, thresholds, timelocks);

        bytes memory args = abi.encode(owner2);
        uint64 nowTs = uint64(block.timestamp);
        uint64 eta   = nowTs;
        uint256 changeId = 1;  // first proposal

        bytes32 proposeHash = _hashPropose(changeId, CustodyPolicy.CustodyAction.AddCustodian, args);
        bytes memory sigs = _signRaw(OWNER_PK, proposeHash);

        uint256 retId = validator.scheduleCustodyChange(
            address(acct),
            CustodyPolicy.CustodyAction.AddCustodian,
            args,
            sigs
        );
        assertEq(retId, changeId);

        bytes32 execHash = _hashExecute(changeId, CustodyPolicy.CustodyAction.AddCustodian, args, eta);
        bytes memory execSigs = _signRaw(OWNER_PK, execHash);

        assertFalse(acct.isCustodian(owner2), "pre: owner2 not yet on account");

        validator.applyCustodyChange(address(acct), changeId, execSigs);

        assertTrue(acct.isCustodian(owner2), "post: owner2 added via executeFromModule path");
    }

    // ─── 3. Reject when not installed ─────────────────────────────────

    function test_proposeAdmin_revertsForUninstalledAccount() public {
        // Brand-new account; validator never installed.
        address[] memory _c = new address[](1);
        _c[0] = owner;
        AgentAccount fresh = factory.createAgentAccount(_simpleParams(_c), _defaultTimelocks(), 99);
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.NotInstalledOn.selector, address(fresh)));
        validator.scheduleCustodyChange(
            address(fresh),
            CustodyPolicy.CustodyAction.AddCustodian,
            abi.encode(owner2),
            hex""
        );
    }

    // ─── 4. Reject unauthorized signer ────────────────────────────────

    function test_proposeAdmin_rejectsNonOwnerSigner() public {
        uint8[7] memory thresholds; thresholds[4] = 1;
        uint32[7] memory timelocks;
        _installValidator(1, thresholds, timelocks);

        bytes memory args = abi.encode(owner2);
        bytes32 proposeHash = _hashPropose(1, CustodyPolicy.CustodyAction.AddCustodian, args);
        // Stranger signs.
        bytes memory sigs = _signRaw(0xDEAD, proposeHash);

        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.AdminUnauthorizedSigner.selector,
            vm.addr(0xDEAD)
        ));
        validator.scheduleCustodyChange(
            address(acct),
            CustodyPolicy.CustodyAction.AddCustodian,
            args,
            sigs
        );
    }
}
