// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/DelegationManager.sol";
import {
    AgentAccountInitParams,
    AgentAccountRecoveryArgs,
    AgentAccountRecoveryPasskeyAdd
} from "../src/IAgentAccount.sol";

/**
 * T6 Recovery flow tests (spec 207 § 8). Uses the factory's
 * `createAccountWithMode` from 6c.2-d to deploy threshold-mode accounts
 * with real guardian sets, rather than the harness setters used in the
 * 6c.2-b/c tests. Confirms:
 *   - happy path: 3-of-5 guardians propose, 48h timelock, execute
 *   - § 9 row 7: T6 recovery with majority of guardians succeeds
 *   - § 9 row 8: hostile-recovery escape hatch (primary owner cancels
 *     within the 24h window)
 *   - dual cancel window switches at 24h (owner cancel rejected after)
 *   - § 9 row 13: T5 pending → T6 executes → T5 implicitly invalid
 *     (the old proposer signers are no longer owners, so execute fails)
 *   - guardian-set-empty mode (hybrid w/o guardians) refuses propose
 */
contract AgentAccountRecoveryTest is Test {
    AgentAccountFactory internal factory;
    DelegationManager internal dm;
    AgentAccount internal acct;

    // Owners (primaries)
    uint256 internal alicePk = 0xA11CE;
    uint256 internal bobPk = 0xB0B;
    uint256 internal carolPk = 0xCA401;
    address internal alice;
    address internal bob;
    address internal carol;

    // Guardians
    uint256 internal g1Pk = 0x6471a01;
    uint256 internal g2Pk = 0x6471a02;
    uint256 internal g3Pk = 0x6471a03;
    address internal g1;
    address internal g2;
    address internal g3;

    address internal newOwner = address(0xDEAD01);

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

        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        carol = vm.addr(carolPk);
        g1 = vm.addr(g1Pk);
        g2 = vm.addr(g2Pk);
        g3 = vm.addr(g3Pk);

        // 3-owner threshold-mode account with 3 guardians.
        // Factory defaults install: T4 threshold = 3, T5 = 3,
        // recoveryThreshold = ceil(3/2)+1 = 2.
        address[] memory owners = new address[](3);
        owners[0] = alice; owners[1] = bob; owners[2] = carol;
        address[] memory guardians = new address[](3);
        guardians[0] = g1; guardians[1] = g2; guardians[2] = g3;

        AgentAccountInitParams memory p;
        p.mode = 2; // threshold
        p.owners = owners;
        p.guardians = guardians;
        acct = factory.createAccountWithMode(p, 1);

        // Anchor block.timestamp.
        vm.warp(1_000_000);
    }

    // ─── Helpers ──────────────────────────────────────────────────────

    function _pack1(uint256 pk, bytes32 hash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hash);
        return abi.encodePacked(r, s, v);
    }

    function _packSorted(uint256[] memory pks, bytes32 hash)
        internal
        pure
        returns (bytes memory packed)
    {
        // Sort signer addresses ascending. Index-aligned with pks.
        uint256 n = pks.length;
        address[] memory addrs = new address[](n);
        for (uint256 i; i < n; i++) addrs[i] = vm.addr(pks[i]);
        // Insertion sort (small n; clarity > efficiency).
        for (uint256 i = 1; i < n; i++) {
            for (uint256 j = i; j > 0 && addrs[j] < addrs[j - 1]; j--) {
                (addrs[j], addrs[j - 1]) = (addrs[j - 1], addrs[j]);
                (pks[j], pks[j - 1]) = (pks[j - 1], pks[j]);
            }
        }
        packed = new bytes(n * 65);
        for (uint256 i; i < n; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(pks[i], hash);
            uint256 off = i * 65;
            assembly {
                let dst := add(packed, add(0x20, off))
                mstore(dst, r)
                mstore(add(dst, 0x20), s)
                mstore8(add(dst, 0x40), v)
            }
        }
    }

    function _proposeHash(
        uint256 proposalId,
        AgentAccount.AdminAction action,
        bytes memory args,
        uint64 eta
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                bytes32("ADMIN_PROPOSE"),
                proposalId,
                action,
                keccak256(args),
                eta,
                address(acct),
                block.chainid
            )
        );
    }

    function _executeHash(
        uint256 proposalId,
        AgentAccount.AdminAction action,
        bytes memory args,
        uint64 eta
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                bytes32("ADMIN_EXECUTE"),
                proposalId,
                action,
                keccak256(args),
                eta,
                address(acct),
                block.chainid
            )
        );
    }

    function _cancelHash(
        uint256 proposalId,
        AgentAccount.AdminAction action,
        bytes memory args,
        uint64 eta
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                bytes32("ADMIN_CANCEL"),
                proposalId,
                action,
                keccak256(args),
                eta,
                address(acct),
                block.chainid
            )
        );
    }

    function _recoveryArgs(
        address[] memory addOwners,
        address[] memory removeOwners
    ) internal pure returns (bytes memory) {
        AgentAccountRecoveryArgs memory r;
        r.addOwners = addOwners;
        r.removeOwners = removeOwners;
        r.addPasskeys = new AgentAccountRecoveryPasskeyAdd[](0);
        r.removePasskeyCredentialIdDigests = new bytes32[](0);
        return abi.encode(r);
    }

    function _guardianPksTwo() internal view returns (uint256[] memory pks) {
        pks = new uint256[](2);
        pks[0] = g1Pk;
        pks[1] = g2Pk;
    }

    function _guardianPksThree() internal view returns (uint256[] memory pks) {
        pks = new uint256[](3);
        pks[0] = g1Pk;
        pks[1] = g2Pk;
        pks[2] = g3Pk;
    }

    function _ownerPksThree() internal view returns (uint256[] memory pks) {
        pks = new uint256[](3);
        pks[0] = alicePk;
        pks[1] = bobPk;
        pks[2] = carolPk;
    }

    function _newOwnersOne() internal view returns (address[] memory a) {
        a = new address[](1); a[0] = newOwner;
    }

    function _removeOne(address victim) internal pure returns (address[] memory a) {
        a = new address[](1); a[0] = victim;
    }

    function _emptyAddrs() internal pure returns (address[] memory a) {
        a = new address[](0);
    }

    // ─── Happy path (§ 9 row 7) ───────────────────────────────────────

    function test_recovery_happy_path_majority_of_guardians() public {
        // Guardians g1 + g2 propose recovery: add newOwner, remove alice.
        // T6 recoveryThreshold = 2 (factory default for 3 guardians).
        bytes memory args = _recoveryArgs(_newOwnersOne(), _removeOne(alice));
        uint64 eta = uint64(block.timestamp + 48 hours);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.RecoverAccount, args, eta);

        acct.proposeAdmin(
            AgentAccount.AdminAction.RecoverAccount,
            args,
            _packSorted(_guardianPksTwo(), propHash)
        );

        // Warp past the 48h timelock + execute.
        vm.warp(block.timestamp + 48 hours + 1);
        bytes32 execHash = _executeHash(1, AgentAccount.AdminAction.RecoverAccount, args, eta);
        acct.executeAdmin(1, _packSorted(_guardianPksTwo(), execHash));

        assertTrue(acct.isOwner(newOwner), "newOwner should be added");
        assertFalse(acct.isOwner(alice), "alice should be removed");
        // bob + carol survive; newOwner added. ownerCount should now be 3.
        assertEq(acct.ownerCount(), 3);
    }

    // ─── Owner cancel within the 24h window (§ 9 row 8) ───────────────

    function test_primary_owner_cancels_within_24h_window() public {
        // Guardians g1 + g2 propose recovery removing alice.
        bytes memory args = _recoveryArgs(_emptyAddrs(), _removeOne(alice));
        uint64 eta = uint64(block.timestamp + 48 hours);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.RecoverAccount, args, eta);
        acct.proposeAdmin(
            AgentAccount.AdminAction.RecoverAccount,
            args,
            _packSorted(_guardianPksTwo(), propHash)
        );

        // Within the first 24h, primary owners (T4 threshold = 3) cancel
        // the recovery as a "hostile-recovery escape hatch."
        vm.warp(block.timestamp + 1 hours); // still within 24h
        bytes32 cancelHash = _cancelHash(1, AgentAccount.AdminAction.RecoverAccount, args, eta);
        acct.cancelAdmin(1, _packSorted(_ownerPksThree(), cancelHash));

        // Confirm execute now fails because cancelled.
        vm.warp(block.timestamp + 48 hours);
        bytes32 execHash = _executeHash(1, AgentAccount.AdminAction.RecoverAccount, args, eta);
        vm.expectRevert(
            abi.encodeWithSelector(AgentAccount.ProposalAlreadyCancelled.selector, uint256(1))
        );
        acct.executeAdmin(1, _packSorted(_guardianPksTwo(), execHash));

        // alice still owner.
        assertTrue(acct.isOwner(alice));
    }

    // ─── Cancel window closes after 24h ───────────────────────────────

    function test_primary_owner_cancel_rejected_after_24h_window() public {
        bytes memory args = _recoveryArgs(_emptyAddrs(), _removeOne(alice));
        uint64 eta = uint64(block.timestamp + 48 hours);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.RecoverAccount, args, eta);
        acct.proposeAdmin(
            AgentAccount.AdminAction.RecoverAccount,
            args,
            _packSorted(_guardianPksTwo(), propHash)
        );

        // Warp past the 24h owner-cancel window.
        vm.warp(block.timestamp + 25 hours);

        bytes32 cancelHash = _cancelHash(1, AgentAccount.AdminAction.RecoverAccount, args, eta);
        // Owner sigs now fail because cancel-after-24h requires guardians.
        vm.expectRevert(); // UnauthorizedGuardian for the owner signers
        acct.cancelAdmin(1, _packSorted(_ownerPksThree(), cancelHash));
    }

    function test_guardian_quorum_can_cancel_after_window() public {
        bytes memory args = _recoveryArgs(_emptyAddrs(), _removeOne(alice));
        uint64 eta = uint64(block.timestamp + 48 hours);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.RecoverAccount, args, eta);
        acct.proposeAdmin(
            AgentAccount.AdminAction.RecoverAccount,
            args,
            _packSorted(_guardianPksTwo(), propHash)
        );

        // After the 24h owner window, guardian quorum can still cancel.
        vm.warp(block.timestamp + 36 hours);
        bytes32 cancelHash = _cancelHash(1, AgentAccount.AdminAction.RecoverAccount, args, eta);
        acct.cancelAdmin(1, _packSorted(_guardianPksTwo(), cancelHash));

        // Execute attempt now fails as cancelled.
        vm.warp(block.timestamp + 13 hours);
        bytes32 execHash = _executeHash(1, AgentAccount.AdminAction.RecoverAccount, args, eta);
        vm.expectRevert(
            abi.encodeWithSelector(AgentAccount.ProposalAlreadyCancelled.selector, uint256(1))
        );
        acct.executeAdmin(1, _packSorted(_guardianPksTwo(), execHash));
    }

    // ─── § 9 row 13: recovery implicitly invalidates pending T5 ───────

    function test_T5_proposal_implicitly_invalidated_by_recovery() public {
        // 1. alice/bob/carol propose a T5 ChangeDelegationManager.
        address newDm = address(0xD33D33);
        bytes memory t5Args = abi.encode(newDm);
        uint64 t5Eta = uint64(block.timestamp + 24 hours);
        bytes32 t5PropHash = _proposeHash(
            1, AgentAccount.AdminAction.ChangeDelegationManager, t5Args, t5Eta
        );
        acct.proposeAdmin(
            AgentAccount.AdminAction.ChangeDelegationManager,
            t5Args,
            _packSorted(_ownerPksThree(), t5PropHash)
        );

        // 2. Recovery propose+execute removes alice + bob (the T5
        //    proposer set is now incomplete).
        address[] memory toRemove = new address[](2);
        toRemove[0] = alice;
        toRemove[1] = bob;
        bytes memory recArgs = _recoveryArgs(_emptyAddrs(), toRemove);
        uint64 recEta = uint64(block.timestamp + 48 hours);
        bytes32 recPropHash = _proposeHash(
            2, AgentAccount.AdminAction.RecoverAccount, recArgs, recEta
        );
        acct.proposeAdmin(
            AgentAccount.AdminAction.RecoverAccount,
            recArgs,
            _packSorted(_guardianPksTwo(), recPropHash)
        );

        // Warp past both ETAs.
        vm.warp(block.timestamp + 48 hours + 1);
        bytes32 recExecHash = _executeHash(
            2, AgentAccount.AdminAction.RecoverAccount, recArgs, recEta
        );
        acct.executeAdmin(2, _packSorted(_guardianPksTwo(), recExecHash));
        assertFalse(acct.isOwner(alice));
        assertFalse(acct.isOwner(bob));

        // 3. The T5 ChangeDelegationManager proposal can't execute now
        //    — only carol is still an owner, can't satisfy T4=3 threshold.
        //    Even with alice + bob sigs in the blob, those addresses
        //    aren't owners anymore → AdminUnauthorizedSigner.
        bytes32 t5ExecHash = _executeHash(
            1, AgentAccount.AdminAction.ChangeDelegationManager, t5Args, t5Eta
        );
        vm.expectRevert(); // AdminUnauthorizedSigner on alice or bob (removed)
        acct.executeAdmin(1, _packSorted(_ownerPksThree(), t5ExecHash));
    }

    // ─── No guardians → recovery refused ──────────────────────────────

    function test_recovery_refused_for_hybrid_with_no_guardians() public {
        // Deploy a hybrid-mode account with 0 guardians.
        address[] memory owners = new address[](1);
        owners[0] = alice;
        address[] memory guardians = new address[](0);
        AgentAccountInitParams memory p;
        p.mode = 1; // hybrid
        p.owners = owners;
        p.guardians = guardians;
        AgentAccount lonely = factory.createAccountWithMode(p, 999);

        // Try to propose recovery on it — should revert RecoveryRequiresGuardianQuorum.
        bytes memory args = _recoveryArgs(_emptyAddrs(), _removeOne(alice));
        uint64 eta = uint64(block.timestamp + 48 hours);
        bytes32 propHash = keccak256(
            abi.encode(
                bytes32("ADMIN_PROPOSE"),
                uint256(1),
                AgentAccount.AdminAction.RecoverAccount,
                keccak256(args),
                eta,
                address(lonely),
                block.chainid
            )
        );
        vm.expectRevert(AgentAccount.RecoveryRequiresGuardianQuorum.selector);
        lonely.proposeAdmin(
            AgentAccount.AdminAction.RecoverAccount,
            args,
            _packSorted(_guardianPksTwo(), propHash)
        );
    }

    // ─── Under-threshold (1 guardian when 2 required) ─────────────────

    function test_recovery_under_threshold_reverts() public {
        bytes memory args = _recoveryArgs(_emptyAddrs(), _removeOne(alice));
        uint64 eta = uint64(block.timestamp + 48 hours);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.RecoverAccount, args, eta);

        uint256[] memory only1 = new uint256[](1);
        only1[0] = g1Pk;
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentAccount.AdminInsufficientQuorum.selector,
                uint256(1),
                uint8(2)
            )
        );
        acct.proposeAdmin(
            AgentAccount.AdminAction.RecoverAccount,
            args,
            _packSorted(only1, propHash)
        );
    }

    // ─── Owner signing recovery → fails (only guardians can) ──────────

    function test_owner_cannot_sign_recovery_propose() public {
        bytes memory args = _recoveryArgs(_emptyAddrs(), _removeOne(alice));
        uint64 eta = uint64(block.timestamp + 48 hours);
        bytes32 propHash = _proposeHash(1, AgentAccount.AdminAction.RecoverAccount, args, eta);

        uint256[] memory ownerPks = new uint256[](2);
        ownerPks[0] = bobPk;
        ownerPks[1] = carolPk;
        vm.expectRevert(); // UnauthorizedGuardian
        acct.proposeAdmin(
            AgentAccount.AdminAction.RecoverAccount,
            args,
            _packSorted(ownerPks, propHash)
        );
    }
}
