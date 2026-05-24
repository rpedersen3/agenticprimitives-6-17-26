// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/relationships/RelationshipTypeRegistry.sol";
import "../../src/relationships/AgentRelationshipPredicates.sol";

contract RelationshipTypeRegistryTest is Test {
    RelationshipTypeRegistry internal reg;
    address internal governor = address(0xF00D);
    address internal alice    = address(0xA11CE);

    function setUp() public {
        reg = new RelationshipTypeRegistry(governor);
    }

    function test_constructor_zeroGovernorReverts() public {
        vm.expectRevert(RelationshipTypeRegistry.ZeroGovernor.selector);
        new RelationshipTypeRegistry(address(0));
    }

    function test_registerType_byGovernor() public {
        vm.prank(governor);
        reg.registerType(AgentRelationshipPredicates.HAS_MEMBER, "HAS_MEMBER", false, false, false);
        assertTrue(reg.isRegistered(AgentRelationshipPredicates.HAS_MEMBER));
        assertTrue(reg.isActive(AgentRelationshipPredicates.HAS_MEMBER));
    }

    function test_registerType_byNonGovernorReverts() public {
        vm.prank(alice);
        vm.expectRevert(RelationshipTypeRegistry.NotGovernor.selector);
        reg.registerType(AgentRelationshipPredicates.HAS_MEMBER, "HAS_MEMBER", false, false, false);
    }

    function test_registerType_duplicateReverts() public {
        vm.startPrank(governor);
        reg.registerType(AgentRelationshipPredicates.HAS_MEMBER, "HAS_MEMBER", false, false, false);
        vm.expectRevert(RelationshipTypeRegistry.TypeExists.selector);
        reg.registerType(AgentRelationshipPredicates.HAS_MEMBER, "HAS_MEMBER", false, false, false);
        vm.stopPrank();
    }

    function test_semanticsAccessors() public {
        vm.prank(governor);
        reg.registerType(AgentRelationshipPredicates.HAS_GOVERNANCE_OVER, "HAS_GOVERNANCE_OVER", true, false, false);
        assertTrue(reg.isHierarchical(AgentRelationshipPredicates.HAS_GOVERNANCE_OVER));
        assertFalse(reg.isTransitive(AgentRelationshipPredicates.HAS_GOVERNANCE_OVER));
        assertFalse(reg.isSymmetric(AgentRelationshipPredicates.HAS_GOVERNANCE_OVER));
    }

    function test_partnership_symmetric() public {
        vm.prank(governor);
        reg.registerType(AgentRelationshipPredicates.PARTNERSHIP, "PARTNERSHIP", false, false, true);
        assertTrue(reg.isSymmetric(AgentRelationshipPredicates.PARTNERSHIP));
    }

    function test_updateSemantics_byGovernor() public {
        vm.startPrank(governor);
        reg.registerType(AgentRelationshipPredicates.HAS_MEMBER, "HAS_MEMBER", false, false, false);
        reg.updateSemantics(AgentRelationshipPredicates.HAS_MEMBER, true, true, false);
        vm.stopPrank();
        assertTrue(reg.isHierarchical(AgentRelationshipPredicates.HAS_MEMBER));
        assertTrue(reg.isTransitive(AgentRelationshipPredicates.HAS_MEMBER));
    }

    function test_deactivate_activate() public {
        vm.startPrank(governor);
        reg.registerType(AgentRelationshipPredicates.HAS_MEMBER, "HAS_MEMBER", false, false, false);
        reg.deactivateType(AgentRelationshipPredicates.HAS_MEMBER);
        assertFalse(reg.isActive(AgentRelationshipPredicates.HAS_MEMBER));
        reg.activateType(AgentRelationshipPredicates.HAS_MEMBER);
        assertTrue(reg.isActive(AgentRelationshipPredicates.HAS_MEMBER));
        vm.stopPrank();
    }

    function test_typeCount() public {
        vm.startPrank(governor);
        reg.registerType(AgentRelationshipPredicates.HAS_MEMBER, "HAS_MEMBER", false, false, false);
        reg.registerType(AgentRelationshipPredicates.PARTNERSHIP, "PARTNERSHIP", false, false, true);
        vm.stopPrank();
        assertEq(reg.typeCount(), 2);
        bytes32[] memory ids = reg.getAllTypeIds();
        assertEq(ids.length, 2);
    }

    function test_predicate_constants_areKeccak256() public pure {
        assertEq(AgentRelationshipPredicates.HAS_MEMBER, keccak256("HAS_MEMBER"));
        assertEq(AgentRelationshipPredicates.HAS_GOVERNANCE_OVER, keccak256("HAS_GOVERNANCE_OVER"));
        assertEq(AgentRelationshipPredicates.VALIDATION_TRUST, keccak256("VALIDATION_TRUST"));
        assertEq(AgentRelationshipPredicates.PARTNERSHIP, keccak256("PARTNERSHIP"));
        assertEq(AgentRelationshipPredicates.OPERATES_ON_BEHALF_OF, keccak256("OPERATES_ON_BEHALF_OF"));
        assertEq(AgentRelationshipPredicates.RECOMMENDS, keccak256("RECOMMENDS"));
    }
}
