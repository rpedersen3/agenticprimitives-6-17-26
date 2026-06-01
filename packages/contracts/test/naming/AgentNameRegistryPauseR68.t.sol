// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {AgentNameRegistry} from "../../src/naming/AgentNameRegistry.sol";
import {AgentNameAttributeResolver} from "../../src/naming/AgentNameAttributeResolver.sol";
import {PermissionlessSubregistry} from "../../src/naming/PermissionlessSubregistry.sol";
import {OntologyTermRegistry} from "../../src/ontology/OntologyTermRegistry.sol";
import {IGovernanceView} from "../../src/governance/IGovernance.sol";
import {GovernanceManaged} from "../../src/governance/GovernanceManaged.sol";

/**
 * R6.8 / CON-NAMING-005 — System-pause coverage on the naming layer.
 *
 * R6.1 recon § 2.5 identified that `AgentNameRegistry` (6 mutating
 * fns) and `PermissionlessSubregistry` (1) had ZERO pause checks.
 * Names could be registered, owned, renewed, primaries set during
 * a system pause.
 *
 * R6.8 makes `AgentNameRegistry` inherit `GovernanceManaged` and
 * applies `whenNotPaused` to its 7 mutating entrypoints. The
 * one-shot bootstrap `initializeRoot` stays unguarded (it's
 * exclusively callable by the immutable initializer in the same
 * deploy tx — pause is a runtime concern).
 *
 * `PermissionlessSubregistry` inherits pause coverage transitively
 * via its inner `REGISTRY.register(...)` call: when paused, the
 * registry's modifier fires inside the subregistry's flow and the
 * outer call propagates the revert.
 *
 * Same pattern as R6.5 (AgentAccount) + R6.6 (CustodyPolicy).
 */
