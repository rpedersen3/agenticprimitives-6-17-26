// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {AgentAccountFactory} from "../src/AgentAccountFactory.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {DelegationManager} from "../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
import {AgentAccountInitParams} from "../src/IAgentAccount.sol";
import {IGovernanceView} from "../src/governance/IGovernance.sol";

/**
 * R6.5 / CON-AgentAccount-005 — System-pause coverage on AgentAccount.
 *
 * The R6.1 recon (`docs/audits/r6-contracts-recon-2026-05-31.md`)
 * identified that `AgentAccount.sol` had 0 pause checks across 13
 * mutating external functions: when governance paused the system,
 * every account kept executing transactions, installing modules,
 * landing upgrades. R5.7 made the paymaster refuse to sponsor gas,
 * but the account itself never refused. **Largest defensive gap in
 * the codebase.**
 *
 * R6.5 wires `whenNotPaused` into 6 mutating entrypoints:
 *   - execute
 *   - executeBatch
 *   - executeFromModule
 *   - installModule
 *   - executePendingUpgrade
 *   - addCustodian
 *
 * Three entrypoints deliberately stay unguarded as RECOVERY
 * primitives — an operator must always be able to REMOVE attack
 * surface, even during an incident:
 *   - uninstallModule
 *   - cancelPendingUpgrade
 *   - removeCustodian
 *
 * Three `onlySelf` ceremonies are also unguarded (self-recovery,
 * already gated by the owner's signature):
 *   - setUpgradeTimelock
 *   - setDelegationManager
 *   - acceptSessionDelegation
 *
 * `executeFromBundler` is `view` (validation only — not state-
 * mutating; the EntryPoint then calls `execute` which IS paused),
 * so it's not in scope.
 *
 * Pause is read through the factory's `governance()` getter on every
 * check, mirroring the lazy pattern in `GovernanceManaged._pausedSafe()`.
 * EOA / non-conforming governance is treated as "not paused" for
 * legacy compatibility.
 */
