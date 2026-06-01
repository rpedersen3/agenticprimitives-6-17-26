// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * R9.2 -- SmartAgentPaymaster stateful-invariant suite.
 *
 * Third suite in the R9 wave (after CustodyPolicy R9.1 + DelegationManager
 * R9.2). 256 runs * 100 calls = 25,600 calls per invariant.
 *
 *   INV-1  ONLY governance can mutate `_dev`, `verifyingSigner`, or
 *          `_acceptList[*]`. A non-governance caller (the fuzzer is
 *          NOT pranked to governance) MUST never observe any of those
 *          state slots change.
 *
 *   INV-2  `governance` immutable post-construction. The constructor
 *          sets it; nothing else can.
 *
 *   INV-3  Dev-mode transitions are EVENT-EMITTING. Every observable
 *          change in `devMode()` MUST correspond to a `setDevMode` call
 *          we made. (Approximation in this suite: the fuzzer never calls
 *          `setDevMode` as governance, so `devMode()` must stay at its
 *          construction-time value forever.)
 *
 *   INV-4  `verifyingSigner` likewise stays at its construction value
 *          when no governance call has been made.
 *
 *   INV-5  `isAccepted(sender)` defaults to false for any sender the
 *          fuzzer never set. No state-leak from `_acceptList`.
 *
 * Spec: ../../specs/202-erc4337-paymaster.md
 */

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {SmartAgentPaymaster} from "../../src/SmartAgentPaymaster.sol";

/// Minimal governance stub -- same shape as the unit-test version. Owns
/// the `isPaused()` view the paymaster's pause-check uses (R6.5).
contract MockGovernance {
    bool public isPaused;
    function setPaused(bool p) external { isPaused = p; }
    function isSigner(address) external pure returns (bool) { return false; }
}

/// @dev Handler the invariant fuzzer drives. Every call is from
///      `address(this)` (the handler), which is NEVER pranked to be
///      `governance` -- the invariants then assert that none of the
///      governance-gated state can mutate from those calls.
contract SmartAgentPaymasterHandler is Test {
    SmartAgentPaymaster public immutable pm;
    address public immutable governanceAddr;

    constructor(SmartAgentPaymaster _pm, address _gov) {
        pm = _pm;
        governanceAddr = _gov;
    }

    /// Try `setDevMode` -- MUST revert (we are not governance).
    function tryFlipDevMode(bool dev) external {
        try pm.setDevMode(dev) {
            // If this didn't revert, the onlyGovernance gate is broken.
            // Mark a failure via a known sentinel that the invariant can
            // detect.
            fail();
        } catch { /* expected */ }
    }

    /// Try `setVerifyingSigner` -- MUST revert.
    function tryRotateSigner(address newSigner) external {
        try pm.setVerifyingSigner(newSigner) {
            fail();
        } catch { /* expected */ }
    }

    /// Try `setAccepted` for an arbitrary sender -- MUST revert.
    function trySetAccepted(address sender, bool accepted) external {
        try pm.setAccepted(sender, accepted) {
            fail();
        } catch { /* expected */ }
    }

    /// Read the views -- harmless, but contributes to the call distribution
    /// so the fuzzer mixes reads with the failing writes.
    function observeDevMode() external view returns (bool) {
        return pm.devMode();
    }
    function observeVerifyingSigner() external view returns (address) {
        return pm.verifyingSigner();
    }
    function observeAccepted(address sender) external view returns (bool) {
        return pm.isAccepted(sender);
    }
}

contract SmartAgentPaymasterInvariantsR92Test is Test {
    EntryPoint internal ep;
    MockGovernance internal gov;
    SmartAgentPaymaster internal pm;
    SmartAgentPaymasterHandler internal handler;

    address internal constant DEPLOYER = address(0xD1);

    /// @dev Cached at setUp; INVs assert these never drift.
    bool internal initialDevMode;
    address internal initialVerifyingSigner;
    address internal initialGovernance;

    function setUp() public {
        ep = new EntryPoint();
        gov = new MockGovernance();
        vm.prank(DEPLOYER);
        // Construct in PRODUCTION mode with an explicit verifyingSigner,
        // so INV-1/INV-3/INV-4 have a non-default observable to lock.
        pm = new SmartAgentPaymaster(
            IEntryPoint(address(ep)),
            DEPLOYER,
            address(gov),
            /* devMode_ */ false,
            /* verifyingSigner_ */ address(0xBEEF)
        );

        initialDevMode = pm.devMode();
        initialVerifyingSigner = pm.verifyingSigner();
        initialGovernance = pm.governance();

        handler = new SmartAgentPaymasterHandler(pm, address(gov));
        targetContract(address(handler));
    }

    // ─── INV-1: dev mode never flips without a governance call ─────

    function invariant_devMode_locked_against_nongovernance() public view {
        assertEq(
            pm.devMode(),
            initialDevMode,
            "INV-1: devMode flipped via a non-governance call"
        );
    }

    // ─── INV-2: governance address is immutable ────────────────────

    function invariant_governance_is_immutable() public view {
        assertEq(
            pm.governance(),
            initialGovernance,
            "INV-2: governance address changed post-construction"
        );
    }

    // ─── INV-3: verifyingSigner stays at construction value ────────

    function invariant_verifyingSigner_locked_against_nongovernance() public view {
        assertEq(
            pm.verifyingSigner(),
            initialVerifyingSigner,
            "INV-3: verifyingSigner rotated via a non-governance call"
        );
    }

    // ─── INV-4: arbitrary senders default to NOT-accepted ──────────

    function invariant_arbitrary_sender_not_accepted() public view {
        // Three witnesses: distinct addresses the fuzzer might have
        // poked via `trySetAccepted` (which reverts), plus one address
        // the fuzzer has never touched at all.
        assertFalse(pm.isAccepted(address(0x1)),    "INV-4: phantom accept on 0x1");
        assertFalse(pm.isAccepted(address(0x1234)), "INV-4: phantom accept on 0x1234");
        assertFalse(pm.isAccepted(address(0xCAFE)), "INV-4: phantom accept on 0xCAFE");
        assertFalse(pm.isAccepted(DEPLOYER),        "INV-4: phantom accept on deployer");
    }

    // ─── INV-5: governance NotGovernance error is fail-closed ──────

    function invariant_governance_gate_holds_for_a_fresh_caller() public {
        // Call the governance-gated setters from a *fresh* address that
        // the fuzzer cannot have pranked. This invariant is the global
        // version of the handler's per-call try/catch: even after
        // 25,600 fuzzer calls have tried to wear down the gate, a
        // brand-new caller still hits NotGovernance.
        address fresh = address(uint160(uint256(keccak256("inv-5-fresh"))));
        vm.prank(fresh);
        try pm.setDevMode(true) {
            fail();
        } catch { /* expected */ }

        vm.prank(fresh);
        try pm.setVerifyingSigner(address(0xDEAD)) {
            fail();
        } catch { /* expected */ }

        vm.prank(fresh);
        try pm.setAccepted(address(0xBEEF), true) {
            fail();
        } catch { /* expected */ }
    }
}
