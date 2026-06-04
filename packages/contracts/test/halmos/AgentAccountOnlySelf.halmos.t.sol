// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * R9.3.x -- Halmos symbolic proof of AgentAccount's `onlySelf` closure.
 *
 * The `onlySelf` modifier (AgentAccount.sol:216) is the load-bearing
 * authority gate for every administrative entrypoint:
 *
 *     modifier onlySelf() {
 *         if (msg.sender != address(this)) revert NotFromSelf();
 *         _;
 *     }
 *
 * Functions protected by it:
 *   - `_authorizeUpgrade` (the UUPS upgrade hook) -- prevents anyone
 *     except the account itself from swapping the implementation
 *   - `setDelegationManager` -- prevents anyone from rotating the
 *     delegation root of trust
 *   - `setUpgradeTimelock`  -- prevents anyone from disabling the
 *     timelock that the account relies on
 *   - `acceptSessionDelegation` -- prevents anyone from accepting
 *     an arbitrary session delegation on the account's behalf
 *   - `removeCustodian` -- prevents anyone from kicking custodians
 *   - `removePasskey`   -- prevents anyone from un-registering a
 *     credential
 *   - the credential-add ceremonies
 *
 * The `executeFromValidator` / `executeFromModule` paths re-enter the
 * account so that the modifier sees `msg.sender == address(this)`
 * (the account self-called via the validator / module). The Foundry
 * suite `AuthorityClosureWave2A.t.sol` covers concrete inputs; this
 * file generalises to ALL inputs (symbolic caller + symbolic args)
 * for the highest-leverage onlySelf functions:
 *
 *   PROOF-1  setDelegationManager: for any caller != address(acct)
 *            and any new DM address, the external call reverts.
 *
 *   PROOF-2  removeCustodian: for any caller != address(acct) and
 *            any victim address, the external call reverts.
 *
 *   PROOF-3  setUpgradeTimelock: for any caller != address(acct)
 *            and any new timelock value, the external call reverts.
 *
 *   PROOF-4  upgradeToAndCall: for any caller != address(acct), any
 *            new implementation address, and any init calldata, the
 *            UUPS upgrade entrypoint reverts. This is the catastrophic
 *            one -- if it could be bypassed, an attacker swaps the
 *            implementation and gains total control of the account.
 *            The path goes through OZ's UUPSUpgradeable, which calls
 *            `_authorizeUpgrade(newImpl)` (overridden in AgentAccount
 *            with the `onlySelf` modifier) BEFORE any state change.
 *
 *   PROOF-5  removePasskey: for any caller != address(acct) and any
 *            credentialIdDigest, the external call reverts.
 *
 * All target functions are pure-on-revert (no state mutation happens
 * before the modifier check), so each symbolic exploration terminates
 * in a handful of paths.
 *
 * Spec: ../../specs/209-erc7579-module-architecture.md (authority closure)
 */

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {AgentAccountFactory} from "../../src/AgentAccountFactory.sol";
import {AgentAccount} from "../../src/AgentAccount.sol";
import {DelegationManager} from "../../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../../src/custody/CustodyPolicy.sol";
import {AgentAccountInitParams} from "../../src/IAgentAccount.sol";

contract AgentAccountOnlySelfHalmos is Test {
    AgentAccount internal acct;

    function setUp() public {
        EntryPoint ep = new EntryPoint();
        DelegationManager dm = new DelegationManager(address(0));
        CustodyPolicy policy = new CustodyPolicy();
        AgentAccountFactory factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(policy),
            address(0xBB),
            address(0xCC),
            address(0xDD), address(0)
        );

        address[] memory custs = new address[](1);
        custs[0] = address(0xA11CE);
        uint32[7] memory tl;
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
            tl,
            42
        );
    }

    // ─── PROOF-1: setDelegationManager onlySelf closure ───────────

    function check_onlySelf_setDelegationManager_revertsForExternalCaller(
        address caller,
        address newDm
    ) external {
        vm.assume(caller != address(acct));

        vm.prank(caller);
        (bool ok,) = address(acct).call(
            abi.encodeWithSignature("setDelegationManager(address)", newDm)
        );

        assert(!ok);
    }

    // ─── PROOF-2: removeCustodian onlySelf closure ────────────────

    function check_onlySelf_removeCustodian_revertsForExternalCaller(
        address caller,
        address victim
    ) external {
        vm.assume(caller != address(acct));

        vm.prank(caller);
        (bool ok,) = address(acct).call(
            abi.encodeWithSignature("removeCustodian(address)", victim)
        );

        assert(!ok);
    }

    // ─── PROOF-3: setUpgradeTimelock onlySelf closure ─────────────

    function check_onlySelf_setUpgradeTimelock_revertsForExternalCaller(
        address caller,
        uint256 newTimelock
    ) external {
        vm.assume(caller != address(acct));

        vm.prank(caller);
        (bool ok,) = address(acct).call(
            abi.encodeWithSignature("setUpgradeTimelock(uint256)", newTimelock)
        );

        assert(!ok);
    }

    // ─── PROOF-4: upgradeToAndCall onlySelf closure (UUPS hook) ───

    function check_onlySelf_upgradeToAndCall_revertsForExternalCaller(
        address caller,
        address newImpl,
        bytes calldata data
    ) external {
        vm.assume(caller != address(acct));

        vm.prank(caller);
        (bool ok,) = address(acct).call(
            abi.encodeWithSignature("upgradeToAndCall(address,bytes)", newImpl, data)
        );

        assert(!ok);
    }

    // ─── PROOF-5: removePasskey onlySelf closure ──────────────────

    function check_onlySelf_removePasskey_revertsForExternalCaller(
        address caller,
        bytes32 credentialIdDigest
    ) external {
        vm.assume(caller != address(acct));

        vm.prank(caller);
        (bool ok,) = address(acct).call(
            abi.encodeWithSignature("removePasskey(bytes32)", credentialIdDigest)
        );

        assert(!ok);
    }
}
