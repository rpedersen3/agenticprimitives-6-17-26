// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/DelegationManager.sol";
import {CustodyPolicy} from "../src/modules/CustodyPolicy.sol";
import {AgentAccountInitParams, AgentAccountRecoveryArgs, AgentAccountRecoveryPasskeyAdd} from "../src/IAgentAccount.sol";

/// @dev Phase 6c.5-d.1.c — admin + recovery behavioral coverage targeting
///      the CustodyPolicy module. Replaces the pre-d.1 files
///      AgentAccountAdmin.t.sol + AgentAccountRecovery.t.sol which drove
///      the now-removed admin surface on AgentAccount itself.
///
///      Factory defaults T4=1h / T5=24h / T6=48h timelocks per spec 207
///      § 5, so each propose → warp → execute pair waits the right
///      window. The signature scheme is unchanged from the pre-d.1
///      contract — Safe-compatible packed slots, sorted-ascending.
contract AdminFlowsViaValidatorTest is Test {
    AgentAccountFactory factory;
    DelegationManager   dm;
    CustodyPolicy  validator;
    AgentAccount        acct;

    uint256 internal constant OWNER1_PK    = 0xA11CE;
    uint256 internal constant GUARDIAN1_PK = 0x60AD1A1;
    uint256 internal constant GUARDIAN2_PK = 0x60AD1A2;

    address internal owner1;
    address internal guardian1;
    address internal guardian2;

    address internal newOwner    = address(0xC0DE);
    address internal newGuardian = address(0xDADA);

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

        owner1    = vm.addr(OWNER1_PK);
        guardian1 = vm.addr(GUARDIAN1_PK);
        guardian2 = vm.addr(GUARDIAN2_PK);

        address[] memory owners = new address[](1);
        owners[0] = owner1;
        AgentAccountInitParams memory p = AgentAccountInitParams({
            mode: 1,
            owners: owners,
            guardians: new address[](0),
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0
        });
        acct = factory.createAccountWithMode(p, address(validator), 1);
    }

    // ─── Helpers ─────────────────────────────────────────────────────

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
        return keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("agenticprimitives.CustodyPolicy"),
            keccak256("1"),
            block.chainid,
            address(validator)
        ));
    }

    function _hashTypedData(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(bytes2(0x1901), _domainSeparator(), structHash));
    }

    /// @dev Accepts the legacy 5-arg shape so existing call sites compile;
    ///      `verb` selects the typehash; `eta` is ignored for propose,
    ///      required for execute + cancel.
    function _payloadHash(
        bytes32 verb,
        uint256 changeId,
        CustodyPolicy.CustodyAction action,
        bytes memory args,
        uint64 eta
    ) internal view returns (bytes32) {
        if (verb == bytes32("ADMIN_PROPOSE")) {
            return _hashTypedData(keccak256(abi.encode(
                PROPOSE_TYPEHASH, address(acct), uint8(action), keccak256(args), changeId
            )));
        }
        if (verb == bytes32("ADMIN_EXECUTE")) {
            return _hashTypedData(keccak256(abi.encode(
                EXECUTE_TYPEHASH, address(acct), uint8(action), keccak256(args), changeId, eta
            )));
        }
        // ADMIN_CANCEL
        return _hashTypedData(keccak256(abi.encode(
            CANCEL_TYPEHASH, address(acct), uint8(action), keccak256(args), changeId, eta
        )));
    }

    function _timelockFor(CustodyPolicy.CustodyAction action) internal pure returns (uint32) {
        if (action == CustodyPolicy.CustodyAction.RecoverAccount) return 48 hours;
        if (
            action == CustodyPolicy.CustodyAction.ApplySystemUpdate ||
            action == CustodyPolicy.CustodyAction.RotateDelegationManager ||
            action == CustodyPolicy.CustodyAction.RotatePaymaster ||
            action == CustodyPolicy.CustodyAction.RotateSessionIssuer
        ) return 24 hours;
        return 1 hours;
    }

    /// @notice Run the propose → warp → execute flow as owner1 (N=1, T4=1).
    function _proposeAndExecuteByOwner(
        CustodyPolicy.CustodyAction action,
        bytes memory args
    ) internal returns (uint256 changeId) {
        uint64 nowTs = uint64(block.timestamp);
        uint32 timelock = _timelockFor(action);
        uint64 eta = nowTs + timelock;
        changeId = validator.scheduledChangeCount(address(acct)) + 1;

        bytes32 ph = _payloadHash(bytes32("ADMIN_PROPOSE"), changeId, action, args, eta);
        validator.scheduleCustodyChange(address(acct), action, args, _signRaw(OWNER1_PK, ph));

        vm.warp(nowTs + timelock + 1);

        bytes32 eh = _payloadHash(bytes32("ADMIN_EXECUTE"), changeId, action, args, eta);
        validator.applyCustodyChange(address(acct), changeId, _signRaw(OWNER1_PK, eh));
    }

    function _twoSigsSorted(uint256 pk1, uint256 pk2, bytes32 hash) internal pure returns (bytes memory) {
        address a1 = vm.addr(pk1);
        address a2 = vm.addr(pk2);
        bytes memory s1 = _signRaw(pk1, hash);
        bytes memory s2 = _signRaw(pk2, hash);
        return a1 < a2 ? bytes.concat(s1, s2) : bytes.concat(s2, s1);
    }

    function _arr(address a) internal pure returns (address[] memory r) {
        r = new address[](1); r[0] = a;
    }

    // ─── 1. AddCustodian round-trip (N=1, T4 threshold = 1, T4 timelock 1h) ──

    function test_admin_addOwner_executes_via_validator() public {
        _proposeAndExecuteByOwner(CustodyPolicy.CustodyAction.AddCustodian, abi.encode(newOwner));
        assertTrue(acct.isCustodian(newOwner));
        assertEq(acct.custodianCount(), 2);
    }

    // ─── 2. AddTrustee writes to validator's per-account state ─────

    function test_admin_addGuardian_writes_to_validator_storage() public {
        _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.AddTrustee, abi.encode(newGuardian)
        );
        assertTrue(validator.isTrustee(address(acct), newGuardian));
        assertEq(validator.trusteeCount(address(acct)), 1);
    }

    // ─── 3. ChangeCustodyMode writes to validator's per-account state ──────

    function test_admin_changeMode_hybrid_to_threshold() public {
        _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.ChangeCustodyMode, abi.encode(uint8(2))
        );
        assertEq(validator.custodyMode(address(acct)), 2);
    }

    // ─── 4. Cancel blocks subsequent execute ────────────────────────

    function test_admin_cancel_blocks_subsequent_execute() public {
        bytes memory args = abi.encode(newOwner);
        uint64 nowTs = uint64(block.timestamp);
        uint64 eta = nowTs + 1 hours;
        uint256 changeId = 1;

        bytes32 ph = _payloadHash(
            bytes32("ADMIN_PROPOSE"), changeId, CustodyPolicy.CustodyAction.AddCustodian, args, eta
        );
        validator.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.AddCustodian, args, _signRaw(OWNER1_PK, ph)
        );

        bytes32 ch = _payloadHash(
            bytes32("ADMIN_CANCEL"), changeId, CustodyPolicy.CustodyAction.AddCustodian, args, eta
        );
        validator.cancelScheduledChange(address(acct), changeId, _signRaw(OWNER1_PK, ch));

        vm.warp(nowTs + 1 hours + 1);
        bytes32 eh = _payloadHash(
            bytes32("ADMIN_EXECUTE"), changeId, CustodyPolicy.CustodyAction.AddCustodian, args, eta
        );
        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.ProposalAlreadyCancelled.selector, changeId
        ));
        validator.applyCustodyChange(address(acct), changeId, _signRaw(OWNER1_PK, eh));
    }

    // ─── 5. Re-execute idempotent guard ─────────────────────────────

    function test_admin_double_execute_reverts() public {
        bytes memory args = abi.encode(newOwner);
        uint256 changeId = _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.AddCustodian, args
        );

        // Re-sign + try again with the same eta (proposal stored its eta).
        uint64 storedEta;
        (, , , storedEta, , ,) = validator.getScheduledChange(address(acct), changeId);
        bytes32 eh = _payloadHash(
            bytes32("ADMIN_EXECUTE"), changeId, CustodyPolicy.CustodyAction.AddCustodian, args, storedEta
        );
        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.ProposalAlreadyExecuted.selector, changeId
        ));
        validator.applyCustodyChange(address(acct), changeId, _signRaw(OWNER1_PK, eh));
    }

    // ─── 6. Unauthorized signer rejected ────────────────────────────

    function test_admin_propose_rejectsNonOwnerSigner() public {
        bytes memory args = abi.encode(newOwner);
        uint64 eta = uint64(block.timestamp) + 1 hours;
        bytes32 ph = _payloadHash(
            bytes32("ADMIN_PROPOSE"), 1, CustodyPolicy.CustodyAction.AddCustodian, args, eta
        );
        bytes memory sigs = _signRaw(0xDEADBEEF, ph);
        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.AdminUnauthorizedSigner.selector, vm.addr(0xDEADBEEF)
        ));
        validator.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.AddCustodian, args, sigs
        );
    }

    // ─── 7. T6 RecoverAccount via guardians (full round-trip) ───────

    function test_admin_recoverAccount_via_guardians() public {
        // Add 2 guardians, set recoveryApprovals = 2.
        _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.AddTrustee, abi.encode(guardian1)
        );
        _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.AddTrustee, abi.encode(guardian2)
        );
        _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.SetRecoveryApprovals, abi.encode(uint8(2))
        );

        // Now T6 RecoverAccount.
        AgentAccountRecoveryArgs memory r = AgentAccountRecoveryArgs({
            addOwners: _arr(newOwner),
            removeOwners: new address[](0),
            addPasskeys: new AgentAccountRecoveryPasskeyAdd[](0),
            removePasskeyCredentialIdDigests: new bytes32[](0)
        });
        bytes memory args = abi.encode(r);

        uint64 nowTs = uint64(block.timestamp);
        uint64 eta = nowTs + 48 hours;
        uint256 changeId = validator.scheduledChangeCount(address(acct)) + 1;

        bytes32 ph = _payloadHash(
            bytes32("ADMIN_PROPOSE"), changeId, CustodyPolicy.CustodyAction.RecoverAccount, args, eta
        );
        validator.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.RecoverAccount, args,
            _twoSigsSorted(GUARDIAN1_PK, GUARDIAN2_PK, ph)
        );

        vm.warp(nowTs + 48 hours + 1);

        bytes32 eh = _payloadHash(
            bytes32("ADMIN_EXECUTE"), changeId, CustodyPolicy.CustodyAction.RecoverAccount, args, eta
        );
        validator.applyCustodyChange(
            address(acct), changeId, _twoSigsSorted(GUARDIAN1_PK, GUARDIAN2_PK, eh)
        );

        assertTrue(acct.isCustodian(newOwner), "recovery added newOwner");
    }

    // ─── 8. T6 dual cancel window — primary owner short-circuit ─────

    function test_admin_recoverAccount_primaryOwner_can_cancel_in_24h_window() public {
        _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.AddTrustee, abi.encode(guardian1)
        );
        _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.AddTrustee, abi.encode(guardian2)
        );
        _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.SetRecoveryApprovals, abi.encode(uint8(2))
        );

        AgentAccountRecoveryArgs memory r = AgentAccountRecoveryArgs({
            addOwners: _arr(newOwner),
            removeOwners: new address[](0),
            addPasskeys: new AgentAccountRecoveryPasskeyAdd[](0),
            removePasskeyCredentialIdDigests: new bytes32[](0)
        });
        bytes memory args = abi.encode(r);
        uint64 nowTs = uint64(block.timestamp);
        uint64 eta = nowTs + 48 hours;
        uint256 changeId = validator.scheduledChangeCount(address(acct)) + 1;

        bytes32 ph = _payloadHash(
            bytes32("ADMIN_PROPOSE"), changeId, CustodyPolicy.CustodyAction.RecoverAccount, args, eta
        );
        validator.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.RecoverAccount, args,
            _twoSigsSorted(GUARDIAN1_PK, GUARDIAN2_PK, ph)
        );

        // Within 24h, owner cancels with T4 threshold (1).
        bytes32 ch = _payloadHash(
            bytes32("ADMIN_CANCEL"), changeId, CustodyPolicy.CustodyAction.RecoverAccount, args, eta
        );
        validator.cancelScheduledChange(address(acct), changeId, _signRaw(OWNER1_PK, ch));

        vm.warp(nowTs + 48 hours + 1);
        bytes32 eh = _payloadHash(
            bytes32("ADMIN_EXECUTE"), changeId, CustodyPolicy.CustodyAction.RecoverAccount, args, eta
        );
        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.ProposalAlreadyCancelled.selector, changeId
        ));
        validator.applyCustodyChange(
            address(acct), changeId, _twoSigsSorted(GUARDIAN1_PK, GUARDIAN2_PK, eh)
        );
    }
}
