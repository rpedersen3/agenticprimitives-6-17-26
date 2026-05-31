// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/naming/AgentNameRegistry.sol";
import "../../src/naming/AgentNameAttributeResolver.sol";
import "../../src/naming/AgentNamePredicates.sol";
import "../../src/ontology/OntologyTermRegistry.sol";
import "../../src/ontology/AttributeStorage.sol";

contract AgentNameAttributeResolverTest is Test {
    AgentNameRegistry internal reg;
    OntologyTermRegistry internal ontology;
    AgentNameAttributeResolver internal resolver;

    address internal governor = address(0xF00D);
    address internal deployer = address(0xD3D);
    address internal aliceAgent = address(0xA11CE);
    address internal eve = address(0xE2E);
    bytes32 internal AGENT_ROOT_NODE;
    bytes32 internal aliceNode;

    function setUp() public {
        reg = new AgentNameRegistry(deployer);
        ontology = new OntologyTermRegistry(governor);
        resolver = new AgentNameAttributeResolver(reg, address(ontology));

        // Register the predicates the SDK uses.
        bytes32[] memory ids = new bytes32[](4);
        string[] memory curies = new string[](4);
        string[] memory uris = new string[](4);
        string[] memory labels = new string[](4);
        string[] memory datatypes = new string[](4);
        ids[0] = AgentNamePredicates.ATL_ADDR;
        ids[1] = AgentNamePredicates.ATL_DISPLAY_NAME;
        ids[2] = AgentNamePredicates.ATL_AGENT_KIND;
        ids[3] = AgentNamePredicates.ATL_A2A_ENDPOINT;
        curies[0] = "atl:addr"; curies[1] = "atl:displayName"; curies[2] = "atl:agentKind"; curies[3] = "atl:a2aEndpoint";
        uris[0] = ""; uris[1] = ""; uris[2] = ""; uris[3] = "";
        labels[0] = ""; labels[1] = ""; labels[2] = ""; labels[3] = "";
        datatypes[0] = "address"; datatypes[1] = "string"; datatypes[2] = "bytes32"; datatypes[3] = "string";
        vm.prank(governor);
        ontology.registerTermBatch(ids, curies, uris, labels, datatypes);

        vm.prank(deployer);
        AGENT_ROOT_NODE = reg.initializeRoot("agent", deployer, address(resolver), keccak256("namespace:Agent"));
        vm.prank(deployer);
        aliceNode = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(resolver), 0);
    }

    // ─── Typed setters require predicate to be active ───────────────

    function test_setStringAttribute_unregisteredPredicateReverts() public {
        vm.prank(aliceAgent);
        vm.expectRevert(AttributeStorage.PredicateNotActive.selector);
        resolver.setStringAttribute(aliceNode, keccak256("atl:notRegistered"), "value");
    }

    function test_setStringAttribute_deactivatedPredicateReverts() public {
        vm.prank(governor);
        ontology.deactivateTerm(AgentNamePredicates.ATL_DISPLAY_NAME);
        vm.prank(aliceAgent);
        vm.expectRevert(AttributeStorage.PredicateNotActive.selector);
        resolver.setStringAttribute(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME, "Alice");
    }

    // ─── Typed setters: string ──────────────────────────────────────

    function test_setStringAttribute_byOwner() public {
        vm.prank(aliceAgent);
        resolver.setStringAttribute(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME, "Alice");
        assertEq(resolver.getString(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME), "Alice");
    }

    function test_setStringAttribute_byNonOwnerReverts() public {
        vm.prank(eve);
        vm.expectRevert(AgentNameAttributeResolver.NotAuthorized.selector);
        resolver.setStringAttribute(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME, "Eve");
    }

    function test_setStringAttribute_unregisteredNodeReverts() public {
        vm.prank(aliceAgent);
        vm.expectRevert(AgentNameAttributeResolver.NodeNotFound.selector);
        resolver.setStringAttribute(keccak256("nope"), AgentNamePredicates.ATL_DISPLAY_NAME, "x");
    }

    // ─── Typed setters: address ─────────────────────────────────────

    function test_setAddressAttribute_byOwner() public {
        vm.prank(aliceAgent);
        resolver.setAddressAttribute(aliceNode, AgentNamePredicates.ATL_ADDR, aliceAgent);
        assertEq(resolver.getAddress(aliceNode, AgentNamePredicates.ATL_ADDR), aliceAgent);
    }

    function test_addr_unsetReturnsZero() public view {
        assertEq(resolver.getAddress(aliceNode, AgentNamePredicates.ATL_ADDR), address(0));
    }

    // ─── Typed setters: bytes32 (agent kind) ────────────────────────

    function test_setBytes32Attribute_kindStoredAsBytes32() public {
        vm.prank(aliceAgent);
        resolver.setBytes32Attribute(aliceNode, AgentNamePredicates.ATL_AGENT_KIND, AgentNamePredicates.AGENT_KIND_PERSON);
        assertEq(resolver.getBytes32(aliceNode, AgentNamePredicates.ATL_AGENT_KIND), AgentNamePredicates.AGENT_KIND_PERSON);
    }

    // ─── AttributeStorage indexing ──────────────────────────────────

    function test_predicatesOf_listsAllSetPredicates() public {
        vm.startPrank(aliceAgent);
        resolver.setStringAttribute(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME, "Alice");
        resolver.setAddressAttribute(aliceNode, AgentNamePredicates.ATL_ADDR, aliceAgent);
        resolver.setStringAttribute(aliceNode, AgentNamePredicates.ATL_A2A_ENDPOINT, "https://x/");
        vm.stopPrank();
        bytes32[] memory preds = resolver.predicatesOf(aliceNode);
        assertEq(preds.length, 3);
        // Insertion order.
        assertEq(preds[0], AgentNamePredicates.ATL_DISPLAY_NAME);
        assertEq(preds[1], AgentNamePredicates.ATL_ADDR);
        assertEq(preds[2], AgentNamePredicates.ATL_A2A_ENDPOINT);
    }

    function test_subjectVersion_bumpsOnWrite() public {
        assertEq(resolver.subjectVersion(aliceNode), 0);
        vm.prank(aliceAgent);
        resolver.setStringAttribute(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME, "v1");
        assertEq(resolver.subjectVersion(aliceNode), 1);
        vm.prank(aliceAgent);
        resolver.setStringAttribute(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME, "v2");
        assertEq(resolver.subjectVersion(aliceNode), 2);
    }

    function test_isSet_isTrueAfterWrite() public {
        assertFalse(resolver.isSet(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME));
        vm.prank(aliceAgent);
        resolver.setStringAttribute(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME, "Alice");
        assertTrue(resolver.isSet(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME));
    }

    function test_unsetAttribute_clearsAndBumpsVersion() public {
        vm.prank(aliceAgent);
        resolver.setStringAttribute(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME, "Alice");
        uint64 versionBefore = resolver.subjectVersion(aliceNode);
        vm.prank(aliceAgent);
        resolver.unsetAttribute(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME);
        assertFalse(resolver.isSet(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME));
        assertGt(resolver.subjectVersion(aliceNode), versionBefore);
    }

    function test_unsetAttribute_unsetReverts() public {
        vm.prank(aliceAgent);
        vm.expectRevert(AttributeStorage.AttributeNotSet.selector);
        resolver.unsetAttribute(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME);
    }

    // ─── owner-rotation invalidates writer authority ────────────────

    function test_ownerRotation_oldOwnerLosesAuthority() public {
        vm.prank(aliceAgent);
        resolver.setStringAttribute(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME, "Alice");
        vm.prank(aliceAgent);
        reg.setOwner(aliceNode, address(0xCAFE));
        vm.prank(aliceAgent);
        vm.expectRevert(AgentNameAttributeResolver.NotAuthorized.selector);
        resolver.setStringAttribute(aliceNode, AgentNamePredicates.ATL_DISPLAY_NAME, "Stale");
    }
}
