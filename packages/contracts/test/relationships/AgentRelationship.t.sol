// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/relationships/AgentRelationship.sol";
import "../../src/relationships/AgentRelationshipPredicates.sol";

contract AgentRelationshipTest is Test {
    AgentRelationship internal rel;

    address internal alice = address(0xA11CE);
    address internal bob   = address(0xB0B);
    address internal eve   = address(0xE2E);

    function setUp() public {
        rel = new AgentRelationship();
    }

    // ─── computeEdgeId ──────────────────────────────────────────────

    function test_computeEdgeId_isDeterministic() public view {
        bytes32 a = rel.computeEdgeId(alice, bob, AgentRelationshipPredicates.HAS_MEMBER);
        bytes32 b = rel.computeEdgeId(alice, bob, AgentRelationshipPredicates.HAS_MEMBER);
        assertEq(a, b);
    }

    function test_computeEdgeId_directionMatters() public view {
        bytes32 ab = rel.computeEdgeId(alice, bob, AgentRelationshipPredicates.HAS_MEMBER);
        bytes32 ba = rel.computeEdgeId(bob, alice, AgentRelationshipPredicates.HAS_MEMBER);
        assertTrue(ab != ba);
    }

    function test_computeEdgeId_typeMatters() public view {
        bytes32 mem = rel.computeEdgeId(alice, bob, AgentRelationshipPredicates.HAS_MEMBER);
        bytes32 gov = rel.computeEdgeId(alice, bob, AgentRelationshipPredicates.HAS_GOVERNANCE_OVER);
        assertTrue(mem != gov);
    }

    // ─── proposeEdge ────────────────────────────────────────────────

    function test_proposeEdge_subjectCallerOK() public {
        bytes32[] memory roles = new bytes32[](1);
        roles[0] = AgentRelationshipPredicates.ROLE_MEMBER;
        vm.prank(alice);
        bytes32 edgeId = rel.proposeEdge(alice, bob, AgentRelationshipPredicates.HAS_MEMBER, roles, "uri", bytes32(0));
        AgentRelationship.Edge memory e = rel.getEdge(edgeId);
        assertEq(e.subject, alice);
        assertEq(e.object_, bob);
        assertEq(uint8(e.status), uint8(AgentRelationship.EdgeStatus.PROPOSED));
        assertTrue(rel.hasRole(edgeId, AgentRelationshipPredicates.ROLE_MEMBER));
    }

    function test_proposeEdge_nonSubjectCallerReverts() public {
        bytes32[] memory empty = new bytes32[](0);
        vm.prank(eve);
        vm.expectRevert(AgentRelationship.NotAuthorized.selector);
        rel.proposeEdge(alice, bob, AgentRelationshipPredicates.HAS_MEMBER, empty, "", bytes32(0));
    }

    function test_proposeEdge_selfEdgeReverts() public {
        bytes32[] memory empty = new bytes32[](0);
        vm.prank(alice);
        vm.expectRevert(AgentRelationship.InvalidEdge.selector);
        rel.proposeEdge(alice, alice, AgentRelationshipPredicates.HAS_MEMBER, empty, "", bytes32(0));
    }

    function test_proposeEdge_zeroAddressReverts() public {
        bytes32[] memory empty = new bytes32[](0);
        vm.prank(alice);
        vm.expectRevert(AgentRelationship.InvalidEdge.selector);
        rel.proposeEdge(alice, address(0), AgentRelationshipPredicates.HAS_MEMBER, empty, "", bytes32(0));
    }

    function test_proposeEdge_duplicateReverts() public {
        bytes32[] memory empty = new bytes32[](0);
        vm.startPrank(alice);
        rel.proposeEdge(alice, bob, AgentRelationshipPredicates.HAS_MEMBER, empty, "", bytes32(0));
        vm.expectRevert(AgentRelationship.EdgeAlreadyExists.selector);
        rel.proposeEdge(alice, bob, AgentRelationshipPredicates.HAS_MEMBER, empty, "", bytes32(0));
        vm.stopPrank();
    }

    // ─── confirmEdge / activateEdge ─────────────────────────────────

    function _propose() internal returns (bytes32) {
        bytes32[] memory empty = new bytes32[](0);
        vm.prank(alice);
        return rel.proposeEdge(alice, bob, AgentRelationshipPredicates.HAS_MEMBER, empty, "", bytes32(0));
    }

    function test_confirmEdge_byObjectOK() public {
        bytes32 edgeId = _propose();
        vm.prank(bob);
        rel.confirmEdge(edgeId);
        assertEq(uint8(rel.getEdge(edgeId).status), uint8(AgentRelationship.EdgeStatus.CONFIRMED));
    }

    function test_confirmEdge_bySubjectReverts() public {
        bytes32 edgeId = _propose();
        vm.prank(alice);
        vm.expectRevert(AgentRelationship.NotAuthorized.selector);
        rel.confirmEdge(edgeId);
    }

    function test_confirmEdge_byStrangerReverts() public {
        bytes32 edgeId = _propose();
        vm.prank(eve);
        vm.expectRevert(AgentRelationship.NotAuthorized.selector);
        rel.confirmEdge(edgeId);
    }

    function test_confirmEdge_unknownReverts() public {
        vm.prank(bob);
        vm.expectRevert(AgentRelationship.EdgeNotFound.selector);
        rel.confirmEdge(keccak256("nope"));
    }

    function test_activateEdge_eitherSideOK() public {
        bytes32 edgeId = _propose();
        vm.prank(bob);
        rel.confirmEdge(edgeId);
        vm.prank(alice);
        rel.activateEdge(edgeId);
        assertEq(uint8(rel.getEdge(edgeId).status), uint8(AgentRelationship.EdgeStatus.ACTIVE));
    }

    function test_activateEdge_wrongStateReverts() public {
        bytes32 edgeId = _propose();
        vm.prank(alice);
        vm.expectRevert(AgentRelationship.InvalidTransition.selector);
        rel.activateEdge(edgeId);
    }

    // ─── revokeEdge ─────────────────────────────────────────────────

    function test_revokeEdge_subjectMayRevoke() public {
        bytes32 edgeId = _propose();
        vm.prank(alice);
        rel.revokeEdge(edgeId);
        assertEq(uint8(rel.getEdge(edgeId).status), uint8(AgentRelationship.EdgeStatus.REVOKED));
    }

    function test_revokeEdge_objectMayRevoke() public {
        bytes32 edgeId = _propose();
        vm.prank(bob);
        rel.revokeEdge(edgeId);
        assertEq(uint8(rel.getEdge(edgeId).status), uint8(AgentRelationship.EdgeStatus.REVOKED));
    }

    function test_revokeEdge_strangerReverts() public {
        bytes32 edgeId = _propose();
        vm.prank(eve);
        vm.expectRevert(AgentRelationship.NotAuthorized.selector);
        rel.revokeEdge(edgeId);
    }

    function test_revokeEdge_alreadyRevokedReverts() public {
        bytes32 edgeId = _propose();
        vm.prank(alice);
        rel.revokeEdge(edgeId);
        vm.prank(alice);
        vm.expectRevert(AgentRelationship.InvalidTransition.selector);
        rel.revokeEdge(edgeId);
    }

    // ─── roles ──────────────────────────────────────────────────────

    function test_addRole_bySubjectOK() public {
        bytes32 edgeId = _propose();
        vm.prank(alice);
        rel.addRole(edgeId, AgentRelationshipPredicates.ROLE_OPERATOR);
        assertTrue(rel.hasRole(edgeId, AgentRelationshipPredicates.ROLE_OPERATOR));
    }

    function test_addRole_byObjectOK() public {
        bytes32 edgeId = _propose();
        vm.prank(bob);
        rel.addRole(edgeId, AgentRelationshipPredicates.ROLE_VALIDATOR);
        assertTrue(rel.hasRole(edgeId, AgentRelationshipPredicates.ROLE_VALIDATOR));
    }

    function test_addRole_byStrangerReverts() public {
        bytes32 edgeId = _propose();
        vm.prank(eve);
        vm.expectRevert(AgentRelationship.NotAuthorized.selector);
        rel.addRole(edgeId, AgentRelationshipPredicates.ROLE_OPERATOR);
    }

    function test_addRole_duplicateReverts() public {
        bytes32 edgeId = _propose();
        vm.startPrank(alice);
        rel.addRole(edgeId, AgentRelationshipPredicates.ROLE_OPERATOR);
        vm.expectRevert(AgentRelationship.RoleAlreadyExists.selector);
        rel.addRole(edgeId, AgentRelationshipPredicates.ROLE_OPERATOR);
        vm.stopPrank();
    }

    function test_removeRole_clearsRole() public {
        bytes32 edgeId = _propose();
        vm.startPrank(alice);
        rel.addRole(edgeId, AgentRelationshipPredicates.ROLE_OPERATOR);
        rel.removeRole(edgeId, AgentRelationshipPredicates.ROLE_OPERATOR);
        vm.stopPrank();
        assertFalse(rel.hasRole(edgeId, AgentRelationshipPredicates.ROLE_OPERATOR));
    }

    function test_removeRole_unknownReverts() public {
        bytes32 edgeId = _propose();
        vm.prank(alice);
        vm.expectRevert(AgentRelationship.RoleNotFound.selector);
        rel.removeRole(edgeId, AgentRelationshipPredicates.ROLE_OPERATOR);
    }

    // ─── metadata ───────────────────────────────────────────────────

    function test_setMetadata_byEitherSide() public {
        bytes32 edgeId = _propose();
        bytes32 hash_ = keccak256("v1");
        vm.prank(bob);
        rel.setMetadata(edgeId, "ipfs://Qm123", hash_);
        AgentRelationship.Edge memory e = rel.getEdge(edgeId);
        assertEq(e.metadataURI, "ipfs://Qm123");
        assertEq(e.metadataHash, hash_);
    }

    // ─── indexing queries ───────────────────────────────────────────

    function test_edgesBySubject() public {
        bytes32 e1 = _propose();
        bytes32[] memory list = rel.getEdgesBySubject(alice);
        assertEq(list.length, 1);
        assertEq(list[0], e1);
    }

    function test_byTriple() public {
        bytes32 e1 = _propose();
        assertEq(rel.getEdgeByTriple(alice, bob, AgentRelationshipPredicates.HAS_MEMBER), e1);
    }
}
