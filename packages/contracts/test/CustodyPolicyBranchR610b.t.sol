// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * R6.10b — CustodyPolicy branch-coverage push.
 *
 * R6.9 surfaced CustodyPolicy at 70.1% lines / 30.0% branches — the last
 * remaining security-critical branch-coverage gap. Existing tests
 * (CustodyPolicy.t.sol, CustodyPolicyWave2C.t.sol, AdminFlowsViaValidator.t.sol)
 * exercise the happy paths for AddCustodian, AddTrustee, ChangeMode,
 * ChangeApprovalsRequired, RecoverAccount, and the C-6..C-11 invariants —
 * but never touch the schedule/apply/cancel error branches, the rarer
 * dispatcher actions (RotatePaymaster, ChangeValueCeiling,
 * SetRecoveryApprovals), the view-revert InvalidTier paths, or the
 * effective-tier early-return branches.
 *
 * This file adds focused tests for each missing branch family.
 */

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
import {AgentAccountInitParams} from "../src/IAgentAccount.sol";

contract CustodyPolicyBranchR610bTest is Test {
    AgentAccountFactory internal factory;
    DelegationManager   internal dm;
    CustodyPolicy       internal policy;
    AgentAccount        internal acct;

    uint256 internal constant OWNER_PK    = 0xA11CE;
    uint256 internal constant GUARDIAN1_PK = 0x60AD1A1;
    uint256 internal constant GUARDIAN2_PK = 0x60AD1A2;
    address internal owner;
    address internal guardian1;
    address internal guardian2;

    function setUp() public {
        EntryPoint ep = new EntryPoint();
        dm = new DelegationManager(address(0));
        policy = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(policy),
            address(0xBB),
            address(0xCC),
            address(0xDD)
        );

        owner     = vm.addr(OWNER_PK);
        guardian1 = vm.addr(GUARDIAN1_PK);
        guardian2 = vm.addr(GUARDIAN2_PK);

        address[] memory owners = new address[](1);
        owners[0] = owner;
        address[] memory trustees = new address[](2);
        trustees[0] = guardian1;
        trustees[1] = guardian2;

        AgentAccountInitParams memory p = AgentAccountInitParams({
            mode: 1, // hybrid → factory auto-installs policy + sets default tiers
            custodians: owners,
            trustees: trustees,
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0,
            initialPasskeyRpIdHash: bytes32(uint256(0x7270696468617368))
        });
        uint32[7] memory tl; // factory applies defaults T4=1h, T5=24h, T6=48h
        acct = factory.createAgentAccount(p, tl, 1);
    }

    // ─── Helpers ────────────────────────────────────────────────────

    function _signRaw(uint256 pk, bytes32 hash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hash);
        return abi.encodePacked(r, s, v);
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

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("agenticprimitives.CustodyPolicy"),
            keccak256("1"),
            block.chainid,
            address(policy)
        ));
    }

    function _typed(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(bytes2(0x1901), _domainSeparator(), structHash));
    }

    function _hProp(uint256 cid, CustodyPolicy.CustodyAction a, bytes memory args, address acctAddr)
        internal view returns (bytes32)
    {
        return _typed(keccak256(abi.encode(PROPOSE_TYPEHASH, acctAddr, uint8(a), keccak256(args), cid)));
    }

    function _hExec(uint256 cid, CustodyPolicy.CustodyAction a, bytes memory args, uint64 eta, address acctAddr)
        internal view returns (bytes32)
    {
        return _typed(keccak256(abi.encode(EXECUTE_TYPEHASH, acctAddr, uint8(a), keccak256(args), cid, eta)));
    }

    function _hCancel(uint256 cid, CustodyPolicy.CustodyAction a, bytes memory args, uint64 eta, address acctAddr)
        internal view returns (bytes32)
    {
        return _typed(keccak256(abi.encode(CANCEL_TYPEHASH, acctAddr, uint8(a), keccak256(args), cid, eta)));
    }

    function _t4Timelock() internal pure returns (uint32) { return 1 hours; }
    function _t5Timelock() internal pure returns (uint32) { return 24 hours; }
    function _t6Timelock() internal pure returns (uint32) { return 48 hours; }

    /// @dev Schedule + warp + apply, all signed by `owner` (N=1 setup).
    function _schedAndApply(CustodyPolicy.CustodyAction a, bytes memory args, uint32 timelock)
        internal returns (uint256 changeId)
    {
        uint64 nowTs = uint64(block.timestamp);
        uint64 eta = nowTs + timelock;
        changeId = policy.scheduledChangeCount(address(acct)) + 1;

        bytes32 ph = _hProp(changeId, a, args, address(acct));
        policy.scheduleCustodyChange(address(acct), a, args, _signRaw(OWNER_PK, ph));
        vm.warp(nowTs + timelock + 1);

        bytes32 eh = _hExec(changeId, a, args, eta, address(acct));
        policy.applyCustodyChange(address(acct), changeId, _signRaw(OWNER_PK, eh));
    }

    /// @dev Schedule only (no apply) by `owner`, returns changeId + eta.
    function _schedOnly(CustodyPolicy.CustodyAction a, bytes memory args, uint32 timelock)
        internal returns (uint256 changeId, uint64 eta)
    {
        uint64 nowTs = uint64(block.timestamp);
        eta = nowTs + timelock;
        changeId = policy.scheduledChangeCount(address(acct)) + 1;

        bytes32 ph = _hProp(changeId, a, args, address(acct));
        policy.scheduleCustodyChange(address(acct), a, args, _signRaw(OWNER_PK, ph));
    }

    function _freshMode0Acct() internal returns (AgentAccount fresh) {
        // mode=0 → factory does NOT install the policy.
        address[] memory owners = new address[](1);
        owners[0] = owner;
        AgentAccountInitParams memory p = AgentAccountInitParams({
            mode: 0,
            custodians: owners,
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0,
            initialPasskeyRpIdHash: bytes32(uint256(0x7270696468617368))
        });
        uint32[7] memory tl;
        fresh = factory.createAgentAccount(p, tl, uint256(uint160(address(this))) + block.timestamp);
        assertFalse(policy.isInstalledOn(address(fresh)), "fresh mode=0 should not have policy installed");
    }

    // ───────────────────────────────────────────────────────────────
    // ─── A — schedule-time error branches ──────────────────────────
    // ───────────────────────────────────────────────────────────────

    function test_R6_10b_schedule_revertsNotInstalled() public {
        AgentAccount fresh = _freshMode0Acct();
        bytes memory args = abi.encode(address(0xC0DE));
        bytes32 ph = _hProp(1, CustodyPolicy.CustodyAction.AddCustodian, args, address(fresh));
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.NotInstalledOn.selector, address(fresh)));
        policy.scheduleCustodyChange(
            address(fresh),
            CustodyPolicy.CustodyAction.AddCustodian,
            args,
            _signRaw(OWNER_PK, ph)
        );
    }

    function test_R6_10b_schedule_revertsRecoveryRequiresGuardianQuorum_zeroRecoveryApprovals() public {
        // The factory always derives `recoveryApprovals = trustees/2 + 1`,
        // so the only way to hit `RecoveryRequiresGuardianQuorum` is to
        // install the policy directly on a mock account with custom
        // params (recoveryApprovals=0 + at least one trustee + T6
        // timelock > 0 so the TimelockRequiredForTier(6) check passes).
        address mockAcct = address(0xACC10);
        address[] memory trustees = new address[](1);
        trustees[0] = guardian1;
        uint8[7] memory thresholds; thresholds[4] = 1;
        uint32[7] memory timelocks; timelocks[6] = 1; // any non-zero
        bytes memory initData = abi.encode(
            uint8(1),       // mode = hybrid
            uint8(0),       // recoveryApprovals = 0 ← trigger
            trustees,
            thresholds,
            timelocks,
            uint256(0),
            address(0)
        );
        vm.prank(mockAcct);
        policy.onInstall(initData);
        assertEq(policy.recoveryApprovals(mockAcct), 0);
        assertEq(policy.trusteeCount(mockAcct), 1);

        bytes memory args = hex""; // doesn't matter — reverts before decode
        bytes32 ph = _hProp(1, CustodyPolicy.CustodyAction.RecoverAccount, args, mockAcct);
        vm.expectRevert(CustodyPolicy.RecoveryRequiresGuardianQuorum.selector);
        policy.scheduleCustodyChange(
            mockAcct,
            CustodyPolicy.CustodyAction.RecoverAccount,
            args,
            _signRaw(GUARDIAN1_PK, ph)
        );
    }

    function test_R6_10b_schedule_revertsRecoveryRequiresGuardianQuorum_zeroTrusteeCount() public {
        // Same revert via the OTHER `||` branch: trusteeCount==0.
        address mockAcct = address(0xACC11);
        uint8[7] memory thresholds; thresholds[4] = 1;
        uint32[7] memory timelocks; timelocks[6] = 1;
        bytes memory initData = abi.encode(
            uint8(1),
            uint8(1),       // recoveryApprovals=1, but trusteeCount=0 still triggers
            new address[](0),
            thresholds,
            timelocks,
            uint256(0),
            address(0)
        );
        vm.prank(mockAcct);
        policy.onInstall(initData);
        assertEq(policy.trusteeCount(mockAcct), 0);

        bytes memory args = hex"";
        bytes32 ph = _hProp(1, CustodyPolicy.CustodyAction.RecoverAccount, args, mockAcct);
        vm.expectRevert(CustodyPolicy.RecoveryRequiresGuardianQuorum.selector);
        policy.scheduleCustodyChange(
            mockAcct,
            CustodyPolicy.CustodyAction.RecoverAccount,
            args,
            _signRaw(GUARDIAN1_PK, ph)
        );
    }

    function test_R6_10b_schedule_revertsAdminInsufficientQuorum_emptySigs() public {
        bytes memory args = abi.encode(address(0xC0DE));
        // sigs is empty → signatures.length < reqThreshold(=1) * 65 → revert
        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.AdminInsufficientQuorum.selector, uint256(0), uint8(1)
        ));
        policy.scheduleCustodyChange(
            address(acct),
            CustodyPolicy.CustodyAction.AddCustodian,
            args,
            hex""
        );
    }

    function test_R6_10b_schedule_revertsAdminDuplicateOrUnsortedSigner() public {
        // Bump T4 quorum to 2; then send two identical signatures →
        // signer<=prev triggers AdminDuplicateOrUnsortedSigner. Need 2
        // custodians + raise threshold via ChangeApprovalsRequired first.
        // Simpler: just send two identical sigs over the same hash, even
        // with reqThreshold=1 the slot-0 + slot-1 read with same address
        // would not trigger the path; we need req=2.
        //
        // We test the duplicate-signer branch directly by manually
        // crafting a 2-sig payload at threshold-2 against a fresh mode=2
        // account that we install with thresholds[4]=2.

        // For the simplest path: create a fresh acct via the policy's
        // direct onInstall + 2 custodians, then bump T4=2.
        address[] memory owners = new address[](2);
        owners[0] = owner;
        owners[1] = guardian1;
        AgentAccountInitParams memory p = AgentAccountInitParams({
            mode: 2, // threshold mode → trustees required + thresholds set
            custodians: owners,
            trustees: _twoTrustees(),
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0,
            initialPasskeyRpIdHash: bytes32(uint256(0x7270696468617368))
        });
        uint32[7] memory tl;
        AgentAccount thrAcct = factory.createAgentAccount(p, tl, 7777);
        // Factory's default threshold for n=2 T4 = 2 (defaultApprovals matrix).
        assertEq(policy.approvalsRequired(address(thrAcct), 4), 2);

        bytes memory args = abi.encode(address(0xCAFE));
        bytes32 ph = _hProp(1, CustodyPolicy.CustodyAction.AddCustodian, args, address(thrAcct));
        bytes memory sig = _signRaw(OWNER_PK, ph);
        bytes memory sigs = bytes.concat(sig, sig); // two identical → second signer == first → !> prev
        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.AdminDuplicateOrUnsortedSigner.selector, owner
        ));
        policy.scheduleCustodyChange(
            address(thrAcct),
            CustodyPolicy.CustodyAction.AddCustodian,
            args,
            sigs
        );
    }

    function _twoTrustees() internal view returns (address[] memory t) {
        t = new address[](2);
        t[0] = guardian1;
        t[1] = guardian2;
    }

    // ───────────────────────────────────────────────────────────────
    // ─── B — apply-time error branches ─────────────────────────────
    // ───────────────────────────────────────────────────────────────

    function test_R6_10b_apply_revertsNotInstalled() public {
        AgentAccount fresh = _freshMode0Acct();
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.NotInstalledOn.selector, address(fresh)));
        policy.applyCustodyChange(address(fresh), 1, hex"");
    }

    function test_R6_10b_apply_revertsProposalNotFound() public {
        // Random changeId with no scheduled proposal → eta == 0 → ProposalNotFound.
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.ProposalNotFound.selector, uint256(99)));
        policy.applyCustodyChange(address(acct), 99, hex"");
    }

    function test_R6_10b_apply_revertsProposalNotReady() public {
        // Schedule normally; do NOT warp. Apply must revert ProposalNotReady.
        bytes memory args = abi.encode(address(0xC0DE));
        (uint256 cid, uint64 eta) = _schedOnly(CustodyPolicy.CustodyAction.AddCustodian, args, _t4Timelock());

        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.AddCustodian, args, eta, address(acct));
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.ProposalNotReady.selector, cid, eta));
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function test_R6_10b_apply_revertsProposalAlreadyExecuted() public {
        bytes memory args = abi.encode(address(0xC0DE));
        uint256 cid = _schedAndApply(CustodyPolicy.CustodyAction.AddCustodian, args, _t4Timelock());

        // Second apply with a freshly-signed payload over the same hash;
        // executed flag now set.
        // Re-derive the eta the contract stored.
        (, , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.AddCustodian, args, eta, address(acct));
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.ProposalAlreadyExecuted.selector, cid));
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function test_R6_10b_apply_revertsProposalAlreadyCancelled() public {
        // Schedule → cancel → apply must reject with AlreadyCancelled.
        bytes memory args = abi.encode(address(0xC0DE));
        (uint256 cid, uint64 eta) = _schedOnly(CustodyPolicy.CustodyAction.AddCustodian, args, _t4Timelock());

        bytes32 ch = _hCancel(cid, CustodyPolicy.CustodyAction.AddCustodian, args, eta, address(acct));
        policy.cancelScheduledChange(address(acct), cid, _signRaw(OWNER_PK, ch));

        vm.warp(eta + 1);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.AddCustodian, args, eta, address(acct));
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.ProposalAlreadyCancelled.selector, cid));
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    // ───────────────────────────────────────────────────────────────
    // ─── C — cancel-time error + happy branches ────────────────────
    // ───────────────────────────────────────────────────────────────

    function test_R6_10b_cancel_revertsNotInstalled() public {
        AgentAccount fresh = _freshMode0Acct();
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.NotInstalledOn.selector, address(fresh)));
        policy.cancelScheduledChange(address(fresh), 1, hex"");
    }

    function test_R6_10b_cancel_revertsProposalNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.ProposalNotFound.selector, uint256(99)));
        policy.cancelScheduledChange(address(acct), 99, hex"");
    }

    function test_R6_10b_cancel_revertsProposalAlreadyExecuted() public {
        bytes memory args = abi.encode(address(0xC0DE));
        uint256 cid = _schedAndApply(CustodyPolicy.CustodyAction.AddCustodian, args, _t4Timelock());

        (, , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 ch = _hCancel(cid, CustodyPolicy.CustodyAction.AddCustodian, args, eta, address(acct));
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.ProposalAlreadyExecuted.selector, cid));
        policy.cancelScheduledChange(address(acct), cid, _signRaw(OWNER_PK, ch));
    }

    function test_R6_10b_cancel_revertsProposalAlreadyCancelled() public {
        bytes memory args = abi.encode(address(0xC0DE));
        (uint256 cid, uint64 eta) = _schedOnly(CustodyPolicy.CustodyAction.AddCustodian, args, _t4Timelock());

        bytes32 ch = _hCancel(cid, CustodyPolicy.CustodyAction.AddCustodian, args, eta, address(acct));
        policy.cancelScheduledChange(address(acct), cid, _signRaw(OWNER_PK, ch));

        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.ProposalAlreadyCancelled.selector, cid));
        policy.cancelScheduledChange(address(acct), cid, _signRaw(OWNER_PK, ch));
    }

    function test_R6_10b_cancel_nonRecovery_happyPath() public {
        // Cover the `else` branch in cancelScheduledChange (non-recovery)
        // with a full quorum sig → cancellation succeeds, p.cancelled set,
        // ScheduledChangeCancelled emitted.
        bytes memory args = abi.encode(address(0xC0DE));
        (uint256 cid, uint64 eta) = _schedOnly(CustodyPolicy.CustodyAction.AddCustodian, args, _t4Timelock());

        bytes32 ch = _hCancel(cid, CustodyPolicy.CustodyAction.AddCustodian, args, eta, address(acct));
        policy.cancelScheduledChange(address(acct), cid, _signRaw(OWNER_PK, ch));

        (, , , , , , bool cancelled) = policy.getScheduledChange(address(acct), cid);
        assertTrue(cancelled, "cancelled flag must be set");
    }

    // ───────────────────────────────────────────────────────────────
    // ─── D — effective-tier escalation branches ────────────────────
    // ───────────────────────────────────────────────────────────────

    function test_R6_10b_effectiveTier_targetTierZero_returnsBaseT4() public {
        // ChangeApprovalsRequired with targetTier=0 hits the `return base`
        // branch in _effectiveTierFor. Args are decoded BEFORE the
        // schedule's pre-flight, so the schedule succeeds — but the
        // apply later reverts at _applyChangeApprovalsRequired (tier == 0).
        bytes memory args = abi.encode(uint8(0), uint8(1));
        uint256 cid = policy.scheduledChangeCount(address(acct)) + 1;

        bytes32 ph = _hProp(cid, CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args, address(acct));
        policy.scheduleCustodyChange(
            address(acct),
            CustodyPolicy.CustodyAction.ChangeApprovalsRequired,
            args,
            _signRaw(OWNER_PK, ph)
        );

        // No timelock-tier escalation → reverts only at apply time.
        vm.warp(block.timestamp + _t4Timelock() + 1);
        (, , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args, eta, address(acct));
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.InvalidTier.selector, uint8(0)));
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function test_R6_10b_effectiveTier_targetTierAboveFive_returnsBaseT4() public {
        // targetTier=6 falls through the `> 5` branch in _effectiveTierFor
        // → returns base. Apply then reverts on InvalidTier(6) at handler.
        bytes memory args = abi.encode(uint8(6), uint8(1));
        uint256 cid = policy.scheduledChangeCount(address(acct)) + 1;

        bytes32 ph = _hProp(cid, CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args, address(acct));
        policy.scheduleCustodyChange(
            address(acct),
            CustodyPolicy.CustodyAction.ChangeApprovalsRequired,
            args,
            _signRaw(OWNER_PK, ph)
        );

        vm.warp(block.timestamp + _t4Timelock() + 1);
        (, , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args, eta, address(acct));
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.InvalidTier.selector, uint8(6)));
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    // ───────────────────────────────────────────────────────────────
    // ─── E — view reverts ──────────────────────────────────────────
    // ───────────────────────────────────────────────────────────────

    function test_R6_10b_approvalsRequired_revertsInvalidTier_zero() public {
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.InvalidTier.selector, uint8(0)));
        policy.approvalsRequired(address(acct), 0);
    }

    function test_R6_10b_approvalsRequired_revertsInvalidTier_aboveSix() public {
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.InvalidTier.selector, uint8(7)));
        policy.approvalsRequired(address(acct), 7);
    }

    function test_R6_10b_safetyDelay_revertsInvalidTier_zero() public {
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.InvalidTier.selector, uint8(0)));
        policy.safetyDelay(address(acct), 0);
    }

    function test_R6_10b_safetyDelay_revertsInvalidTier_aboveSix() public {
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.InvalidTier.selector, uint8(7)));
        policy.safetyDelay(address(acct), 7);
    }

    function test_R6_10b_defaultApprovals_matrixCoversAllBranches() public view {
        // Spec § 5.1 matrix.
        // nCustodians == 0 → 0 for ANY tier.
        assertEq(policy.defaultApprovals(0, 4), 0);
        assertEq(policy.defaultApprovals(0, 5), 0);

        // T4: n<=3 → n; n<=6 → n-1; else n-2.
        assertEq(policy.defaultApprovals(1, 4), 1);
        assertEq(policy.defaultApprovals(3, 4), 3);
        assertEq(policy.defaultApprovals(4, 4), 3); // n-1
        assertEq(policy.defaultApprovals(6, 4), 5);
        assertEq(policy.defaultApprovals(7, 4), 5); // n-2

        // T5: n<=5 → n; else n-1.
        assertEq(policy.defaultApprovals(1, 5), 1);
        assertEq(policy.defaultApprovals(5, 5), 5);
        assertEq(policy.defaultApprovals(6, 5), 5); // n-1

        // Other tiers → 0.
        assertEq(policy.defaultApprovals(5, 1), 0);
        assertEq(policy.defaultApprovals(5, 6), 0);
    }

    // ───────────────────────────────────────────────────────────────
    // ─── F — rarely-exercised action dispatcher branches ───────────
    // ───────────────────────────────────────────────────────────────

    function test_R6_10b_rotatePaymaster_revertsNotYetImplemented() public {
        // Stubbed action — schedule succeeds (T5 with 24h timelock), apply
        // hits the `CustodyActionNotYetImplemented` branch.
        bytes memory args = abi.encode(address(0xFEED));
        uint256 cid = _schedOnlyT5(CustodyPolicy.CustodyAction.RotatePaymaster, args);
        vm.warp(block.timestamp + _t5Timelock() + 1);
        (, , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.RotatePaymaster, args, eta, address(acct));
        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.CustodyActionNotYetImplemented.selector,
            uint8(CustodyPolicy.CustodyAction.RotatePaymaster)
        ));
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function test_R6_10b_rotateSessionIssuer_revertsNotYetImplemented() public {
        bytes memory args = abi.encode(address(0xFEED));
        uint256 cid = _schedOnlyT5(CustodyPolicy.CustodyAction.RotateSessionIssuer, args);
        vm.warp(block.timestamp + _t5Timelock() + 1);
        (, , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.RotateSessionIssuer, args, eta, address(acct));
        vm.expectRevert(abi.encodeWithSelector(
            CustodyPolicy.CustodyActionNotYetImplemented.selector,
            uint8(CustodyPolicy.CustodyAction.RotateSessionIssuer)
        ));
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function test_R6_10b_changeValueCeiling_happyPath() public {
        // Mutates t3HighValueCeiling without revert.
        uint256 newCeiling = 12_345_678_901;
        bytes memory args = abi.encode(newCeiling);
        _schedAndApply(CustodyPolicy.CustodyAction.ChangeValueCeiling, args, _t4Timelock());
        assertEq(policy.t3HighValueCeiling(address(acct)), newCeiling);
    }

    function test_R6_10b_setRecoveryApprovals_happyPath() public {
        // Fixture has 2 trustees; raise recoveryApprovals from 0 to 2.
        // First schedule succeeds (action tier = T4, default timelock 1h).
        bytes memory args = abi.encode(uint8(2));
        _schedAndApply(CustodyPolicy.CustodyAction.SetRecoveryApprovals, args, _t4Timelock());
        assertEq(policy.recoveryApprovals(address(acct)), 2);
    }

    function _schedOnlyT5(CustodyPolicy.CustodyAction a, bytes memory args) internal returns (uint256 cid) {
        cid = policy.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _hProp(cid, a, args, address(acct));
        policy.scheduleCustodyChange(address(acct), a, args, _signRaw(OWNER_PK, ph));
    }

    // ───────────────────────────────────────────────────────────────
    // ─── G — handler error branches ────────────────────────────────
    // ───────────────────────────────────────────────────────────────

    function test_R6_10b_addTrustee_revertsZeroAddress() public {
        bytes memory args = abi.encode(address(0));
        uint256 cid = policy.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _hProp(cid, CustodyPolicy.CustodyAction.AddTrustee, args, address(acct));
        policy.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.AddTrustee, args, _signRaw(OWNER_PK, ph)
        );
        vm.warp(block.timestamp + _t4Timelock() + 1);
        (, , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.AddTrustee, args, eta, address(acct));
        vm.expectRevert(CustodyPolicy.ZeroAddress.selector);
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function test_R6_10b_addTrustee_revertsAlreadyExists() public {
        // guardian1 already a trustee from setUp → AddTrustee(guardian1) reverts.
        bytes memory args = abi.encode(guardian1);
        uint256 cid = policy.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _hProp(cid, CustodyPolicy.CustodyAction.AddTrustee, args, address(acct));
        policy.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.AddTrustee, args, _signRaw(OWNER_PK, ph)
        );
        vm.warp(block.timestamp + _t4Timelock() + 1);
        (, , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.AddTrustee, args, eta, address(acct));
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.TrusteeAlreadyExists.selector, guardian1));
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function test_R6_10b_changeMode_revertsCannotDowngradeWithTrustees() public {
        // Setup has 2 trustees + mode=1; changing mode to 0 must revert.
        bytes memory args = abi.encode(uint8(0));
        uint256 cid = policy.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _hProp(cid, CustodyPolicy.CustodyAction.ChangeCustodyMode, args, address(acct));
        policy.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.ChangeCustodyMode, args, _signRaw(OWNER_PK, ph)
        );
        vm.warp(block.timestamp + _t4Timelock() + 1);
        (, , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.ChangeCustodyMode, args, eta, address(acct));
        vm.expectRevert(CustodyPolicy.CannotDowngradeWithTrustees.selector);
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function test_R6_10b_changeMode_revertsInvalidMode() public {
        // mode > 3 → InvalidMode.
        bytes memory args = abi.encode(uint8(4));
        uint256 cid = policy.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _hProp(cid, CustodyPolicy.CustodyAction.ChangeCustodyMode, args, address(acct));
        policy.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.ChangeCustodyMode, args, _signRaw(OWNER_PK, ph)
        );
        vm.warp(block.timestamp + _t4Timelock() + 1);
        (, , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.ChangeCustodyMode, args, eta, address(acct));
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.InvalidMode.selector, uint8(4)));
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function test_R6_10b_rotateAllCustodians_revertsEmptyOwnerSet() public {
        // Both arrays empty → EmptyOwnerSet.
        bytes memory args = abi.encode(new address[](0), new address[](0));
        uint256 cid = policy.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _hProp(cid, CustodyPolicy.CustodyAction.RotateAllCustodians, args, address(acct));
        policy.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.RotateAllCustodians, args, _signRaw(OWNER_PK, ph)
        );
        vm.warp(block.timestamp + _t4Timelock() + 1);
        (, , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.RotateAllCustodians, args, eta, address(acct));
        vm.expectRevert(CustodyPolicy.EmptyOwnerSet.selector);
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }

    function test_R6_10b_changeApprovalsRequired_revertsNewCountZero() public {
        // tier=4, newCount=0 → handler reverts InvalidThresholdValue.
        // Note: _effectiveTierFor escalates to T5 here because
        // (newCount=0 < currentValue=1) AND (base=4 < 5) — so the
        // scheduled change rides the T5 timelock (24h), not T4 (1h).
        // This indirectly exercises the "required = 5" escalation branch.
        bytes memory args = abi.encode(uint8(4), uint8(0));
        uint256 cid = policy.scheduledChangeCount(address(acct)) + 1;
        bytes32 ph = _hProp(cid, CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args, address(acct));
        policy.scheduleCustodyChange(
            address(acct), CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args, _signRaw(OWNER_PK, ph)
        );
        vm.warp(block.timestamp + _t5Timelock() + 1);
        (, , , uint64 eta, , , ) = policy.getScheduledChange(address(acct), cid);
        bytes32 eh = _hExec(cid, CustodyPolicy.CustodyAction.ChangeApprovalsRequired, args, eta, address(acct));
        vm.expectRevert(abi.encodeWithSelector(CustodyPolicy.InvalidThresholdValue.selector, uint8(0)));
        policy.applyCustodyChange(address(acct), cid, _signRaw(OWNER_PK, eh));
    }
}
