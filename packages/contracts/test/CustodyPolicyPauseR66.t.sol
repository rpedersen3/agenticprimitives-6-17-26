// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
import {IGovernanceView} from "../src/governance/IGovernance.sol";

/**
 * R6.6 / CON-CustodyPolicy-005 — System-pause coverage on CustodyPolicy.
 *
 * R6.1 recon § 2.3 identified that CustodyPolicy had zero pause
 * checks. R6.6 applies the R6.5 pattern: pause `scheduleCustodyChange`
 * and `applyCustodyChange`; leave `cancelScheduledChange`,
 * `onUninstall` unpaused as recovery primitives.
 *
 * Methodology:
 *   - We exercise the MODIFIER, not the full schedule/apply ceremony.
 *     The modifier fires before the function body, so the function's
 *     auth-fail path (`NotInstalledOn`) only matters when the modifier
 *     passes.
 *   - We mock the `account → factory → governance` staticcall chain
 *     with three minimal mock contracts. This is the same shape
 *     `_systemPausedFor` walks: account.factory() → factory.governance()
 *     → governance.isPaused().
 *   - When paused: scheduleCustodyChange / applyCustodyChange MUST
 *     revert with `SystemPaused`. When not paused: they fall through
 *     to `NotInstalledOn` (since the mock account isn't truly installed),
 *     which proves the modifier did NOT incorrectly block.
 */
