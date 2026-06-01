// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * R9.5 -- CustodyPolicy Medusa property harness.
 *
 * Medusa is Crytic's go-ethereum-based coverage-guided fuzzer.
 * Different sampling strategy than R9.4's Echidna (HEVM-based,
 * coverage-guided) and R9.1/R9.2's Foundry invariant runner.
 *
 * Properties mirror R9.4 Echidna so the two fuzzers' coverage
 * strategies hammer the same surface from different angles. A
 * regression that slips one fuzzer's coverage graph can still be
 * caught by the other's.
 *
 *   MED-1  thresholds[t] >= 1 when installed (mirrors ECH-1 / INV-1)
 *   MED-2  recoveryApprovals <= trusteeCount (ECH-2 / INV-2)
 *   MED-3  custodyMode in {0,1,2,3} (ECH-3 / INV-3)
 *   MED-4  uninstalled views read zero (ECH-4 / INV-5)
 *
 * Run weekly via `.github/workflows/contracts-medusa-weekend.yml`
 * (artifact-only by R9.5 design). Local:
 *   pnpm --filter @agenticprimitives/contracts run medusa
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

contract CustodyPolicyMedusa {
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

    // ─── Properties (Medusa falsifies these) ───────────────────────

    /// MED-1: thresholds nonzero when installed.
    function property_thresholds_nonzero_when_installed()
        external view returns (bool)
    {
        if (!policy.isInstalledOn(address(acct))) return true;
        for (uint8 t = 0; t < 7; t++) {
            if (policy.approvalsRequired(address(acct), t) == 0) return false;
        }
        return true;
    }

    /// MED-2: recoveryApprovals <= trusteeCount.
    function property_recoveryApprovals_le_trusteeCount()
        external view returns (bool)
    {
        if (!policy.isInstalledOn(address(acct))) return true;
        uint8 needed = policy.recoveryApprovals(address(acct));
        if (needed == 0) return true;
        return policy.trusteeCount(address(acct)) >= uint256(needed);
    }

    /// MED-3: custodyMode in {0,1,2,3}.
    function property_custodyMode_in_valid_range()
        external view returns (bool)
    {
        if (!policy.isInstalledOn(address(acct))) return true;
        return policy.custodyMode(address(acct)) <= 3;
    }

    /// MED-4: uninstalled views read zero.
    function property_uninstalled_views_zero()
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
