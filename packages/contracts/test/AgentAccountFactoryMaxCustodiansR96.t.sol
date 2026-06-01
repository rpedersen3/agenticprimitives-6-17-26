// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * R9.6 / ATL-SEC-05 -- AgentAccountFactory caps initial custodians.
 *
 * Closes the Aderyn H-6 finding: `_buildValidatorInitData` casts
 * `nSigners = params.custodians.length` to `uint8` to call
 * `defaultApprovals(uint8 nSigners, ...)`. Without a bound,
 * `params.custodians.length >= 256` silently truncates to a smaller
 * number, computing a wrong default threshold for the account being
 * created. Self-hurt footgun, not a cross-account vulnerability --
 * but worth capping so the misconfiguration fails closed at
 * construction.
 *
 * Cap: `MAX_INITIAL_CUSTODIANS = 32`. 32 is well above any rational
 * config (every smart-account substrate we surveyed caps well below
 * 16) and well under the uint8 boundary.
 *
 * Companion: docs/audits/r9-static-analysis-triage.md (R9 audit
 * findings triage; this is the one finding marked actionable).
 */

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {DelegationManager} from "../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
import {AgentAccountInitParams} from "../src/IAgentAccount.sol";

contract AgentAccountFactoryMaxCustodiansR96Test is Test {
    AgentAccountFactory internal factory;

    function setUp() public {
        EntryPoint ep = new EntryPoint();
        DelegationManager dm = new DelegationManager(address(0));
        CustodyPolicy policy = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(policy),
            address(0xBB),
            address(0xCC),
            address(0xDD)
        );
    }

    function _build(uint256 n) internal pure returns (AgentAccountInitParams memory) {
        address[] memory custs = new address[](n);
        for (uint256 i; i < n; i++) {
            custs[i] = address(uint160(uint256(keccak256(abi.encode(i, "cust")))));
        }
        return AgentAccountInitParams({
            mode: 0,
            custodians: custs,
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0,
            initialPasskeyRpIdHash: bytes32(0)
        });
    }

    function _defaultTimelocks() internal pure returns (uint32[7] memory tl) {}

    function test_R96_constant_is_32() public view {
        assertEq(factory.MAX_INITIAL_CUSTODIANS(), 32, "cap drifted");
    }

    function test_R96_atTheCap_succeeds() public {
        AgentAccount a = factory.createAgentAccount(_build(32), _defaultTimelocks(), 1);
        assertEq(a.custodianCount(), 32);
    }

    function test_R96_underTheCap_succeeds() public {
        AgentAccount a = factory.createAgentAccount(_build(5), _defaultTimelocks(), 2);
        assertEq(a.custodianCount(), 5);
    }

    function test_R96_overTheCap_reverts_33() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentAccountFactory.TooManyInitialCustodians.selector,
                uint256(33),
                uint256(32)
            )
        );
        factory.createAgentAccount(_build(33), _defaultTimelocks(), 3);
    }

    /// @notice The pre-R9.6 truncation hazard: 256 custodians would
    ///         silently cast to `uint8(256) = 0` and brick threshold
    ///         derivation. With the cap, the misconfiguration is
    ///         caught at the SOURCE of the bug.
    function test_R96_overTheCap_reverts_256_closesUint8Truncation() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentAccountFactory.TooManyInitialCustodians.selector,
                uint256(256),
                uint256(32)
            )
        );
        factory.createAgentAccount(_build(256), _defaultTimelocks(), 4);
    }

    function test_R96_overTheCap_reverts_300() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentAccountFactory.TooManyInitialCustodians.selector,
                uint256(300),
                uint256(32)
            )
        );
        factory.createAgentAccount(_build(300), _defaultTimelocks(), 5);
    }
}
