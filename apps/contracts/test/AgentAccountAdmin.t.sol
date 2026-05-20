// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/DelegationManager.sol";

/// @dev Test harness exposing setters for the ERC-7201 threshold-policy
///      storage. Stands in for the factory extension that lands in 6c.2-c —
///      the contract surface (propose / execute / cancel + dispatcher)
///      is what 6c.2-b ships; this harness lets us seed the threshold-policy
///      state without the factory plumbing being in place yet.
contract TestAgentAccount is AgentAccount {
    constructor(IEntryPoint ep) AgentAccount(ep) {}

    function __test_setMode(uint8 mode_) external {
        _thresholdPolicyStorage().mode = mode_;
    }

    function __test_setThreshold(uint8 tier, uint8 value) external {
        _thresholdPolicyStorage().thresholdByTier[tier] = value;
    }

    function __test_setRecoveryThreshold(uint8 value) external {
        _thresholdPolicyStorage().recoveryThreshold = value;
    }

    function __test_addGuardian(address guardian) external {
        ThresholdPolicyStorage storage $ = _thresholdPolicyStorage();
        if (!$.guardians[guardian]) {
            $.guardians[guardian] = true;
            $.guardianCount += 1;
        }
    }

    function __test_setT3HighValueCeiling(uint256 ceiling) external {
        _thresholdPolicyStorage().t3HighValueCeiling = ceiling;
    }

    function __test_setTimelockDuration(uint8 tier, uint32 secondsValue) external {
        _thresholdPolicyStorage().timelockByTier[tier] = secondsValue;
    }

    function __test_addOwner(address newOwner) external {
        if (!_owners[newOwner]) {
            _owners[newOwner] = true;
            _ownerCount += 1;
        }
    }
}