contract AgentAccountPauseR65Test is Test {
    AgentAccountFactory factory;
    DelegationManager dm;
    CustodyPolicy policy;
    EntryPoint entryPoint;
    MockPausableGovernance gov;
    AgentAccount account;

    address deployer = address(0xD3D);
    address custodian = address(0xC0DE);

    function setUp() public {
        entryPoint = new EntryPoint();
        dm = new DelegationManager(address(0));
        policy = new CustodyPolicy();
        gov = new MockPausableGovernance();
        // Factory uses our mock governance — the AgentAccount reads
        // `factory.governance()` via the `IAgentAccountFactoryView`
        // interface and chains to `gov.isPaused()`.
        factory = new AgentAccountFactory(
            IEntryPoint(address(entryPoint)),
            address(dm),
            address(policy),
            deployer,         // initialOwner
            deployer,         // bundler signer
            address(gov)      // governance — the loadbearing wiring
        );

        // Deploy an AgentAccount via the factory using the standard
        // bootstrap path. The bootstrap registers `custodian` as the
        // sole external custodian.
        address[] memory custodians = new address[](1);
        custodians[0] = custodian;
        AgentAccountInitParams memory params = AgentAccountInitParams({
            mode: 0,
            custodians: custodians,
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0,
            initialPasskeyRpIdHash: bytes32(0)
        });
        uint32[7] memory tl;
        account = factory.createAgentAccount(params, tl, uint256(uint160(custodian)));
        // Make sure we're starting NOT paused.
        assertFalse(gov.isPaused());
    }

    // ─── Helper: validate state-mutation is gated ──────────────────

    /// @dev Generic helper for "call this function with these args,
    ///      expect SystemPaused revert when paused".
    function _expectPaused(bytes memory callData) internal {
        gov.setPaused(true);
        (bool ok, bytes memory ret) = address(account).call(callData);
        // The call must fail with our SystemPaused selector.
        assertFalse(ok, "call should have reverted");
        // Decode the revert reason — must equal AgentAccount.SystemPaused.selector
        bytes4 reason;
        assembly { reason := mload(add(ret, 0x20)) }
        assertEq(reason, AgentAccount.SystemPaused.selector, "wrong revert reason");
        gov.setPaused(false);
    }

    // ─── 6 guarded functions — each must revert when paused ────────

    function test_R6_5_execute_pausedReverts() public {
        gov.setPaused(true);
        // Prank as the EntryPoint (the only authorized non-self caller
        // for execute). vm.expectRevert + vm.prank must immediately
        // precede the call.
        vm.prank(address(entryPoint));
        vm.expectRevert(AgentAccount.SystemPaused.selector);
        account.execute(address(0x1), 0, hex"");
    }

    function test_R6_5_execute_unpausedSucceedsRevertsLater() public {
        // Sanity: pause=false; the execute call goes through (or
        // reverts for a different reason — wrong caller, etc.). We
        // assert it does NOT revert with SystemPaused.
        gov.setPaused(false);
        vm.prank(address(entryPoint));
        (bool ok, bytes memory ret) = address(account).call(
            abi.encodeWithSelector(AgentAccount.execute.selector, address(0x1), uint256(0), hex"")
        );
        if (!ok) {
            bytes4 reason;
            assembly { reason := mload(add(ret, 0x20)) }
            assertTrue(reason != AgentAccount.SystemPaused.selector, "should not be SystemPaused when unpaused");
        }
    }

    function test_R6_5_executeBatch_pausedReverts() public {
        gov.setPaused(true);
        AgentAccount.Call[] memory calls;
        vm.expectRevert(AgentAccount.SystemPaused.selector);
        vm.prank(address(entryPoint));
        account.executeBatch(calls);
    }

    function test_R6_5_executeFromModule_pausedReverts() public {
        gov.setPaused(true);
        vm.expectRevert(AgentAccount.SystemPaused.selector);
        account.executeFromModule(address(0x1), 0, hex"");
    }

    function test_R6_5_installModule_pausedReverts() public {
        gov.setPaused(true);
        // installModule is gated by `onlySelfOrFactoryInit`. To bypass
        // that for this pause-coverage test, we self-call from
        // address(account). Both modifiers fire in order: first
        // `onlySelfOrFactoryInit` (passes — caller is self), THEN
        // `whenNotPaused` (must revert).
        vm.expectRevert(AgentAccount.SystemPaused.selector);
        vm.prank(address(account));
        account.installModule(2, address(0x1), hex"");
    }

    function test_R6_5_executePendingUpgrade_pausedReverts() public {
        gov.setPaused(true);
        // No pending upgrade exists, so the actual call would revert
        // with NoPendingUpgrade. But the pause check fires FIRST.
        vm.expectRevert(AgentAccount.SystemPaused.selector);
        account.executePendingUpgrade();
    }

    function test_R6_5_addCustodian_pausedReverts() public {
        gov.setPaused(true);
        // Self-call to bypass onlySelf, then expect pause revert.
        vm.expectRevert(AgentAccount.SystemPaused.selector);
        vm.prank(address(account));
        account.addCustodian(address(0xBAD));
    }

    // ─── 3 RECOVERY primitives — must still work when paused ───────

    function test_R6_5_recovery_uninstallModule_succeedsWhenPaused() public {
        gov.setPaused(true);
        // uninstallModule has its own auth (onlySelfOrFactoryInit). The
        // call will revert because the module isn't installed, but
        // critically the revert reason must NOT be SystemPaused.
        vm.prank(address(account));
        (bool ok, bytes memory ret) = address(account).call(
            abi.encodeWithSelector(AgentAccount.uninstallModule.selector, uint256(2), address(0x1), hex"")
        );
        // Either it succeeds or it reverts for some non-pause reason.
        if (!ok) {
            bytes4 reason;
            assembly { reason := mload(add(ret, 0x20)) }
            assertTrue(reason != AgentAccount.SystemPaused.selector, "uninstallModule must not be pause-gated");
        }
    }

    function test_R6_5_recovery_cancelPendingUpgrade_succeedsWhenPaused() public {
        gov.setPaused(true);
        // No pending upgrade → reverts NoPendingUpgrade. Not SystemPaused.
        vm.expectRevert(AgentAccount.NoPendingUpgrade.selector);
        account.cancelPendingUpgrade(hex"");
    }

    function test_R6_5_recovery_removeCustodian_succeedsWhenPaused() public {
        gov.setPaused(true);
        vm.prank(address(account));
        (bool ok, bytes memory ret) = address(account).call(
            abi.encodeWithSelector(AgentAccount.removeCustodian.selector, custodian)
        );
        if (!ok) {
            bytes4 reason;
            assembly { reason := mload(add(ret, 0x20)) }
            assertTrue(reason != AgentAccount.SystemPaused.selector, "removeCustodian must not be pause-gated");
        }
    }

    // ─── 3 onlySelf ceremonies — also unguarded by design ─────────

    function test_R6_5_ceremony_setUpgradeTimelock_succeedsWhenPaused() public {
        gov.setPaused(true);
        vm.prank(address(account));
        account.setUpgradeTimelock(1 hours);
        assertEq(account.upgradeTimelock(), 1 hours);
    }

    function test_R6_5_ceremony_setDelegationManager_succeedsWhenPaused() public {
        gov.setPaused(true);
        // setDelegationManager validates the new DM contract shape, so
        // use the already-deployed DelegationManager from setUp.
        vm.prank(address(account));
        account.setDelegationManager(address(dm));
        assertEq(account.delegationManager(), address(dm));
    }

    function test_R6_5_ceremony_acceptSessionDelegation_succeedsWhenPaused() public {
        gov.setPaused(true);
        bytes32 hash = keccak256("session-grant");
        vm.prank(address(account));
        account.acceptSessionDelegation(hash);
        assertTrue(account.hasAcceptedSessionDelegation(hash));
    }

    // ─── Legacy compatibility — EOA governance treated as not paused ─

    function test_R6_5_legacy_eoaGovernance_neverPaused() public {
        // Deploy a SECOND factory whose `governance` is an EOA (deployer).
        // Any account from that factory should never pause-revert.
        AgentAccountFactory eoaFactory = new AgentAccountFactory(
            IEntryPoint(address(entryPoint)),
            address(dm),
            address(policy),
            deployer,
            deployer,
            deployer  // governance = EOA
        );
        address[] memory custodians = new address[](1);
        custodians[0] = custodian;
        AgentAccountInitParams memory params = AgentAccountInitParams({
            mode: 0,
            custodians: custodians,
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0,
            initialPasskeyRpIdHash: bytes32(0)
        });
        uint32[7] memory tl;
        AgentAccount legacyAccount = eoaFactory.createAgentAccount(params, tl, uint256(2));

        // The "pause check" should silently return false because
        // the EOA governance address has no code. execute() should NOT
        // revert with SystemPaused.
        vm.prank(address(entryPoint));
        (bool ok, bytes memory ret) = address(legacyAccount).call(
            abi.encodeWithSelector(AgentAccount.execute.selector, address(0x1), uint256(0), hex"")
        );
        if (!ok) {
            bytes4 reason;
            assembly { reason := mload(add(ret, 0x20)) }
            assertTrue(reason != AgentAccount.SystemPaused.selector, "EOA governance must not trigger pause path");
        }
    }
}

/// @dev Minimal `IGovernanceView` implementation with togglable
///      `isPaused()` for tests. Mirrors the slice of `AgenticGovernance`
///      that `AgentAccount._systemPaused()` reads.
contract MockPausableGovernance is IGovernanceView {
    bool private _paused;

    function setPaused(bool p) external {
        _paused = p;
    }

    function isPaused() external view returns (bool) {
        return _paused;
    }

    function isSigner(address) external pure returns (bool) {
        return false;
    }
}
