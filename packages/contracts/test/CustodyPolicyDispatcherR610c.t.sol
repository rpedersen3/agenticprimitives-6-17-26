// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * R6.10c — CustodyPolicy action-dispatcher happy paths + remaining
 *          branch families.
 *
 * Builds on R6.10b. Where R6.10b covered the error branches in
 * schedule/apply/cancel + views + handler reverts, R6.10c covers the
 * dispatcher happy paths that were never exercised:
 *
 *   - RemoveCustodian
 *   - AddPasskeyCredential
 *   - RemovePasskeyCredential
 *   - RemoveTrustee (happy + the RecoveryRequiresGuardians block)
 *   - RotateAllCustodians (add-only, remove-only, both, ZeroAddress)
 *   - ApplySystemUpdate (UUPS proxy upgrade through the policy)
 *   - RotateDelegationManager
 *
 * Plus three branch families R6.10b left for completeness:
 *   - _verifyQuorum guardianMode=true UnauthorizedTrustee branch
 *   - Recovery cancel-window (in vs out of 24h primary-cancel window)
 *   - _applyRemoveGuardian DoesNotExist + recovery-quorum guard
 */

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
import {AgentAccountInitParams, AgentAccountRecoveryArgs, AgentAccountRecoveryPasskeyAdd} from "../src/IAgentAccount.sol";