contract CustodyPolicyPauseR66Test is Test {
    CustodyPolicy policy;
    MockFactory factory;
    MockGovernancePausable gov;
    MockAccount account;

    function setUp() public {
        policy = new CustodyPolicy();
        gov = new MockGovernancePausable();
        factory = new MockFactory(address(gov));
        account = new MockAccount(address(factory));
        assertFalse(gov.isPaused());
    }

    // ─── 2 guarded entrypoints — must revert with SystemPaused when paused ─

    function test_R6_6_scheduleCustodyChange_pausedReverts() public {
        gov.setPaused(true);
        vm.expectRevert(CustodyPolicy.SystemPaused.selector);
        policy.scheduleCustodyChange(
            address(account),
            CustodyPolicy.CustodyAction.AddCustodian,
            hex"",
            hex""
        );
    }

    function test_R6_6_applyCustodyChange_pausedReverts() public {
        gov.setPaused(true);
        vm.expectRevert(CustodyPolicy.SystemPaused.selector);
        policy.applyCustodyChange(address(account), 0, hex"");
    }

    // ─── Sanity: unpaused does NOT revert with SystemPaused ────────

    function test_R6_6_scheduleCustodyChange_unpausedDoesNotRevertWithSystemPaused() public {
        gov.setPaused(false);
        (bool ok, bytes memory ret) = address(policy).call(
            abi.encodeWithSelector(
                CustodyPolicy.scheduleCustodyChange.selector,
                address(account),
                CustodyPolicy.CustodyAction.AddCustodian,
                hex"",
                hex""
            )
        );
        assertFalse(ok, "should still revert (account not installed) but for a different reason");
        bytes4 reason;
        assembly { reason := mload(add(ret, 0x20)) }
        assertTrue(reason != CustodyPolicy.SystemPaused.selector, "must not be SystemPaused when unpaused");
    }

    function test_R6_6_applyCustodyChange_unpausedDoesNotRevertWithSystemPaused() public {
        gov.setPaused(false);
        (bool ok, bytes memory ret) = address(policy).call(
            abi.encodeWithSelector(
                CustodyPolicy.applyCustodyChange.selector,
                address(account),
                uint256(0),
                hex""
            )
        );
        assertFalse(ok);
        bytes4 reason;
        assembly { reason := mload(add(ret, 0x20)) }
        assertTrue(reason != CustodyPolicy.SystemPaused.selector, "must not be SystemPaused when unpaused");
    }

    // ─── RECOVERY primitives — must still work when paused ────────

    function test_R6_6_recovery_cancelScheduledChange_succeedsWhenPaused() public {
        gov.setPaused(true);
        // Reverts because there's no scheduled change AND the policy
        // isn't installed on the account. Either way the revert reason
        // must NOT be SystemPaused.
        (bool ok, bytes memory ret) = address(policy).call(
            abi.encodeWithSelector(
                CustodyPolicy.cancelScheduledChange.selector,
                address(account),
                uint256(0),
                hex""
            )
        );
        if (!ok) {
            bytes4 reason;
            assembly { reason := mload(add(ret, 0x20)) }
            assertTrue(reason != CustodyPolicy.SystemPaused.selector, "cancelScheduledChange must not be pause-gated");
        }
    }

    function test_R6_6_recovery_onUninstall_succeedsWhenPaused() public {
        gov.setPaused(true);
        // onUninstall reads from `_configs[msg.sender]` — it's called
        // by the account during ERC-7579 uninstall. The pause modifier
        // is NOT applied, so any revert from the body must be for a
        // non-pause reason (e.g. NotInstalledOn since we're calling
        // directly without a prior install).
        vm.prank(address(account));
        (bool ok, bytes memory ret) = address(policy).call(
            abi.encodeWithSelector(CustodyPolicy.onUninstall.selector, hex"")
        );
        if (!ok) {
            bytes4 reason;
            assembly { reason := mload(add(ret, 0x20)) }
            assertTrue(reason != CustodyPolicy.SystemPaused.selector, "onUninstall must not be pause-gated");
        }
    }

    // ─── Legacy compatibility: non-conforming hops treated as not-paused ─

    function test_R6_6_legacy_eoaAccount_neverPaused() public {
        // An "account" that's an EOA has no .code, so the first
        // staticcall (account.factory()) misses; _systemPausedFor
        // returns false. Schedule should fall through to
        // NotInstalledOn (not SystemPaused).
        gov.setPaused(true);
        address eoaAccount = address(0xCAFE);
        (bool ok, bytes memory ret) = address(policy).call(
            abi.encodeWithSelector(
                CustodyPolicy.scheduleCustodyChange.selector,
                eoaAccount,
                CustodyPolicy.CustodyAction.AddCustodian,
                hex"",
                hex""
            )
        );
        assertFalse(ok);
        bytes4 reason;
        assembly { reason := mload(add(ret, 0x20)) }
        assertTrue(reason != CustodyPolicy.SystemPaused.selector, "EOA account must not trigger pause path");
    }

    function test_R6_6_legacy_eoaGovernance_neverPaused() public {
        // Factory whose governance is an EOA → second hop returns no
        // code, isPaused() short-circuits to false.
        MockFactory eoaFactory = new MockFactory(address(0xDEAD));
        MockAccount eoaGovAccount = new MockAccount(address(eoaFactory));
        gov.setPaused(true);  // doesn't matter, this account doesn't read THIS gov
        (bool ok, bytes memory ret) = address(policy).call(
            abi.encodeWithSelector(
                CustodyPolicy.scheduleCustodyChange.selector,
                address(eoaGovAccount),
                CustodyPolicy.CustodyAction.AddCustodian,
                hex"",
                hex""
            )
        );
        assertFalse(ok);
        bytes4 reason;
        assembly { reason := mload(add(ret, 0x20)) }
        assertTrue(reason != CustodyPolicy.SystemPaused.selector, "EOA-governance factory must not trigger pause path");
    }
}

// ─── Mocks for the account → factory → governance staticcall chain ─

contract MockAccount {
    address public immutable factory;
    constructor(address f) {
        factory = f;
    }
}

contract MockFactory {
    address public immutable governance;
    constructor(address g) {
        governance = g;
    }
}

contract MockGovernancePausable is IGovernanceView {
    bool private _paused;
    function setPaused(bool p) external { _paused = p; }
    function isPaused() external view returns (bool) { return _paused; }
    function isSigner(address) external pure returns (bool) { return false; }
}
