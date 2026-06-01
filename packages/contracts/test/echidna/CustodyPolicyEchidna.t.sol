// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * R9.4 -- CustodyPolicy Echidna property harness.
 *
 * Foundry invariants (R9.1) and Halmos symbolic proofs (R9.3+) cover
 * the per-PR property check. Echidna runs LONG, ABI-aware random
 * sequence fuzzing against the same state, generating call traces
 * Foundry / Halmos don't sample.
 *
 * Properties checked (mirrors R9.1 invariant suite so the two
 * sampling strategies hammer the same surface):
 *
 *   ECH-1  When installed, every tier's `approvalsRequired` MUST be
 *          >= 1. A zero threshold would brick the account.
 *
 *   ECH-2  `recoveryApprovals` MUST never exceed `trusteeCount`. If
 *          violated, recovery is mechanically impossible.
 *
 *   ECH-3  `custodyMode` MUST be in {0,1,2,3}. The dispatcher
 *          (CustodyPolicyDispatcherR610c) only knows four modes.
 *
 *   ECH-4  An address that was NEVER installed-on reads zero/default
 *          for every view. (No state leak from a previous install.)
 *
 * Run nightly via `.github/workflows/contracts-echidna-nightly.yml`
 * (artifact-only / non-blocking by R9.4 design). Local:
 *   pnpm --filter @agenticprimitives/contracts run echidna
 *
 * Spec: ../../specs/207-smart-account-threshold-policy.md
 */

import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {AgentAccountFactory} from "../../src/AgentAccountFactory.sol";
import {AgentAccount} from "../../src/AgentAccount.sol";
import {DelegationManager} from "../../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../../src/custody/CustodyPolicy.sol";
import {AgentAccountInitParams} from "../../src/IAgentAccount.sol";

/// @dev Echidna contract: every external/public function is a call the
///      fuzzer randomly invokes; every `echidna_*` returning `bool`
///      is a property the fuzzer tries to falsify.
contract CustodyPolicyEchidna {
    CustodyPolicy internal policy;
    AgentAccount  internal acct;

    address internal constant UNINSTALLED = address(0xDEAD);

    constructor() {
        EntryPoint ep = new EntryPoint();
        DelegationManager dm = new DelegationManager(address(0));
        policy = new CustodyPolicy();
        AgentAccountFactory factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(policy),
            address(0xBB),
            address(0xCC),
            address(0xDD)
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

    // ─── Mutation surface (the fuzzer drives these) ────────────────

    /// Random change-id reads -- safe (view) but exercise the
    /// `pending` mapping path with arbitrary indices.
    function poke_changeAt(uint256 changeId) external view returns (bool) {
        // Reverts here are absorbed by Echidna (counts as an attempted call,
        // not a failed property). Most random changeIds won't exist.
        (CustodyPolicy.ScheduledChange memory s) = _safeGetScheduled(changeId);
        // No property here -- this method only exists to give the fuzzer
        // another call shape so its sequence-generation isn't trivial.
        return s.proposedAt == s.proposedAt; // tautology; satisfies pure-warning
    }

    function _safeGetScheduled(uint256 changeId)
        internal view returns (CustodyPolicy.ScheduledChange memory s)
    {
        try this._readScheduled(changeId) returns (
            CustodyPolicy.ScheduledChange memory r
        ) {
            return r;
        } catch {
            return s;
        }
    }

    function _readScheduled(uint256 changeId)
        external view returns (CustodyPolicy.ScheduledChange memory)
    {
        (
            CustodyPolicy.CustodyAction action,
            bytes memory args,
            uint64 proposedAt,
            uint64 eta,
            address proposer,
            bool executed,
            bool cancelled
        ) = policy.getScheduledChange(address(acct), changeId);
        return CustodyPolicy.ScheduledChange({
            action: action,
            args: args,
            proposedAt: proposedAt,
            eta: eta,
            proposer: proposer,
            executed: executed,
            cancelled: cancelled
        });
    }

    // ─── Properties (Echidna falsifies these) ──────────────────────

    /// ECH-1: thresholds nonzero when installed.
    function echidna_thresholds_nonzero_when_installed()
        external view returns (bool)
    {
        if (!policy.isInstalledOn(address(acct))) return true;
        for (uint8 t = 0; t < 7; t++) {
            if (policy.approvalsRequired(address(acct), t) == 0) return false;
        }
        return true;
    }

    /// ECH-2: recoveryApprovals <= trusteeCount.
    function echidna_recoveryApprovals_le_trusteeCount()
        external view returns (bool)
    {
        if (!policy.isInstalledOn(address(acct))) return true;
        uint8 needed = policy.recoveryApprovals(address(acct));
        if (needed == 0) return true;
        return policy.trusteeCount(address(acct)) >= uint256(needed);
    }

    /// ECH-3: custodyMode in {0,1,2,3}.
    function echidna_custodyMode_in_valid_range()
        external view returns (bool)
    {
        if (!policy.isInstalledOn(address(acct))) return true;
        return policy.custodyMode(address(acct)) <= 3;
    }

    /// ECH-4: uninstalled views read zero/default.
    function echidna_uninstalled_views_zero()
        external view returns (bool)
    {
        if (policy.isInstalledOn(UNINSTALLED)) return false;
        if (policy.custodyMode(UNINSTALLED) != 0) return false;
        if (policy.recoveryApprovals(UNINSTALLED) != 0) return false;
        if (policy.trusteeCount(UNINSTALLED) != 0) return false;
        if (policy.scheduledChangeCount(UNINSTALLED) != 0) return false;
        if (policy.t3HighValueCeiling(UNINSTALLED) != 0) return false;
        return true;
    }
}
