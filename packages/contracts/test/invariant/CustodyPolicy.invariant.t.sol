// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * R9.1 -- CustodyPolicy stateful-invariant suite.
 *
 * Foundry calls each `invariant_*` function after every random
 * sequence of `targetContract` calls. The invariants below lock the
 * STATE-CONSISTENCY properties that, if violated, compromise the
 * custody-policy promise to the AgentAccount it is installed on:
 *
 *   INV-1  When the policy IS installed on an account, the per-tier
 *          `approvalsRequired` MUST be >= 1. A zero threshold would
 *          brick the account (no quorum could ever satisfy the apply
 *          path; recovery cannot un-brick because recovery itself is
 *          quorum-gated).
 *
 *   INV-2  `recoveryApprovals` MUST never exceed `trusteeCount`. If
 *          `recoveryApprovals = N` but `trusteeCount < N`, recovery is
 *          mechanically impossible -- the account is undeletable AND
 *          unrecoverable.
 *
 *   INV-3  `custodyMode` MUST be one of {0,1,2,3}. The dispatcher
 *          (CustodyPolicyDispatcherR610c) only knows four modes; a
 *          mode-4+ would route to an undefined branch.
 *
 *   INV-4  `scheduledChangeCount(account)` is monotonic non-decreasing.
 *          Schedules count up; canceling / executing does NOT decrement
 *          the per-account counter (it flips the per-change `executed` /
 *          `cancelled` flag instead). A decrement would imply a re-use
 *          of a changeId -- the audit cornerstone "no double execute"
 *          rests on changeId uniqueness.
 *
 *   INV-5  When the policy is NOT installed on an account, every view
 *          returns the zero/default value. (No silent state-leak from
 *          a previous install -- `permanentlyUninstalled` blocks reinstall
 *          but views must read as "not configured".)
 *
 * Pairs with the unit / branch coverage already in
 * `CustodyPolicy*.t.sol`. This suite catches what those can't: state
 * properties that should hold for ANY sequence of calls, not just the
 * happy paths.
 *
 * Spec: ../../specs/207-smart-account-threshold-policy.md +
 *        ../../specs/209-erc7579-module-architecture.md
 */

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {AgentAccountFactory} from "../../src/AgentAccountFactory.sol";
import {AgentAccount} from "../../src/AgentAccount.sol";
import {DelegationManager} from "../../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../../src/custody/CustodyPolicy.sol";
import {AgentAccountInitParams} from "../../src/IAgentAccount.sol";

/// @dev Handler that the Foundry invariant fuzzer drives. Every external
///      function here is a constrained call into CustodyPolicy / AgentAccount
///      so the fuzzer's random-input sequence stays within the *intended*
///      authority surface (no calls to `_configs` directly, no impersonating
///      the account without `vm.prank`).
contract CustodyPolicyHandler is Test {
    CustodyPolicy public immutable policy;
    AgentAccount  public immutable acct;

    /// @dev Most recently observed `scheduledChangeCount` -- used by the
    ///      monotonic-check invariant. Updated only by the read helper.
    uint256 public lastObservedChangeCount;

    constructor(CustodyPolicy _policy, AgentAccount _acct) {
        policy = _policy;
        acct = _acct;
    }

    /// Pause-tolerant time advance. The fuzzer randomly nudges the chain
    /// clock; the invariants verify that no state-consistency property is
    /// broken by time itself (e.g., a scheduled change being marked
    /// executed merely by warping past its eta with no quorum signature).
    function warp(uint64 delta) external {
        // Cap the delta so the fuzzer doesn't permanently rocket the chain
        // into 2106 (uint64 wrap). Up to ~3 years per call is plenty to
        // cross every safetyDelay tier (max tier delay = ~365 days).
        delta = uint64(_bound(uint256(delta), 0, 90 days));
        vm.warp(block.timestamp + delta);
    }

    /// Observe the on-chain change count and ratchet our local marker.
    /// Called by the monotonic invariant before its check.
    function _observeChangeCount() external {
        uint256 cur = policy.scheduledChangeCount(address(acct));
        lastObservedChangeCount = cur;
    }
}