contract AgentNameRegistryPauseR68Test is Test {
    MockPausableGovernance gov;
    AgentNameRegistry registry;
    AgentNameAttributeResolver resolver;
    PermissionlessSubregistry subregistry;
    OntologyTermRegistry ontology;

    address deployer = address(0xD3D);
    bytes32 rootNode;
    bytes32 testNode;

    function setUp() public {
        gov = new MockPausableGovernance();
        registry = new AgentNameRegistry(deployer, address(gov));
        ontology = new OntologyTermRegistry(deployer);
        resolver = new AgentNameAttributeResolver(registry, address(ontology));

        // Bootstrap root + a test node FROM THE INITIALIZER while unpaused.
        // The registry's pause is OFF during setUp.
        assertFalse(gov.isPaused());
        vm.prank(deployer);
        rootNode = registry.initializeRoot("agent", deployer, address(resolver), keccak256("namespace:Agent"));
        vm.prank(deployer);
        testNode = registry.register(rootNode, "test", deployer, address(resolver), 0);

        // Set up the subregistry too — used by the transitive-pause test.
        subregistry = new PermissionlessSubregistry(registry, testNode, address(resolver));
        vm.prank(deployer);
        registry.setSubregistry(testNode, address(subregistry));
    }

    // ─── 7 guarded entrypoints — must revert with SystemPaused when paused ─

    function test_R6_8_register_pausedReverts() public {
        gov.setPaused(true);
        vm.prank(deployer);
        vm.expectRevert(GovernanceManaged.SystemPaused.selector);
        registry.register(rootNode, "blocked", deployer, address(resolver), 0);
    }

    function test_R6_8_backfillLabel_pausedReverts() public {
        gov.setPaused(true);
        vm.prank(deployer);
        vm.expectRevert(GovernanceManaged.SystemPaused.selector);
        registry.backfillLabel(testNode, "test");
    }

    function test_R6_8_setOwner_pausedReverts() public {
        gov.setPaused(true);
        vm.prank(deployer);
        vm.expectRevert(GovernanceManaged.SystemPaused.selector);
        registry.setOwner(testNode, address(0xC0DE));
    }

    function test_R6_8_setResolver_pausedReverts() public {
        gov.setPaused(true);
        vm.prank(deployer);
        vm.expectRevert(GovernanceManaged.SystemPaused.selector);
        registry.setResolver(testNode, address(0xC0DE));
    }

    function test_R6_8_setSubregistry_pausedReverts() public {
        gov.setPaused(true);
        vm.prank(deployer);
        vm.expectRevert(GovernanceManaged.SystemPaused.selector);
        registry.setSubregistry(testNode, address(0xC0DE));
    }

    function test_R6_8_renew_pausedReverts() public {
        gov.setPaused(true);
        vm.prank(deployer);
        vm.expectRevert(GovernanceManaged.SystemPaused.selector);
        registry.renew(testNode, uint64(block.timestamp + 365 days));
    }

    function test_R6_8_setPrimaryName_pausedReverts() public {
        gov.setPaused(true);
        vm.prank(deployer);
        vm.expectRevert(GovernanceManaged.SystemPaused.selector);
        registry.setPrimaryName(testNode);
    }

    // ─── Sanity: unpaused succeeds for at least one path ───────────

    function test_R6_8_register_unpausedSucceeds() public {
        gov.setPaused(false);
        vm.prank(deployer);
        bytes32 newNode = registry.register(rootNode, "openok", deployer, address(resolver), 0);
        assertEq(registry.owner(newNode), deployer);
    }

    // ─── initializeRoot — one-shot bootstrap, deliberately unguarded ─

    function test_R6_8_initializeRoot_succeedsWhenPaused() public {
        // Deploy a SECOND registry so initializeRoot can run from
        // scratch. setUp already consumed the first registry's slot.
        gov.setPaused(true);
        AgentNameRegistry r2 = new AgentNameRegistry(deployer, address(gov));
        vm.prank(deployer);
        bytes32 newRoot = r2.initializeRoot("other", deployer, address(resolver), keccak256("namespace:Agent"));
        // The root was registered despite the pause flag.
        assertEq(r2.owner(newRoot), deployer);
    }

    // ─── PermissionlessSubregistry — inherits pause transitively ───

    function test_R6_8_subregistryRegister_pausedRevertsTransitively() public {
        gov.setPaused(true);
        address alice = address(0xA11CE);
        vm.prank(alice);
        // The subregistry's register() calls REGISTRY.register() which
        // fires whenNotPaused. The revert propagates through the
        // subregistry's outer call.
        vm.expectRevert(GovernanceManaged.SystemPaused.selector);
        subregistry.register("blocked", alice);
    }

    // ─── Legacy compatibility — EOA governance treated as not paused ─

    function test_R6_8_legacy_eoaGovernance_neverPaused() public {
        // Registry constructed with an EOA governance — _pausedSafe()
        // returns false because EOA has no code.
        AgentNameRegistry eoaReg = new AgentNameRegistry(deployer, deployer);
        vm.prank(deployer);
        bytes32 eoaRoot = eoaReg.initializeRoot("eoaroot", deployer, address(resolver), keccak256("namespace:Agent"));
        vm.prank(deployer);
        // No revert even though the "governance" (deployer EOA) has
        // no isPaused() function.
        bytes32 node = eoaReg.register(eoaRoot, "fine", deployer, address(resolver), 0);
        assertEq(eoaReg.owner(node), deployer);
    }

    // ─── ZeroGovernance — constructor rejects address(0) ───────────

    function test_R6_8_zeroGovernance_constructorReverts() public {
        vm.expectRevert(GovernanceManaged.ZeroGovernance.selector);
        new AgentNameRegistry(deployer, address(0));
    }
}

// ─── Minimal pausable governance mock ──────────────────────────────

contract MockPausableGovernance is IGovernanceView {
    bool private _paused;
    function setPaused(bool p) external { _paused = p; }
    function isPaused() external view returns (bool) { return _paused; }
    function isSigner(address) external pure returns (bool) { return false; }
}