contract AgentAccountAdminTest is Test {
    DelegationManager internal dm;
    TestAgentAccount internal acct;

    uint256 internal alicePk = 0xA11CE;
    uint256 internal bobPk = 0xB0B;
    uint256 internal carolPk = 0xCA401;
    uint256 internal madiPk = 0xBADBEEF;
    address internal alice;
    address internal bob;
    address internal carol;
    address internal madi;     // not an owner
    address internal newOwner = address(0xDEAD01);
    address internal guardian1 = address(0x6471a01);
    address internal guardian2 = address(0x6471a02);

    function setUp() public {
        EntryPoint ep = new EntryPoint();
        dm = new DelegationManager();
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        carol = vm.addr(carolPk);
        madi = vm.addr(madiPk);

        // AgentAccount is UUPS-upgradeable + the impl constructor calls
        // _disableInitializers, so we can't initialize on the impl
        // directly. Standard test pattern: deploy impl + deploy
        // ERC1967Proxy pointing at it + initialize via the proxy.
        TestAgentAccount impl = new TestAgentAccount(IEntryPoint(address(ep)));
        bytes memory initCalldata = abi.encodeWithSelector(
            AgentAccount.initializeWithCoOwner.selector,
            alice,
            bob,
            address(dm),
            address(0xFA101)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initCalldata);
        acct = TestAgentAccount(payable(address(proxy)));
        // Stand-in for the 6c.2-c factory extension: switch to `threshold`
        // mode with T4 threshold of 2 (both owners must approve admin
        // actions).
        acct.__test_setMode(2); // threshold
        acct.__test_setThreshold(4, 2); // T4 = 2-of-2
        // Anchor block.timestamp so proposal ETAs are deterministic.
        vm.warp(1_000_000);
    }

    // ─── Helpers ──────────────────────────────────────────────────────

    /// Pack a 2-signer Safe-compatible blob, sorted ascending by signer
    /// address. Returns the packed bytes and the resulting eta (== now
    /// for T4, which is non-timelocked by default).
    function _pack2(uint256 pkA, uint256 pkB, bytes32 hash) internal pure returns (bytes memory) {
        address sA = vm.addr(pkA);
        address sB = vm.addr(pkB);
        uint256 lowPk;
        uint256 highPk;
        if (sA < sB) {
            lowPk = pkA;
            highPk = pkB;
        } else {
            lowPk = pkB;
            highPk = pkA;
        }
        bytes memory packed = new bytes(2 * 65);
        (uint8 vL, bytes32 rL, bytes32 sL) = vm.sign(lowPk, hash);
        (uint8 vH, bytes32 rH, bytes32 sH) = vm.sign(highPk, hash);
        assembly {
            let dst := add(packed, 0x20)
            mstore(dst, rL)
            mstore(add(dst, 0x20), sL)
            mstore8(add(dst, 0x40), vL)
            mstore(add(dst, 0x41), rH)
            mstore(add(dst, 0x61), sH)
            mstore8(add(dst, 0x81), vH)
        }
        return packed;
    }

    function _pack1(uint256 pk, bytes32 hash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hash);
        return abi.encodePacked(r, s, v);
    }

    /// Compute the canonical propose payload hash matching
    /// AgentAccount._adminPayloadHash for verb=ADMIN_PROPOSE.
    function _proposeHash(uint256 proposalId, AgentAccount.AdminAction action, bytes memory args, uint64 eta)
        internal
        view
        returns (bytes32)
    {
        bytes32 verb = bytes32("ADMIN_PROPOSE");
        return keccak256(
            abi.encode(verb, proposalId, action, keccak256(args), eta, address(acct), block.chainid)
        );
    }

    function _executeHash(uint256 proposalId, AgentAccount.AdminAction action, bytes memory args, uint64 eta)
        internal
        view
        returns (bytes32)
    {
        bytes32 verb = bytes32("ADMIN_EXECUTE");
        return keccak256(
            abi.encode(verb, proposalId, action, keccak256(args), eta, address(acct), block.chainid)
        );
    }

    function _cancelHash(uint256 proposalId, AgentAccount.AdminAction action, bytes memory args, uint64 eta)
        internal
        view
        returns (bytes32)
    {
        bytes32 verb = bytes32("ADMIN_CANCEL");
        return keccak256(
            abi.encode(verb, proposalId, action, keccak256(args), eta, address(acct), block.chainid)
        );
    }

    // ─── Happy path: AddOwner via admin flow ──────────────────────────

    function test_proposeAdmin_AddOwner_with_two_of_two_quorum() public {
        bytes memory args = abi.encode(newOwner);
        uint256 expectedId = 1;
        // T4 timelock default is 0 → eta == now.
        uint64 eta = uint64(block.timestamp);

        bytes32 propHash = _proposeHash(expectedId, AgentAccount.AdminAction.AddOwner, args, eta);
        bytes memory sigs = _pack2(alicePk, bobPk, propHash);

        uint256 returnedId = acct.proposeAdmin(AgentAccount.AdminAction.AddOwner, args, sigs);
        assertEq(returnedId, expectedId);

        // Proposal is queued, not yet executed.
        (
            AgentAccount.AdminAction storedAction,
            ,
            uint64 storedEta,
            ,
            bool executed,
            bool cancelled
        ) = acct.getPendingAdmin(expectedId);
        assertEq(uint8(storedAction), uint8(AgentAccount.AdminAction.AddOwner));
        assertEq(storedEta, eta);
        assertEq(executed, false);
        assertEq(cancelled, false);
    }

    function test_executeAdmin_AddOwner_actually_adds_owner() public {
        bytes memory args = abi.encode(newOwner);
        uint64 eta = uint64(block.timestamp);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.AddOwner, args, eta);
        acct.proposeAdmin(AgentAccount.AdminAction.AddOwner, args, _pack2(alicePk, bobPk, propHash));

        bytes32 execHash = _executeHash(1, AgentAccount.AdminAction.AddOwner, args, eta);
        bytes memory execSigs = _pack2(alicePk, bobPk, execHash);

        assertEq(acct.isOwner(newOwner), false);
        acct.executeAdmin(1, execSigs);
        assertEq(acct.isOwner(newOwner), true);
        assertEq(acct.ownerCount(), 3);
    }

    function test_executeAdmin_is_idempotent() public {
        bytes memory args = abi.encode(newOwner);
        uint64 eta = uint64(block.timestamp);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.AddOwner, args, eta);
        acct.proposeAdmin(AgentAccount.AdminAction.AddOwner, args, _pack2(alicePk, bobPk, propHash));
        bytes32 execHash = _executeHash(1, AgentAccount.AdminAction.AddOwner, args, eta);
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));

        // Second execute reverts ProposalAlreadyExecuted.
        vm.expectRevert(abi.encodeWithSelector(AgentAccount.ProposalAlreadyExecuted.selector, uint256(1)));
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));
    }

    // ─── Sad paths ─────────────────────────────────────────────────────

    function test_proposeAdmin_under_threshold_fails_closed() public {
        bytes memory args = abi.encode(newOwner);
        uint64 eta = uint64(block.timestamp);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.AddOwner, args, eta);
        bytes memory only1 = _pack1(alicePk, propHash); // only 1 sig, threshold is 2

        vm.expectRevert(
            abi.encodeWithSelector(AgentAccount.AdminInsufficientQuorum.selector, uint256(1), uint8(2))
        );
        acct.proposeAdmin(AgentAccount.AdminAction.AddOwner, args, only1);
    }

    function test_proposeAdmin_with_non_owner_sigs_fails_closed() public {
        bytes memory args = abi.encode(newOwner);
        uint64 eta = uint64(block.timestamp);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.AddOwner, args, eta);
        // Sign with madi (not an owner) + alice; sorted ascending.
        bytes memory sigs = _pack2(alicePk, madiPk, propHash);

        // The non-owner signer recovers first (or alice does — either order
        // is wrong because madi isn't in _owners).
        vm.expectRevert();
        acct.proposeAdmin(AgentAccount.AdminAction.AddOwner, args, sigs);
    }

    function test_executeAdmin_before_eta_fails_closed_when_timelocked() public {
        // T4 with a 1-hour timelock: execute before eta reverts
        // ProposalNotReady, then succeeds after warping past it.
        acct.__test_setTimelockDuration(4, 3600);

        bytes memory args = abi.encode(newOwner);
        uint64 eta = uint64(block.timestamp + 3600);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.AddOwner, args, eta);
        acct.proposeAdmin(AgentAccount.AdminAction.AddOwner, args, _pack2(alicePk, bobPk, propHash));

        bytes32 execHash = _executeHash(1, AgentAccount.AdminAction.AddOwner, args, eta);
        vm.expectRevert(
            abi.encodeWithSelector(AgentAccount.ProposalNotReady.selector, uint256(1), eta)
        );
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));

        // Warp past the timelock and try again — succeeds.
        vm.warp(block.timestamp + 3601);
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));
        assertEq(acct.isOwner(newOwner), true);
    }

    // ─── cancelAdmin ───────────────────────────────────────────────────

    function test_cancelAdmin_blocks_execute() public {
        bytes memory args = abi.encode(newOwner);
        uint64 eta = uint64(block.timestamp);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.AddOwner, args, eta);
        acct.proposeAdmin(AgentAccount.AdminAction.AddOwner, args, _pack2(alicePk, bobPk, propHash));

        bytes32 cancelHash = _cancelHash(1, AgentAccount.AdminAction.AddOwner, args, eta);
        acct.cancelAdmin(1, _pack2(alicePk, bobPk, cancelHash));

        bytes32 execHash = _executeHash(1, AgentAccount.AdminAction.AddOwner, args, eta);
        vm.expectRevert(abi.encodeWithSelector(AgentAccount.ProposalAlreadyCancelled.selector, uint256(1)));
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));
    }

    // ─── Guardians ─────────────────────────────────────────────────────

    function test_AddGuardian_via_admin_flow() public {
        bytes memory args = abi.encode(guardian1);
        uint64 eta = uint64(block.timestamp);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.AddGuardian, args, eta);
        acct.proposeAdmin(AgentAccount.AdminAction.AddGuardian, args, _pack2(alicePk, bobPk, propHash));
        bytes32 execHash = _executeHash(1, AgentAccount.AdminAction.AddGuardian, args, eta);
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));
        assertTrue(acct.isGuardian(guardian1));
        assertEq(acct.guardianCount(), 1);
    }

    // ─── ChangeMode safeguards (spec §9 test #14) ──────────────────────

    function test_ChangeMode_to_single_with_guardians_rejected() public {
        // Seed a guardian directly + try to downgrade to `single`.
        acct.__test_addGuardian(guardian1);

        bytes memory args = abi.encode(uint8(0)); // mode = single
        uint64 eta = uint64(block.timestamp);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.ChangeMode, args, eta);
        acct.proposeAdmin(AgentAccount.AdminAction.ChangeMode, args, _pack2(alicePk, bobPk, propHash));
        bytes32 execHash = _executeHash(1, AgentAccount.AdminAction.ChangeMode, args, eta);

        vm.expectRevert(AgentAccount.CannotDowngradeWithGuardians.selector);
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));
    }

    // ─── T3 ceiling tuning ─────────────────────────────────────────────

    function test_ChangeT3Ceiling_updates_ceiling() public {
        bytes memory args = abi.encode(uint256(1 ether));
        uint64 eta = uint64(block.timestamp);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.ChangeT3Ceiling, args, eta);
        acct.proposeAdmin(AgentAccount.AdminAction.ChangeT3Ceiling, args, _pack2(alicePk, bobPk, propHash));
        bytes32 execHash = _executeHash(1, AgentAccount.AdminAction.ChangeT3Ceiling, args, eta);
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));
        assertEq(acct.t3HighValueCeiling(), 1 ether);
    }

    // ─── Recovery threshold setter ─────────────────────────────────────

    function test_SetRecoveryThreshold_requires_guardians() public {
        // No guardians yet → SetRecoveryThreshold to 2 should revert.
        bytes memory args = abi.encode(uint8(2));
        uint64 eta = uint64(block.timestamp);
        bytes32 propHash = _proposeHash(
            1, AgentAccount.AdminAction.SetRecoveryThreshold, args, eta
        );
        acct.proposeAdmin(
            AgentAccount.AdminAction.SetRecoveryThreshold, args, _pack2(alicePk, bobPk, propHash)
        );
        bytes32 execHash = _executeHash(
            1, AgentAccount.AdminAction.SetRecoveryThreshold, args, eta
        );
        vm.expectRevert();
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));
    }

    function test_SetRecoveryThreshold_succeeds_with_guardians() public {
        acct.__test_addGuardian(guardian1);
        acct.__test_addGuardian(guardian2);

        bytes memory args = abi.encode(uint8(2));
        uint64 eta = uint64(block.timestamp);
        bytes32 propHash = _proposeHash(
            1, AgentAccount.AdminAction.SetRecoveryThreshold, args, eta
        );
        acct.proposeAdmin(
            AgentAccount.AdminAction.SetRecoveryThreshold, args, _pack2(alicePk, bobPk, propHash)
        );
        bytes32 execHash = _executeHash(
            1, AgentAccount.AdminAction.SetRecoveryThreshold, args, eta
        );
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));
        assertEq(acct.recoveryThreshold(), 2);
    }

    // ─── T5 actions (6c.2-c) ───────────────────────────────────────────

    function test_T5_propose_with_zero_timelock_reverts() public {
        // Spec § 9 row 5: T5 in threshold mode without timelock fails
        // closed. The hard invariant: tier ∈ {T5, T6} must have a
        // non-zero timelock.
        bytes memory args = abi.encode(address(0xC0FFEE));
        bytes32 propHash = _proposeHash(
            1,
            AgentAccount.AdminAction.UpgradeImpl,
            args,
            uint64(block.timestamp)
        );
        vm.expectRevert(
            abi.encodeWithSelector(AgentAccount.TimelockRequiredForTier.selector, uint8(5))
        );
        acct.proposeAdmin(
            AgentAccount.AdminAction.UpgradeImpl,
            args,
            _pack2(alicePk, bobPk, propHash)
        );
    }

    function test_T5_UpgradeImpl_happy_path() public {
        // Set up a 24h T5 timelock + a new impl to upgrade to. We need
        // a second TestAgentAccount as the new impl target.
        acct.__test_setTimelockDuration(5, 24 hours);
        TestAgentAccount newImpl = new TestAgentAccount(IEntryPoint(address(new EntryPoint())));

        bytes memory args = abi.encode(address(newImpl));
        uint64 eta = uint64(block.timestamp + 24 hours);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.UpgradeImpl, args, eta);
        acct.proposeAdmin(
            AgentAccount.AdminAction.UpgradeImpl,
            args,
            _pack2(alicePk, bobPk, propHash)
        );

        // Cannot execute before eta.
        bytes32 execHash = _executeHash(1, AgentAccount.AdminAction.UpgradeImpl, args, eta);
        vm.expectRevert(
            abi.encodeWithSelector(AgentAccount.ProposalNotReady.selector, uint256(1), eta)
        );
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));

        // Warp past the timelock + execute.
        vm.warp(block.timestamp + 24 hours + 1);
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));

        // Verify the ERC-1967 implementation slot now points to newImpl.
        bytes32 implSlot = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
        bytes32 stored = vm.load(address(acct), implSlot);
        assertEq(address(uint160(uint256(stored))), address(newImpl));
    }

    function test_T5_ChangeDelegationManager_updates_DM() public {
        acct.__test_setTimelockDuration(5, 1 hours);
        address newDm = address(0xD33D33D3);

        bytes memory args = abi.encode(newDm);
        uint64 eta = uint64(block.timestamp + 1 hours);
        bytes32 propHash = _proposeHash(
            1, AgentAccount.AdminAction.ChangeDelegationManager, args, eta
        );
        acct.proposeAdmin(
            AgentAccount.AdminAction.ChangeDelegationManager,
            args,
            _pack2(alicePk, bobPk, propHash)
        );

        vm.warp(block.timestamp + 1 hours + 1);
        bytes32 execHash = _executeHash(
            1, AgentAccount.AdminAction.ChangeDelegationManager, args, eta
        );
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));
        assertEq(acct.delegationManager(), newDm);
    }

    // ─── Org mode separation-of-duties (spec § 9 row 6) ───────────────

    function test_org_mode_T5_overlapping_signers_rejected() public {
        // In `org` mode, signers in propose are disqualified from
        // execute (zero-overlap rule). With N=2 / threshold=2 the only
        // way to legitimately execute is to use 2 fresh signers — i.e.
        // impossible with N=2 + threshold=2. So overlap will always
        // happen, and we expect SeparationOfDutiesViolation.
        acct.__test_setMode(3); // org
        acct.__test_setTimelockDuration(5, 1 hours);
        TestAgentAccount newImpl = new TestAgentAccount(IEntryPoint(address(new EntryPoint())));

        bytes memory args = abi.encode(address(newImpl));
        uint64 eta = uint64(block.timestamp + 1 hours);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.UpgradeImpl, args, eta);
        acct.proposeAdmin(
            AgentAccount.AdminAction.UpgradeImpl,
            args,
            _pack2(alicePk, bobPk, propHash)
        );

        vm.warp(block.timestamp + 1 hours + 1);
        bytes32 execHash = _executeHash(1, AgentAccount.AdminAction.UpgradeImpl, args, eta);
        // The first executing signer (whichever sorts first) was a
        // proposer too → SoD violation.
        vm.expectRevert();
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));
    }

    function test_org_mode_SoD_allows_disjoint_signer_sets() public {
        // N=3 owners + T5 threshold=1: propose with alice, execute
        // with bob (or carol). Zero overlap → succeeds.
        acct.__test_addOwner(carol);
        acct.__test_setMode(3); // org
        acct.__test_setThreshold(5, 1); // T5 = 1-of-3 for this test
        acct.__test_setTimelockDuration(5, 1 hours);
        TestAgentAccount newImpl = new TestAgentAccount(IEntryPoint(address(new EntryPoint())));

        bytes memory args = abi.encode(address(newImpl));
        uint64 eta = uint64(block.timestamp + 1 hours);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.UpgradeImpl, args, eta);

        // Propose with alice.
        acct.proposeAdmin(
            AgentAccount.AdminAction.UpgradeImpl,
            args,
            _pack1(alicePk, propHash)
        );

        // Execute with bob (a fresh signer). With threshold=1, _pack1
        // is sufficient; the SoD check sees bob is not in
        // proposerSigners[1], so it passes.
        vm.warp(block.timestamp + 1 hours + 1);
        bytes32 execHash = _executeHash(1, AgentAccount.AdminAction.UpgradeImpl, args, eta);
        acct.executeAdmin(1, _pack1(bobPk, execHash));

        // Confirm the upgrade actually applied.
        bytes32 implSlot = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
        bytes32 stored = vm.load(address(acct), implSlot);
        assertEq(address(uint160(uint256(stored))), address(newImpl));
    }

    function test_threshold_mode_T4_allows_overlapping_signers() public {
        // SoD is org-mode-only. In `threshold` mode (the setUp default),
        // T4 propose+execute with the same signer set is fine.
        bytes memory args = abi.encode(newOwner);
        uint64 eta = uint64(block.timestamp);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.AddOwner, args, eta);
        acct.proposeAdmin(
            AgentAccount.AdminAction.AddOwner,
            args,
            _pack2(alicePk, bobPk, propHash)
        );
        // Execute with the same signers — no SoD check in threshold mode.
        bytes32 execHash = _executeHash(1, AgentAccount.AdminAction.AddOwner, args, eta);
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));
        assertEq(acct.isOwner(newOwner), true);
    }

    // ─── ChangePaymaster / ChangeSessionIssuer stubs (deferred) ────────

    function test_T5_ChangePaymaster_still_stubbed() public {
        acct.__test_setTimelockDuration(5, 1 hours);
        bytes memory args = abi.encode(address(0xFEED));
        uint64 eta = uint64(block.timestamp + 1 hours);
        bytes32 propHash = _proposeHash(
            1, AgentAccount.AdminAction.ChangePaymaster, args, eta
        );
        acct.proposeAdmin(
            AgentAccount.AdminAction.ChangePaymaster,
            args,
            _pack2(alicePk, bobPk, propHash)
        );

        vm.warp(block.timestamp + 1 hours + 1);
        bytes32 execHash = _executeHash(
            1, AgentAccount.AdminAction.ChangePaymaster, args, eta
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentAccount.AdminActionNotYetImplemented.selector,
                uint8(AgentAccount.AdminAction.ChangePaymaster)
            )
        );
        acct.executeAdmin(1, _pack2(alicePk, bobPk, execHash));
    }

    // ─── Getters / defaults ────────────────────────────────────────────

    function test_default_thresholds_are_one_for_unset_tiers() public view {
        assertEq(acct.threshold(1), 1); // T1 default = 1 (preserves 1-of-N for pre-policy accounts)
        assertEq(acct.threshold(3), 1); // T3 default = 1
        assertEq(acct.threshold(4), 2); // T4 was set in setUp()
    }

    function test_t3HighValueCeiling_defaults_to_max() public view {
        // No setter called → returns sentinel max.
        assertEq(acct.t3HighValueCeiling(), type(uint256).max);
    }

    function test_threshold_invalid_tier_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(AgentAccount.InvalidTier.selector, uint8(7)));
        acct.threshold(7);
    }
}