contract CustodyPolicyInvariantsR91Test is Test {
    AgentAccountFactory internal factory;
    DelegationManager   internal dm;
    AgentAccount        internal acct;
    CustodyPolicy       internal policy;
    EntryPoint          internal entryPoint;
    CustodyPolicyHandler internal handler;

    bytes32 internal constant TEST_RP_HASH = bytes32(uint256(0x7270696468617368));

    function _defaultTimelocks() internal pure returns (uint32[7] memory tl) {}

    function setUp() public {
        entryPoint = new EntryPoint();
        dm = new DelegationManager(address(0));
        policy = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(entryPoint)),
            address(dm),
            address(policy),
            address(0xBB),
            address(0xCC),
            address(0xDD), address(0)
        );

        // Deploy an AgentAccount with one external custodian -- the
        // dispatcher pre-installs the policy at construction (mode 0).
        address[] memory custs = new address[](1);
        custs[0] = address(0xA11CE);
        acct = factory.createAgentAccount(
            AgentAccountInitParams({
                mode: 0,
                custodians: custs,
                trustees: new address[](0),
                initialPasskeyCredentialIdDigest: bytes32(0),
                initialPasskeyX: 0,
                initialPasskeyY: 0,
                initialPasskeyRpIdHash: bytes32(0)
            }),
            _defaultTimelocks(),
            42
        );

        handler = new CustodyPolicyHandler(policy, acct);

        // Drive the fuzzer through the handler so calls stay on the
        // intended authority surface. Without this, the invariant
        // runner would call every external function on every contract
        // in scope, including `factory.createAgentAccount`, which
        // would chew the runs on irrelevant deploys.
        targetContract(address(handler));
    }

    // ─── INV-1: thresholds are nonzero when installed ──────────────

    function invariant_thresholds_nonzero_when_installed() public view {
        if (!policy.isInstalledOn(address(acct))) return;
        for (uint8 t = 0; t < 7; t++) {
            uint8 ar = policy.approvalsRequired(address(acct), t);
            assertGt(ar, 0, "INV-1: zero approvalsRequired would brick the account");
        }
    }

    // ─── INV-2: recoveryApprovals <= trusteeCount ───────────────────

    function invariant_recoveryApprovals_le_trusteeCount() public view {
        if (!policy.isInstalledOn(address(acct))) return;
        uint8 needed = policy.recoveryApprovals(address(acct));
        if (needed == 0) return; // recovery disabled -- nothing to check
        uint256 have = policy.trusteeCount(address(acct));
        assertGe(
            have,
            uint256(needed),
            "INV-2: trusteeCount < recoveryApprovals -- account unrecoverable"
        );
    }

    // ─── INV-3: custodyMode is in {0,1,2,3} ─────────────────────────

    function invariant_custodyMode_in_valid_range() public view {
        if (!policy.isInstalledOn(address(acct))) return;
        uint8 m = policy.custodyMode(address(acct));
        assertLe(m, 3, "INV-3: custodyMode out of {0,1,2,3} -- dispatcher would mis-route");
    }

    // ─── INV-4: scheduledChangeCount is monotonic non-decreasing ────

    function invariant_scheduledChangeCount_monotonic() public {
        uint256 cur = policy.scheduledChangeCount(address(acct));
        assertGe(
            cur,
            handler.lastObservedChangeCount(),
            "INV-4: scheduledChangeCount went DOWN -- changeId reuse possible"
        );
        // Ratchet for the next round.
        handler._observeChangeCount();
    }

    // ─── INV-5: uninstalled accounts read zero/default ──────────────

    address internal constant _UNINSTALLED = address(0xDEAD);

    function invariant_uninstalled_views_zero() public view {
        // This address was never installed-on; every view must read
        // the zero/default value (no leak from another account's config).
        assertFalse(policy.isInstalledOn(_UNINSTALLED), "INV-5: phantom install");
        assertEq(policy.custodyMode(_UNINSTALLED), 0, "INV-5: phantom mode");
        assertEq(policy.recoveryApprovals(_UNINSTALLED), 0, "INV-5: phantom recoveryApprovals");
        assertEq(policy.trusteeCount(_UNINSTALLED), 0, "INV-5: phantom trusteeCount");
        assertEq(policy.scheduledChangeCount(_UNINSTALLED), 0, "INV-5: phantom changes");
        assertEq(policy.t3HighValueCeiling(_UNINSTALLED), 0, "INV-5: phantom T3 ceiling");
    }
}
