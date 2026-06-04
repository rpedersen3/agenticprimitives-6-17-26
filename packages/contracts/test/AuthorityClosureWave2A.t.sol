// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * Wave 2A authority-closure regression tests (contract audit C-1..C-3).
 *
 * Lock down the three single-custodian escape hatches that previously
 * let any one external custodian on a multi-sig account bypass the
 * CustodyPolicy quorum + timelock entirely:
 *
 *   C-1: setDelegationManager could be called by any custodian → attacker
 *        could point the account at a malicious manager + call back
 *        through execute(). Now `onlySelf`.
 *   C-2: installModule/uninstallModule could be called by any custodian
 *        → attacker could install an executor module that proxies
 *        privileged self-only calls (addCustodian, addPasskey, upgrade).
 *        Now `onlySelfOrFactoryInit` (one-shot factory exception at
 *        deploy, then `onlySelf` forever).
 *   C-3: upgradeToWithAuthorization verified ONE ECDSA sig against
 *        externalCustodians → any one custodian could replace the
 *        implementation. Now `revert LegacyUpgradePathDisabled()`;
 *        upgrades route through self-call (CustodyPolicy.ApplySystemUpdate
 *        in production).
 */

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
import {AgentAccountInitParams} from "../src/IAgentAccount.sol";