contract CustodyPolicyDispatcherR610cTest is Test {
    EntryPoint internal ep;
    AgentAccountFactory internal factory;
    DelegationManager   internal dm;
    CustodyPolicy       internal policy;
    AgentAccount        internal acct;

    uint256 internal constant OWNER_PK     = 0xA11CE;
    uint256 internal constant OWNER2_PK    = 0xBEEF;
    uint256 internal constant GUARDIAN1_PK = 0x60AD1A1;
    uint256 internal constant GUARDIAN2_PK = 0x60AD1A2;
    uint256 internal constant STRANGER_PK  = 0xDEADBEEF;

    address internal owner;
    address internal owner2;
    address internal guardian1;
    address internal guardian2;
    address internal stranger;

    function setUp() public {
        ep = new EntryPoint();
        dm = new DelegationManager(address(0));
        policy = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(policy),
            address(0xBB),
            address(0xCC),
            address(0xDD), address(0)
        );

        owner     = vm.addr(OWNER_PK);
        owner2    = vm.addr(OWNER2_PK);
        guardian1 = vm.addr(GUARDIAN1_PK);
        guardian2 = vm.addr(GUARDIAN2_PK);
        stranger  = vm.addr(STRANGER_PK);

        address[] memory owners = new address[](1);
        owners[0] = owner;
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
        uint32[7] memory tl;
        acct = factory.createAgentAccount(p, tl, 1);
    }

    // ─── Hash helpers ───────────────────────────────────────────────

    function _signRaw(uint256 pk, bytes32 hash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hash);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Two sigs concatenated in ascending-address order (the policy
    ///      enforces sorted slots).
    function _twoSigsSorted(uint256 pk1, uint256 pk2, bytes32 hash) internal pure returns (bytes memory) {
        address a1 = vm.addr(pk1);
        address a2 = vm.addr(pk2);
        bytes memory s1 = _signRaw(pk1, hash);
        bytes memory s2 = _signRaw(pk2, hash);
        return a1 < a2 ? bytes.concat(s1, s2) : bytes.concat(s2, s1);
    }

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

    function _domSep() internal view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_TYPEHASH, keccak256("agenticprimitives.CustodyPolicy"),
            keccak256("1"), block.chainid, address(policy)
        ));
    }
    function _typed(bytes32 sh) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(bytes2(0x1901), _domSep(), sh));
    }
    function _hProp(uint256 cid, CustodyPolicy.CustodyAction a, bytes memory args) internal view returns (bytes32) {
        return _typed(keccak256(abi.encode(PROPOSE_TYPEHASH, address(acct), uint8(a), keccak256(args), cid)));
    }
    function _hExec(uint256 cid, CustodyPolicy.CustodyAction a, bytes memory args, uint64 eta) internal view returns (bytes32) {
        return _typed(keccak256(abi.encode(EXECUTE_TYPEHASH, address(acct), uint8(a), keccak256(args), cid, eta)));
    }
    function _hCancel(uint256 cid, CustodyPolicy.CustodyAction a, bytes memory args, uint64 eta) internal view returns (bytes32) {
        return _typed(keccak256(abi.encode(CANCEL_TYPEHASH, address(acct), uint8(a), keccak256(args), cid, eta)));
    }

    function _t4() internal pure returns (uint32) { return 1 hours; }
    function _t5() internal pure returns (uint32) { return 24 hours; }
    function _t6() internal pure returns (uint32) { return 48 hours; }

    /// @dev Owner-signed schedule + warp + apply (N=1, T4=1).
    function _schedAndApply(CustodyPolicy.CustodyAction a, bytes memory args, uint32 timelock)
        internal returns (uint256 cid)
    {
        uint64 nowTs = uint64(block.timestamp);
        uint64 eta = nowTs + timelock;
        cid = policy.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _hProp(cid, a, args);
        policy.scheduleCustodyChange(address(acct), a, args, _signRaw(OWNER_PK, ph));
        vm.warp(nowTs + timelock + 1);
        bytes32 eh = _hExec(cid, a, args, eta);
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function _schedOnly(CustodyPolicy.CustodyAction a, bytes memory args)
        internal returns (uint256 cid, uint64 eta)
    {
        cid = policy.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _hProp(cid, a, args);
        policy.scheduleCustodyChange(address(acct), a, args, _signRaw(OWNER_PK, ph));
        ( , , , eta, , , ) = policy.getScheduledChange(address(acct), cid);
    }

    // ───────────────────────────────────────────────────────────────
    // ─── Dispatcher happy paths (R6.10c headline) ──────────────────
    // ───────────────────────────────────────────────────────────────

    function test_R6_10c_removeCustodian_happyPath() public {
        // First add owner2 (so the account has 2 custodians + the
        // "cannot remove last" guard doesn't fire).
        _schedAndApply(CustodyPolicy.CustodyAction.AddCustodian, abi.encode(owner2), _t4());
        assertTrue(acct.isCustodian(owner2));
        // Now remove the original owner.
        _schedAndApply(CustodyPolicy.CustodyAction.RemoveCustodian, abi.encode(owner), _t4());
        assertFalse(acct.isCustodian(owner));
        assertTrue(acct.isCustodian(owner2));
    }

    function test_R6_10c_addPasskeyCredential_happyPath() public {
        bytes32 cid = keccak256("alice.passkey.v1");
        bytes32 rpIdHash = bytes32(uint256(0x7270696468617368));
        bytes memory args = abi.encode(cid, uint256(12345), uint256(67890), rpIdHash);
        _schedAndApply(CustodyPolicy.CustodyAction.AddPasskeyCredential, args, _t4());
        // No revert ⇒ pass; full passkey-state assertions live in
        // AgentAccount tests. R6.10c is just exercising the dispatcher
        // branch + the encodeWithSignature trampoline.
    }

    function test_R6_10c_removePasskeyCredential_happyPath() public {
        // Add first, then remove.
        bytes32 cid = keccak256("alice.passkey.v2");
        bytes32 rpIdHash = bytes32(uint256(0x7270696468617368));
        bytes memory addArgs = abi.encode(cid, uint256(11111), uint256(22222), rpIdHash);
        _schedAndApply(CustodyPolicy.CustodyAction.AddPasskeyCredential, addArgs, _t4());

        bytes memory rmArgs = abi.encode(cid);
        _schedAndApply(CustodyPolicy.CustodyAction.RemovePasskeyCredential, rmArgs, _t4());
    }

    function test_R6_10c_removeTrustee_happyPath_afterLoweringRecoveryThreshold() public {
        // Fixture: 2 trustees, recoveryApprovals=2 (factory default).
        // Removing a trustee would leave 1 < 2 → RecoveryRequiresGuardians.
        // Lower recoveryApprovals to 1 first, then remove succeeds.
        _schedAndApply(CustodyPolicy.CustodyAction.SetRecoveryApprovals, abi.encode(uint8(1)), _t4());
        assertEq(policy.recoveryApprovals(address(acct)), 1);

        _schedAndApply(CustodyPolicy.CustodyAction.RemoveTrustee, abi.encode(guardian1), _t4());
        assertFalse(policy.isTrustee(address(acct), guardian1));
        assertEq(policy.trusteeCount(address(acct)), 1);
    }

    function test_R6_10c_removeTrustee_revertsRecoveryRequiresGuardians() public {
        // Without lowering recoveryApprovals first → reverts.
        bytes memory args = abi.encode(guardian1);
        uint256 cid = policy.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _hProp(cid, CustodyPolicy.CustodyAction.RemoveTrustee, args);
        policy.scheduleCustodyChange(address(acct), CustodyPolicy.CustodyAction.RemoveTrustee, args, _signRaw(OWNER_PK, ph));
        vm.warp(block.timestamp + _t4() + 1);
        ( , , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.RemoveTrustee, args, eta);
        vm.expectRevert(CustodyPolicy.RecoveryRequiresGuardians.selector);
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function test_R6_10c_removeTrustee_revertsTrusteeDoesNotExist() public {
        // Random non-trustee → TrusteeDoesNotExist.
        bytes memory args = abi.encode(stranger);
        uint256 cid = policy.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _hProp(cid, CustodyPolicy.CustodyAction.RemoveTrustee, args);
        policy.scheduleCustodyChange(address(acct), CustodyPolicy.CustodyAction.RemoveTrustee, args, _signRaw(OWNER_PK, ph));
        vm.warp(block.timestamp + _t4() + 1);
        ( , , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.RemoveTrustee, args, eta);
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.TrusteeDoesNotExist.selector, stranger));
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function test_R6_10c_rotateAllCustodians_addOnly_happyPath() public {
        address[] memory add = new address[](1); add[0] = owner2;
        address[] memory rem = new address[](0);
        bytes memory args = abi.encode(add, rem);
        _schedAndApply(CustodyPolicy.CustodyAction.RotateAllCustodians, args, _t4());
        assertTrue(acct.isCustodian(owner2));
        assertTrue(acct.isCustodian(owner), "original retained");
    }

    function test_R6_10c_rotateAllCustodians_addAndRemove_happyPath() public {
        // Add owner2 + remove owner1 in one ceremony — covers the
        // "add first, then remove" ordering invariant.
        address[] memory add = new address[](1); add[0] = owner2;
        address[] memory rem = new address[](1); rem[0] = owner;
        bytes memory args = abi.encode(add, rem);
        _schedAndApply(CustodyPolicy.CustodyAction.RotateAllCustodians, args, _t4());
        assertTrue(acct.isCustodian(owner2));
        assertFalse(acct.isCustodian(owner));
    }

    function test_R6_10c_rotateAllCustodians_addAlreadyPresent_isSkipped() public {
        // owner is already a custodian → the !isCustodian(o) branch is
        // false → no addCustodian call → `added` stays 0. Covers the
        // skip-branch in _applyRotateAllOwners.
        address[] memory add = new address[](1); add[0] = owner; // already!
        address[] memory rem = new address[](0);
        bytes memory args = abi.encode(add, rem);
        _schedAndApply(CustodyPolicy.CustodyAction.RotateAllCustodians, args, _t4());
        assertTrue(acct.isCustodian(owner)); // still a custodian
    }

    function test_R6_10c_rotateAllCustodians_removeAlreadyAbsent_isSkipped() public {
        // owner2 is not yet a custodian. Both add and remove must be
        // non-empty (else EmptyOwnerSet); we add a real one and remove
        // an already-absent one. The skip branch on the remove side fires.
        address[] memory add = new address[](1); add[0] = owner2;
        address[] memory rem = new address[](1); rem[0] = stranger; // not a custodian
        bytes memory args = abi.encode(add, rem);
        _schedAndApply(CustodyPolicy.CustodyAction.RotateAllCustodians, args, _t4());
        assertTrue(acct.isCustodian(owner2));
        assertFalse(acct.isCustodian(stranger));
    }

    function test_R6_10c_rotateAllCustodians_revertsZeroAddressInAdd() public {
        address[] memory add = new address[](1); add[0] = address(0);
        address[] memory rem = new address[](0);
        bytes memory args = abi.encode(add, rem);
        uint256 cid = policy.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _hProp(cid, CustodyPolicy.CustodyAction.RotateAllCustodians, args);
        policy.scheduleCustodyChange(address(acct), CustodyPolicy.CustodyAction.RotateAllCustodians, args, _signRaw(OWNER_PK, ph));
        vm.warp(block.timestamp + _t4() + 1);
        ( , , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.RotateAllCustodians, args, eta);
        vm.expectRevert(CustodyPolicy.ZeroAddress.selector);
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function test_R6_10c_rotateAllCustodians_revertsZeroAddressInRemove() public {
        address[] memory add = new address[](1); add[0] = owner2;
        address[] memory rem = new address[](1); rem[0] = address(0);
        bytes memory args = abi.encode(add, rem);
        uint256 cid = policy.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _hProp(cid, CustodyPolicy.CustodyAction.RotateAllCustodians, args);
        policy.scheduleCustodyChange(address(acct), CustodyPolicy.CustodyAction.RotateAllCustodians, args, _signRaw(OWNER_PK, ph));
        vm.warp(block.timestamp + _t4() + 1);
        ( , , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.RotateAllCustodians, args, eta);
        vm.expectRevert(CustodyPolicy.ZeroAddress.selector);
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function test_R6_10c_applySystemUpdate_happyPath() public {
        // Deploy a fresh AgentAccount implementation; the policy schedules
        // upgradeToAndCall to that impl. T5 timelock (24h) applies.
        AgentAccount newImpl = new AgentAccount(IEntryPoint(address(ep)), address(0));
        bytes memory args = abi.encode(address(newImpl));
        _schedAndApply(CustodyPolicy.CustodyAction.ApplySystemUpdate, args, _t5());
        // The acct version is the new impl's version. Both impls return
        // the same string, so we assert that the upgrade EVENT path did
        // not revert (which `_schedAndApply` would have done) and that
        // the implementation slot has changed.
        // ERC-1967 impl slot:
        bytes32 implSlot = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
        bytes32 raw = vm.load(address(acct), implSlot);
        assertEq(address(uint160(uint256(raw))), address(newImpl));
    }

    function test_R6_10c_rotateDelegationManager_happyPath() public {
        DelegationManager newDm = new DelegationManager(address(0));
        bytes memory args = abi.encode(address(newDm));
        _schedAndApply(CustodyPolicy.CustodyAction.RotateDelegationManager, args, _t5());
        assertEq(acct.delegationManager(), address(newDm));
    }

    // ───────────────────────────────────────────────────────────────
    // ─── _verifyQuorum guardianMode=true UnauthorizedTrustee ───────
    // ───────────────────────────────────────────────────────────────

    function test_R6_10c_recoverySchedule_revertsUnauthorizedTrustee() public {
        // Fixture: 2 trustees + recoveryApprovals=2. Schedule RecoverAccount
        // signed by `stranger` (not a trustee) → UnauthorizedTrustee.
        // Need to satisfy reqThreshold=2 first; supply 2 stranger sigs in
        // sorted order via a second non-trustee key.
        uint256 stranger2Pk = 0xCAFE;
        address stranger2 = vm.addr(stranger2Pk);
        AgentAccountRecoveryArgs memory r;
        bytes memory args = abi.encode(r);
        bytes32 ph = _hProp(1, CustodyPolicy.CustodyAction.RecoverAccount, args);
        bytes memory sigs = _twoSigsSorted(STRANGER_PK, stranger2Pk, ph);
        address firstSigner = stranger < stranger2 ? stranger : stranger2;
        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.UnauthorizedTrustee.selector, firstSigner
        ));
        policy.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.RecoverAccount, args, sigs
        );
    }

    // ───────────────────────────────────────────────────────────────
    // ─── Recovery cancel-window (in vs out of 24h primary window) ──
    // ───────────────────────────────────────────────────────────────

    function _scheduleRecoveryBy2Trustees() internal returns (uint256 cid, uint64 eta, bytes memory args) {
        AgentAccountRecoveryArgs memory r;
        r.addOwners = new address[](1); r.addOwners[0] = owner2;
        r.addPasskeys = new AgentAccountRecoveryPasskeyAdd[](0);
        r.removeOwners = new address[](0);
        r.removePasskeyCredentialIdDigests = new bytes32[](0);
        args = abi.encode(r);
        cid = policy.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _hProp(cid, CustodyPolicy.CustodyAction.RecoverAccount, args);
        bytes memory sigs = _twoSigsSorted(GUARDIAN1_PK, GUARDIAN2_PK, ph);
        policy.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.RecoverAccount, args, sigs
        );
        ( , , , eta, , , ) = policy.getScheduledChange(address(acct), cid);
    }

    function test_R6_10c_recovery_cancel_inWindow_byCustodian() public {
        // Trustees propose recovery; in the 24h primary-cancel window
        // the custodian (T4 quorum, here N=1) can cancel.
        (uint256 cid, uint64 eta, bytes memory args) = _scheduleRecoveryBy2Trustees();

        bytes32 ch = _hCancel(cid, CustodyPolicy.CustodyAction.RecoverAccount, args, eta);
        // Still within 24h → custodian quorum check (guardianMode=false).
        policy.cancelScheduledChange(address(acct), cid, _signRaw(OWNER_PK, ch));

        ( , , , , , , bool cancelled) = policy.getScheduledChange(address(acct), cid);
        assertTrue(cancelled);
    }

    function test_R6_10c_recovery_cancel_outOfWindow_byTrustees() public {
        // After the 24h window closes, the cancel-quorum flips to
        // trustees (guardianMode=true). Custodian sig now fails;
        // 2 trustee sigs succeed.
        (uint256 cid, uint64 eta, bytes memory args) = _scheduleRecoveryBy2Trustees();
        // Jump 24h+1 forward but stay before eta (48h) so apply isn't ready yet.
        vm.warp(block.timestamp + 24 hours + 1);

        bytes32 ch = _hCancel(cid, CustodyPolicy.CustodyAction.RecoverAccount, args, eta);
        bytes memory sigs = _twoSigsSorted(GUARDIAN1_PK, GUARDIAN2_PK, ch);
        policy.cancelScheduledChange(address(acct), cid, sigs);

        ( , , , , , , bool cancelled) = policy.getScheduledChange(address(acct), cid);
        assertTrue(cancelled);
    }

    function test_R6_10c_recovery_cancel_outOfWindow_custodianSigRejected() public {
        // After 24h, custodian sig can no longer cancel — guardian mode flipped.
        (uint256 cid, uint64 eta, bytes memory args) = _scheduleRecoveryBy2Trustees();
        vm.warp(block.timestamp + 24 hours + 1);

        bytes32 ch = _hCancel(cid, CustodyPolicy.CustodyAction.RecoverAccount, args, eta);
        // Single custodian sig: signatures.length=65 but reqThreshold = recoveryApprovals = 2
        // → AdminInsufficientQuorum first. We still cover the "guardianMode=true on cancel"
        // path by checking that a single guardian sig fails sub-threshold too.
        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.AdminInsufficientQuorum.selector, uint256(1), uint8(2)
        ));
        policy.cancelScheduledChange(address(acct), cid, _signRaw(OWNER_PK, ch));
    }
}
