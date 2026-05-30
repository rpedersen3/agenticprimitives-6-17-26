// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/identity/AgentProfileResolver.sol";
import "../../src/identity/AgentProfilePredicates.sol";
import "../../src/ontology/OntologyTermRegistry.sol";
import "../../src/ontology/AttributeStorage.sol";

contract AgentProfileResolverTest is Test {
    OntologyTermRegistry internal ontology;
    AgentProfileResolver internal profile;

    address internal governor = address(0xF00D);
    address internal alice    = address(0xA11CE);
    address internal eve      = address(0xE2E);

    bytes32 internal constant KIND_PERSON = keccak256("person");

    function setUp() public {
        ontology = new OntologyTermRegistry(governor);

        // Register predicates the profile resolver uses.
        bytes32[] memory ids = new bytes32[](6);
        string[] memory curies = new string[](6);
        string[] memory uris = new string[](6);
        string[] memory labels = new string[](6);
        string[] memory datatypes = new string[](6);
        ids[0] = AgentProfilePredicates.ATL_DISPLAY_NAME;          curies[0] = "atl:displayName";       datatypes[0] = "string";
        ids[1] = AgentProfilePredicates.ATL_DESCRIPTION;           curies[1] = "atl:description";       datatypes[1] = "string";
        ids[2] = AgentProfilePredicates.ATL_AGENT_KIND;            curies[2] = "atl:agentKind";         datatypes[2] = "bytes32";
        ids[3] = AgentProfilePredicates.ATL_PROFILE_SCHEMA_URI;    curies[3] = "atl:profileSchemaURI";  datatypes[3] = "string";
        ids[4] = AgentProfilePredicates.ATL_PROFILE_ACTIVE;        curies[4] = "atl:profileActive";     datatypes[4] = "bool";
        ids[5] = AgentProfilePredicates.ATL_PROFILE_REGISTERED_AT; curies[5] = "atl:profileRegisteredAt"; datatypes[5] = "uint256";
        for (uint256 i = 0; i < 6; i++) { uris[i] = ""; labels[i] = ""; }
        vm.prank(governor);
        ontology.registerTermBatch(ids, curies, uris, labels, datatypes);

        profile = new AgentProfileResolver(address(ontology));
    }

    // ─── subject encoding ────────────────────────────────────────────

    function test_subjectFor_putsAddressInLow20Bytes() public view {
        bytes32 subj = profile.subjectFor(alice);
        assertEq(address(uint160(uint256(subj))), alice);
    }

    // ─── register ────────────────────────────────────────────────────

    function test_register_byAgentOK() public {
        vm.prank(alice);
        profile.register(alice, "Alice", "founder", KIND_PERSON, "");
        assertTrue(profile.isRegistered(alice));
        assertEq(profile.getStringProperty(alice, AgentProfilePredicates.ATL_DISPLAY_NAME), "Alice");
        assertEq(profile.getStringProperty(alice, AgentProfilePredicates.ATL_DESCRIPTION), "founder");
        assertEq(profile.getBytes32Property(alice, AgentProfilePredicates.ATL_AGENT_KIND), KIND_PERSON);
        assertTrue(profile.getBoolProperty(alice, AgentProfilePredicates.ATL_PROFILE_ACTIVE));
    }

    function test_register_byNonAgentReverts() public {
        vm.prank(eve);
        vm.expectRevert(AgentProfileResolver.NotAgentOwner.selector);
        profile.register(alice, "Eve", "", KIND_PERSON, "");
    }

    function test_register_twiceReverts() public {
        vm.startPrank(alice);
        profile.register(alice, "Alice", "", KIND_PERSON, "");
        vm.expectRevert(AgentProfileResolver.AlreadyRegistered.selector);
        profile.register(alice, "Alice", "", KIND_PERSON, "");
        vm.stopPrank();
    }

    function test_register_unregisteredPredicateReverts() public {
        // Deactivate ATL_DISPLAY_NAME so register can't write it.
        vm.prank(governor);
        ontology.deactivateTerm(AgentProfilePredicates.ATL_DISPLAY_NAME);
        vm.prank(alice);
        vm.expectRevert(AttributeStorage.PredicateNotActive.selector);
        profile.register(alice, "Alice", "", KIND_PERSON, "");
    }

    // ─── metadata setters (uses metadataURI + metadataHash predicates) ──

    function test_setMetadata_requiresRegistration() public {
        vm.prank(alice);
        vm.expectRevert(AgentProfileResolver.NotRegistered.selector);
        profile.setMetadata(alice, "ipfs://x", keccak256("hash"));
    }

    function test_setMetadata_requiresMetadataPredicates() public {
        vm.prank(alice);
        profile.register(alice, "Alice", "", KIND_PERSON, "");
        // metadataURI predicate isn't registered → write reverts.
        vm.prank(alice);
        vm.expectRevert(AttributeStorage.PredicateNotActive.selector);
        profile.setMetadata(alice, "ipfs://x", keccak256("hash"));
    }

    function test_setMetadata_succeedsWhenPredicatesRegistered() public {
        // Register the metadata predicates first.
        bytes32[] memory ids = new bytes32[](2);
        string[] memory curies = new string[](2);
        string[] memory uris = new string[](2);
        string[] memory labels = new string[](2);
        string[] memory datatypes = new string[](2);
        ids[0] = AgentProfilePredicates.ATL_METADATA_URI;  curies[0] = "atl:metadataURI";  datatypes[0] = "string";
        ids[1] = AgentProfilePredicates.ATL_METADATA_HASH; curies[1] = "atl:metadataHash"; datatypes[1] = "bytes32";
        uris[0] = ""; uris[1] = ""; labels[0] = ""; labels[1] = "";
        vm.prank(governor);
        ontology.registerTermBatch(ids, curies, uris, labels, datatypes);

        vm.prank(alice);
        profile.register(alice, "Alice", "", KIND_PERSON, "");
        bytes32 hash_ = keccak256("v1");
        vm.prank(alice);
        profile.setMetadata(alice, "ipfs://Qm123", hash_);
        assertEq(profile.getStringProperty(alice, AgentProfilePredicates.ATL_METADATA_URI), "ipfs://Qm123");
        assertEq(profile.getBytes32Property(alice, AgentProfilePredicates.ATL_METADATA_HASH), hash_);
    }

    // ─── generic setters (only-agent) ────────────────────────────────

    function test_setStringProperty_byOtherReverts() public {
        vm.prank(alice);
        profile.register(alice, "Alice", "", KIND_PERSON, "");
        vm.prank(eve);
        vm.expectRevert(AgentProfileResolver.NotAgentOwner.selector);
        profile.setStringProperty(alice, AgentProfilePredicates.ATL_DISPLAY_NAME, "Eve");
    }

    function test_setBoolProperty_setActive_flips() public {
        vm.prank(alice);
        profile.register(alice, "Alice", "", KIND_PERSON, "");
        vm.prank(alice);
        profile.setActive(alice, false);
        assertFalse(profile.getBoolProperty(alice, AgentProfilePredicates.ATL_PROFILE_ACTIVE));
    }

    // ─── allAgents enumeration ───────────────────────────────────────

    function test_agentCount_andAllAgents() public {
        address bob = address(0xB0B);
        vm.prank(alice); profile.register(alice, "Alice", "", KIND_PERSON, "");
        vm.prank(bob);   profile.register(bob,   "Bob",   "", KIND_PERSON, "");
        assertEq(profile.agentCount(), 2);
        address[] memory list = profile.getAllAgents();
        assertEq(list.length, 2);
        assertEq(list[0], alice);
        assertEq(list[1], bob);
    }

    // ─── predicate constants are keccak256(curie) ────────────────────

    function test_predicateConstants() public pure {
        assertEq(AgentProfilePredicates.ATL_DISPLAY_NAME, keccak256("atl:displayName"));
        assertEq(AgentProfilePredicates.ATL_DESCRIPTION, keccak256("atl:description"));
        assertEq(AgentProfilePredicates.ATL_HOMEPAGE, keccak256("atl:homepage"));
        assertEq(AgentProfilePredicates.ATL_AVATAR, keccak256("atl:avatar"));
        assertEq(AgentProfilePredicates.ATL_PROFILE_SCHEMA_URI, keccak256("atl:profileSchemaURI"));
        assertEq(AgentProfilePredicates.CLASS_AGENT_PROFILE, keccak256("atl:AgentProfile"));
    }
}