contract AuthorityClosureWave2ATest is Test {
    function _defaultTimelocks() internal pure returns (uint32[7] memory tl) {}
    AgentAccountFactory internal factory;
    AgentAccount internal acct;
    EntryPoint internal entryPoint;
    DelegationManager internal dm;
    address internal custodianA;
    address internal custodianB;
    address internal attacker;

    function setUp() public {
        entryPoint = new EntryPoint();
        dm = new DelegationManager(address(0));
        CustodyPolicy cp = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(entryPoint)),
            address(dm),
            address(cp),
            /*bundlerSigner*/ address(this),
            /*sessionIssuer*/ address(this),
            /*governance*/ address(this), address(0)
        );

        custodianA = address(0xA11CE);
        custodianB = address(0xB0B);
        attacker = address(0xBADF00D);

        address[] memory custodians = new address[](2);
        custodians[0] = custodianA;
        custodians[1] = custodianB;
        AgentAccountInitParams memory p = AgentAccountInitParams({
            mode: 0,
            custodians: custodians,
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0,

            initialPasskeyRpIdHash: bytes32(uint256(0x7270696468617368))
        });
        acct = factory.createAgentAccount(p, _defaultTimelocks(), 1);
    }

    // ─── C-1: setDelegationManager is onlySelf ────────────────────────

    function test_C1_custodian_cannot_replace_delegation_manager() public {
        address attackerDm = address(new MockHostileDelegationManager());
        // The previous behavior would let custodianA call this directly.
        // Now it MUST revert.
        vm.prank(custodianA);
        vm.expectRevert(AgentAccount.NotFromSelf.selector);
        acct.setDelegationManager(attackerDm);
    }

    function test_C1_external_rando_cannot_replace_delegation_manager() public {
        address attackerDm = address(new MockHostileDelegationManager());
        vm.prank(attacker);
        vm.expectRevert(AgentAccount.NotFromSelf.selector);
        acct.setDelegationManager(attackerDm);
    }

    function test_C1_self_call_can_rotate_to_a_contract() public {
        address newDm = address(new MockHostileDelegationManager());
        vm.prank(address(acct));
        acct.setDelegationManager(newDm);
        assertEq(acct.delegationManager(), newDm);
    }

    function test_C1_self_call_refuses_an_eoa_dm() public {
        // Defensive: a DM must have code (downstream executes expect
        // it to implement execute()).
        vm.prank(address(acct));
        vm.expectRevert(AgentAccount.ValidatorRequired.selector);
        acct.setDelegationManager(attacker);
    }

    // ─── C-2: installModule / uninstallModule onlySelf (+ factory init) ──

    function test_C2_custodian_cannot_install_module() public {
        MockExecutorModule attackerMod = new MockExecutorModule();
        vm.prank(custodianA);
        vm.expectRevert(AgentAccount.ModuleOperationNotAllowed.selector);
        acct.installModule(2 /* EXECUTOR */, address(attackerMod), hex"");
    }

    function test_C2_attacker_cannot_install_module() public {
        MockExecutorModule attackerMod = new MockExecutorModule();
        vm.prank(attacker);
        vm.expectRevert(AgentAccount.ModuleOperationNotAllowed.selector);
        acct.installModule(2, address(attackerMod), hex"");
    }

    function test_C2_factory_init_exception_is_one_shot() public {
        // Spend the factory's init slot on this account.
        MockExecutorModule firstMod = new MockExecutorModule();
        vm.prank(address(factory));
        acct.installModule(2, address(firstMod), hex"");

        // Second factory call MUST revert — the init slot was consumed
        // by the first install. Factory has no perpetual install perm.
        MockExecutorModule secondMod = new MockExecutorModule();
        vm.prank(address(factory));
        vm.expectRevert(AgentAccount.ModuleOperationNotAllowed.selector);
        acct.installModule(2, address(secondMod), hex"");
    }

    function test_C2_uninstall_has_no_factory_exception() public {
        // Even on a fresh account where the factory hasn't yet consumed
        // its install slot, uninstall MUST require self.
        vm.prank(address(factory));
        vm.expectRevert(AgentAccount.ModuleOperationNotAllowed.selector);
        acct.uninstallModule(2, address(0x1234), hex"");
    }

    function test_C2_self_call_can_install() public {
        MockExecutorModule mod = new MockExecutorModule();
        vm.prank(address(acct));
        acct.installModule(2, address(mod), hex"");
        assertTrue(acct.isModuleInstalled(2, address(mod), hex""));
    }

    function test_C2_custodian_cannot_uninstall_module_even_when_installed() public {
        // First install via self.
        MockExecutorModule mod = new MockExecutorModule();
        vm.prank(address(acct));
        acct.installModule(2, address(mod), hex"");

        // Custodian cannot then uninstall.
        vm.prank(custodianA);
        vm.expectRevert(AgentAccount.ModuleOperationNotAllowed.selector);
        acct.uninstallModule(2, address(mod), hex"");
    }

    // ─── C-3: upgradeToWithAuthorization is deprecated ────────────────

    function test_C3_upgradeToWithAuthorization_always_reverts() public {
        // Any signature, any new impl — must hit the deprecation revert.
        address newImpl = address(new AgentAccount(IEntryPoint(address(entryPoint)), address(0)));
        bytes memory sig = hex"00";
        vm.expectRevert(AgentAccount.LegacyUpgradePathDisabled.selector);
        acct.upgradeToWithAuthorization(newImpl, sig);
    }

    function test_C3_upgradeToWithAuthorization_reverts_for_custodian_too() public {
        // The previous behavior would have processed this from a custodian
        // because the gate was the SIGNATURE check, not the CALLER. Now
        // the function literally cannot succeed regardless of caller.
        address newImpl = address(new AgentAccount(IEntryPoint(address(entryPoint)), address(0)));
        vm.prank(custodianA);
        vm.expectRevert(AgentAccount.LegacyUpgradePathDisabled.selector);
        acct.upgradeToWithAuthorization(newImpl, hex"");
    }
}

// ─── Test fixtures ────────────────────────────────────────────────────

contract MockExecutorModule {
    function onInstall(bytes calldata) external {}
    function onUninstall(bytes calldata) external {}
    function isModuleType(uint256 t) external pure returns (bool) {
        return t == 2;
    }
    function isInitialized(address) external pure returns (bool) {
        return true;
    }
}

contract MockHostileDelegationManager {
    fallback() external payable {}
}
