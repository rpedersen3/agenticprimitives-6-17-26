// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/ontology/OntologyTermRegistry.sol";

contract OntologyTermRegistryTest is Test {
    OntologyTermRegistry internal reg;

    address internal governor = address(0xF00D);
    address internal alice = address(0xA11CE);

    bytes32 internal constant ATL_DISPLAY_NAME = keccak256("atl:displayName");
    bytes32 internal constant ATL_ADDR = keccak256("atl:addr");

    function setUp() public {
        reg = new OntologyTermRegistry(governor);
    }

    function test_constructor_zeroGovernorReverts() public {
        vm.expectRevert(OntologyTermRegistry.ZeroGovernor.selector);
        new OntologyTermRegistry(address(0));
    }

    function test_constructor_setsGovernor() public view {
        assertEq(reg.governor(), governor);
    }

    // ─── registerTerm ───────────────────────────────────────────────

    function test_registerTerm_byGovernor() public {
        vm.prank(governor);
        reg.registerTerm(
            ATL_DISPLAY_NAME,
            "atl:displayName",
            "https://agentictrust.io/ontology/core#displayName",
            "Display Name",
            "string"
        );
        assertTrue(reg.isRegistered(ATL_DISPLAY_NAME));
        assertTrue(reg.isActive(ATL_DISPLAY_NAME));
    }

    function test_registerTerm_byNonGovernorReverts() public {
        vm.prank(alice);
        vm.expectRevert(OntologyTermRegistry.NotGovernor.selector);
        reg.registerTerm(ATL_DISPLAY_NAME, "atl:displayName", "", "", "string");
    }

    function test_registerTerm_duplicateReverts() public {
        vm.startPrank(governor);
        reg.registerTerm(ATL_DISPLAY_NAME, "atl:displayName", "", "", "string");
        vm.expectRevert(OntologyTermRegistry.TermExists.selector);
        reg.registerTerm(ATL_DISPLAY_NAME, "atl:displayName", "", "", "string");
        vm.stopPrank();
    }

    function test_getTerm_returnsFullStruct() public {
        vm.prank(governor);
        reg.registerTerm(ATL_DISPLAY_NAME, "atl:displayName", "uri", "label", "string");
        OntologyTermRegistry.Term memory term = reg.getTerm(ATL_DISPLAY_NAME);
        assertEq(term.id, ATL_DISPLAY_NAME);
        assertEq(term.curie, "atl:displayName");
        assertEq(term.uri, "uri");
        assertEq(term.label, "label");
        assertEq(term.datatype, "string");
        assertTrue(term.active);
    }

    // ─── registerTermBatch ──────────────────────────────────────────

    function test_registerTermBatch_addsAll() public {
        bytes32[] memory ids = new bytes32[](2);
        string[] memory curies = new string[](2);
        string[] memory uris = new string[](2);
        string[] memory labels = new string[](2);
        string[] memory datatypes = new string[](2);
        ids[0] = ATL_DISPLAY_NAME; ids[1] = ATL_ADDR;
        curies[0] = "atl:displayName"; curies[1] = "atl:addr";
        uris[0] = ""; uris[1] = "";
        labels[0] = ""; labels[1] = "";
        datatypes[0] = "string"; datatypes[1] = "address";
        vm.prank(governor);
        reg.registerTermBatch(ids, curies, uris, labels, datatypes);
        assertTrue(reg.isActive(ATL_DISPLAY_NAME));
        assertTrue(reg.isActive(ATL_ADDR));
        assertEq(reg.termCount(), 2);
    }

    function test_registerTermBatch_skipsExisting() public {
        // First register one term solo.
        vm.prank(governor);
        reg.registerTerm(ATL_DISPLAY_NAME, "atl:displayName", "", "", "string");
        // Batch contains existing + new — existing is skipped silently.
        bytes32[] memory ids = new bytes32[](2);
        string[] memory curies = new string[](2);
        string[] memory uris = new string[](2);
        string[] memory labels = new string[](2);
        string[] memory datatypes = new string[](2);
        ids[0] = ATL_DISPLAY_NAME; ids[1] = ATL_ADDR;
        curies[0] = "atl:displayName"; curies[1] = "atl:addr";
        uris[0] = ""; uris[1] = "";
        labels[0] = ""; labels[1] = "";
        datatypes[0] = "string"; datatypes[1] = "address";
        vm.prank(governor);
        reg.registerTermBatch(ids, curies, uris, labels, datatypes);
        assertEq(reg.termCount(), 2);
    }

    // ─── deactivate / activate ──────────────────────────────────────

    function test_deactivateTerm_byGovernor() public {
        vm.prank(governor);
        reg.registerTerm(ATL_DISPLAY_NAME, "atl:displayName", "", "", "string");
        vm.prank(governor);
        reg.deactivateTerm(ATL_DISPLAY_NAME);
        assertFalse(reg.isActive(ATL_DISPLAY_NAME));
        assertTrue(reg.isRegistered(ATL_DISPLAY_NAME));
    }

    function test_deactivateTerm_unknownReverts() public {
        vm.prank(governor);
        vm.expectRevert(OntologyTermRegistry.TermNotFound.selector);
        reg.deactivateTerm(keccak256("atl:nope"));
    }

    function test_activateTerm_restoresActivity() public {
        vm.startPrank(governor);
        reg.registerTerm(ATL_DISPLAY_NAME, "atl:displayName", "", "", "string");
        reg.deactivateTerm(ATL_DISPLAY_NAME);
        reg.activateTerm(ATL_DISPLAY_NAME);
        vm.stopPrank();
        assertTrue(reg.isActive(ATL_DISPLAY_NAME));
    }

    // ─── transferGovernor ───────────────────────────────────────────

    function test_transferGovernor_byGovernor() public {
        vm.prank(governor);
        reg.transferGovernor(alice);
        assertEq(reg.governor(), alice);
    }

    function test_transferGovernor_byNonGovernorReverts() public {
        vm.prank(alice);
        vm.expectRevert(OntologyTermRegistry.NotGovernor.selector);
        reg.transferGovernor(alice);
    }

    function test_transferGovernor_zeroReverts() public {
        vm.prank(governor);
        vm.expectRevert(OntologyTermRegistry.ZeroGovernor.selector);
        reg.transferGovernor(address(0));
    }
}
