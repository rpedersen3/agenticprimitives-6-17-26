// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
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
    function _defaultTimelocks() internal pure returns (uint32[7] memory tl) {}
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
        dm = new DelegationManager(address(0));
        validator = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(validator),
            address(0xBB),
            address(0xCC),
            address(0xDD), address(0)
        );

        owner1    = vm.addr(OWNER1_PK);
        guardian1 = vm.addr(GUARDIAN1_PK);
        guardian2 = vm.addr(GUARDIAN2_PK);

        address[] memory owners = new address[](1);
        owners[0] = owner1;
        address[] memory trustees = new address[](2);
        trustees[0] = guardian1;
        trustees[1] = guardian2;
        AgentAccountInitParams memory p = AgentAccountInitParams({
            mode: 1,
            custodians: owners,
            trustees: trustees,
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0,

            initialPasskeyRpIdHash: bytes32(uint256(0x7270696468617368))
        });
        acct = factory.createAgentAccount(p, _defaultTimelocks(), 1);
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
        // setUp wires guardian1+guardian2 as factory-installed trustees
        // (required for mode>0 post-R0). Adding newGuardian bumps the
        // count from 2 → 3.
        _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.AddTrustee, abi.encode(newGuardian)
        );
        assertTrue(validator.isTrustee(address(acct), newGuardian));
        assertEq(validator.trusteeCount(address(acct)), 3);
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
        // setUp already wires guardian1+guardian2 as trustees with
        // recoveryApprovals=2 (factory's default = floor(N/2)+1). The
        // pre-R0 setup ceremony — AddTrustee×2 + SetRecoveryApprovals
        // — is now implicit at deploy.

        // T6 RecoverAccount.
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
        // setUp wires guardian1+guardian2 with recoveryApprovals=2.

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

    // ─── 9. ChangeApprovalsRequired (phase 6f.4) ──────────────────────

    /// @notice Happy path: with two custodians, bump T4 threshold from
    ///         1 → 2 via the new ChangeApprovalsRequired action.
    function test_admin_changeApprovalsRequired_t4_oneToTwo() public {
        // Add a second custodian first so the new threshold is reachable.
        _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.AddCustodian, abi.encode(newOwner)
        );
        assertEq(acct.custodianCount(), 2);
        assertEq(validator.approvalsRequired(address(acct), 4), 1);

        bytes memory args = abi.encode(uint8(4), uint8(2));
        _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args
        );

        assertEq(validator.approvalsRequired(address(acct), 4), 2);
        // T5 untouched.
        assertEq(validator.approvalsRequired(address(acct), 5), 1);
    }

    /// @notice After bumping T4 to 2, subsequent T4 admin changes need
    ///         two distinct custodian sigs — single-sig schedule reverts.
    function test_admin_changeApprovalsRequired_t4_enforcedAfterBump() public {
        // Add owner #2 (a pk we know — newOwner address only, no key, so
        // use guardian1 as the second custodian for signature purposes).
        _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.AddCustodian, abi.encode(guardian1)
        );
        _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.ChangeApprovalsRequired,
            abi.encode(uint8(4), uint8(2))
        );
        assertEq(validator.approvalsRequired(address(acct), 4), 2);

        // Single-sig (just OWNER1) should now fail with InsufficientQuorum.
        bytes memory args = abi.encode(newOwner);
        uint256 changeId = validator.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _payloadHash(
            bytes32("ADMIN_PROPOSE"), changeId, CustodyPolicy.CustodyAction.AddCustodian, args, 0
        );
        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.AdminInsufficientQuorum.selector, uint256(1), uint8(2)
        ));
        validator.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.AddCustodian, args, _signRaw(OWNER1_PK, ph)
        );

        // Two-sig flow now works.
        bytes memory twoSigs = _twoSigsSorted(OWNER1_PK, GUARDIAN1_PK, ph);
        validator.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.AddCustodian, args, twoSigs
        );
    }

    /// @notice Reverts when the requested threshold exceeds the current
    ///         custodian count (e.g. trying to set T4=3 on a 2-custodian
    ///         account).
    function test_admin_changeApprovalsRequired_revertsWhenAboveCustodianCount() public {
        _proposeAndExecuteByOwner(
            CustodyPolicy.CustodyAction.AddCustodian, abi.encode(newOwner)
        );
        bytes memory args = abi.encode(uint8(4), uint8(3));
        uint64 nowTs = uint64(block.timestamp);
        uint64 eta = nowTs + 1 hours;
        uint256 changeId = validator.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _payloadHash(
            bytes32("ADMIN_PROPOSE"), changeId,
            CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args, eta
        );
        validator.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args,
            _signRaw(OWNER1_PK, ph)
        );

        vm.warp(nowTs + 1 hours + 1);
        bytes32 eh = _payloadHash(
            bytes32("ADMIN_EXECUTE"), changeId,
            CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args, eta
        );
        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.InvalidThresholdValue.selector, uint8(3)
        ));
        validator.applyCustodyChange(address(acct), changeId, _signRaw(OWNER1_PK, eh));
    }

    /// @notice Reverts when newCount = 0 (would brick the tier).
    /// @dev Audit C-8 update: a REDUCTION of approvals (newCount=0 <
    ///      currentValue=1) now escalates to T5 quorum + T5 timelock
    ///      (24h default). The invariant under test is still that
    ///      `_applyChangeApprovalsRequired` rejects zero at apply time;
    ///      we just have to wait out the bigger timelock + use the
    ///      contract-computed eta in the apply hash.
    function test_admin_changeApprovalsRequired_revertsOnZero() public {
        bytes memory args = abi.encode(uint8(4), uint8(0));
        uint64 nowTs = uint64(block.timestamp);
        // T5 default timelock is 24h (Phase A.5 spec). Schedule first,
        // then read the eta the contract actually stored.
        uint256 changeId = validator.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _payloadHash(
            bytes32("ADMIN_PROPOSE"), changeId,
            CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args, 0 /* eta unused in propose hash */
        );
        validator.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args,
            _signRaw(OWNER1_PK, ph)
        );
        // Read the actually-stored eta + warp past it.
        (, , , uint64 actualEta, , , ) = validator.getScheduledChange(address(acct), changeId);
        vm.warp(uint256(actualEta) + 1);
        bytes32 eh = _payloadHash(
            bytes32("ADMIN_EXECUTE"), changeId,
            CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args, actualEta
        );
        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.InvalidThresholdValue.selector, uint8(0)
        ));
        validator.applyCustodyChange(address(acct), changeId, _signRaw(OWNER1_PK, eh));
    }

    /// @notice Reverts when tier is outside [1, 5] — tier 6 belongs to
    ///         SetRecoveryApprovals, tier 0 is invalid.
    function test_admin_changeApprovalsRequired_revertsOnInvalidTier() public {
        // Tier 6 — should route through SetRecoveryApprovals instead.
        bytes memory args6 = abi.encode(uint8(6), uint8(1));
        uint64 nowTs = uint64(block.timestamp);
        uint64 eta6 = nowTs + 1 hours;
        uint256 changeId6 = validator.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph6 = _payloadHash(
            bytes32("ADMIN_PROPOSE"), changeId6,
            CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args6, eta6
        );
        validator.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args6,
            _signRaw(OWNER1_PK, ph6)
        );
        vm.warp(nowTs + 1 hours + 1);
        bytes32 eh6 = _payloadHash(
            bytes32("ADMIN_EXECUTE"), changeId6,
            CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args6, eta6
        );
        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.InvalidTier.selector, uint8(6)
        ));
        validator.applyCustodyChange(address(acct), changeId6, _signRaw(OWNER1_PK, eh6));
    }
}
