// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/ontology/ShapeRegistry.sol";
import "../../src/ontology/AttributeStorage.sol";
import "../../src/ontology/OntologyTermRegistry.sol";

/// @dev Concrete AttributeStorage subclass used only for shape tests.
contract _TestStore is AttributeStorage {
    constructor(address ontology) AttributeStorage(ontology) {}

    function setString(bytes32 subject, bytes32 predicate, string calldata value) external {
        _setString(subject, predicate, value);
    }

    function setBytes32(bytes32 subject, bytes32 predicate, bytes32 value) external {
        _setBytes32(subject, predicate, value);
    }
}

contract ShapeRegistryTest is Test {
    OntologyTermRegistry internal ontology;
    ShapeRegistry internal shapes;
    _TestStore internal store;

    address internal governor = address(0xF00D);
    bytes32 internal constant ATL_DISPLAY_NAME = keccak256("atl:displayName");
    bytes32 internal constant ATL_AGENT_KIND = keccak256("atl:agentKind");
    bytes32 internal constant CLASS_TEST = keccak256("test:Class");
    bytes32 internal constant AGENT_KIND_ENUM = keccak256("test:AgentKindEnum");
    bytes32 internal constant KIND_PERSON = keccak256("person");
    bytes32 internal constant KIND_ORG = keccak256("org");
    bytes32 internal constant SUBJECT = keccak256("test:subject1");

    function setUp() public {
        ontology = new OntologyTermRegistry(governor);
        shapes = new ShapeRegistry(governor);
        store = new _TestStore(address(ontology));

        // Register the predicates we'll use.
        vm.startPrank(governor);
        ontology.registerTerm(ATL_DISPLAY_NAME, "atl:displayName", "", "", "string");
        ontology.registerTerm(ATL_AGENT_KIND, "atl:agentKind", "", "", "bytes32");
        vm.stopPrank();
    }

    // ─── defineShape ────────────────────────────────────────────────

    function test_defineShape_byGovernor() public {
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](1);
        props[0] = ShapeRegistry.PropertyConstraint({
            predicate: ATL_DISPLAY_NAME,
            expectedDatatype: store.DT_STRING_PUB(),
            cardinality: ShapeRegistry.Cardinality.OPTIONAL,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        vm.prank(governor);
        uint16 version = shapes.defineShape(CLASS_TEST, props, "uri", keccak256("shape-hash"));
        assertEq(version, 1);
        ShapeRegistry.Shape memory s = shapes.getShape(CLASS_TEST);
        assertTrue(s.exists);
        assertTrue(s.active);
        assertEq(s.version, 1);
    }

    function test_defineShape_byNonGovernorReverts() public {
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](0);
        vm.expectRevert(ShapeRegistry.NotGovernor.selector);
        shapes.defineShape(CLASS_TEST, props, "", bytes32(0));
    }

    function test_defineShape_duplicateReverts() public {
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](0);
        vm.startPrank(governor);
        shapes.defineShape(CLASS_TEST, props, "", bytes32(0));
        vm.expectRevert(ShapeRegistry.ShapeAlreadyDefined.selector);
        shapes.defineShape(CLASS_TEST, props, "", bytes32(0));
        vm.stopPrank();
    }

    // ─── validateSubject ────────────────────────────────────────────

    function test_validateSubject_passesForOptionalUnset() public {
        // OPTIONAL property; subject has nothing set. Should pass.
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](1);
        props[0] = ShapeRegistry.PropertyConstraint({
            predicate: ATL_DISPLAY_NAME,
            expectedDatatype: store.DT_STRING_PUB(),
            cardinality: ShapeRegistry.Cardinality.OPTIONAL,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        vm.prank(governor);
        shapes.defineShape(CLASS_TEST, props, "", bytes32(0));
        assertTrue(shapes.isValid(CLASS_TEST, SUBJECT, address(store)));
    }

    function test_validateSubject_failsForMissingRequired() public {
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](1);
        props[0] = ShapeRegistry.PropertyConstraint({
            predicate: ATL_DISPLAY_NAME,
            expectedDatatype: store.DT_STRING_PUB(),
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        vm.prank(governor);
        shapes.defineShape(CLASS_TEST, props, "", bytes32(0));
        assertFalse(shapes.isValid(CLASS_TEST, SUBJECT, address(store)));
    }

    function test_validateSubject_passesWhenRequiredSet() public {
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](1);
        props[0] = ShapeRegistry.PropertyConstraint({
            predicate: ATL_DISPLAY_NAME,
            expectedDatatype: store.DT_STRING_PUB(),
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        vm.prank(governor);
        shapes.defineShape(CLASS_TEST, props, "", bytes32(0));
        store.setString(SUBJECT, ATL_DISPLAY_NAME, "Alice");
        assertTrue(shapes.isValid(CLASS_TEST, SUBJECT, address(store)));
    }

    function test_validateSubject_failsWrongDatatype() public {
        // Shape says ATL_DISPLAY_NAME is bytes32 (wrong), but store has string.
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](1);
        props[0] = ShapeRegistry.PropertyConstraint({
            predicate: ATL_DISPLAY_NAME,
            expectedDatatype: store.DT_BYTES32_PUB(),
            cardinality: ShapeRegistry.Cardinality.OPTIONAL,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        vm.prank(governor);
        shapes.defineShape(CLASS_TEST, props, "", bytes32(0));
        store.setString(SUBJECT, ATL_DISPLAY_NAME, "wrong-type");
        assertFalse(shapes.isValid(CLASS_TEST, SUBJECT, address(store)));
    }

    // ─── enum validation ────────────────────────────────────────────

    function test_enumValidation_allowedValuePasses() public {
        // Define enum + shape with enum-bound property.
        bytes32[] memory allowed = new bytes32[](2);
        allowed[0] = KIND_PERSON; allowed[1] = KIND_ORG;
        vm.prank(governor);
        shapes.defineEnumSet(AGENT_KIND_ENUM, allowed);

        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](1);
        props[0] = ShapeRegistry.PropertyConstraint({
            predicate: ATL_AGENT_KIND,
            expectedDatatype: store.DT_BYTES32_PUB(),
            cardinality: ShapeRegistry.Cardinality.OPTIONAL,
            enumSetId: AGENT_KIND_ENUM,
            expectedClass: bytes32(0)
        });
        vm.prank(governor);
        shapes.defineShape(CLASS_TEST, props, "", bytes32(0));
        store.setBytes32(SUBJECT, ATL_AGENT_KIND, KIND_PERSON);
        assertTrue(shapes.isValid(CLASS_TEST, SUBJECT, address(store)));
    }

    function test_enumValidation_disallowedValueFails() public {
        bytes32[] memory allowed = new bytes32[](1);
        allowed[0] = KIND_PERSON;
        vm.prank(governor);
        shapes.defineEnumSet(AGENT_KIND_ENUM, allowed);
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](1);
        props[0] = ShapeRegistry.PropertyConstraint({
            predicate: ATL_AGENT_KIND,
            expectedDatatype: store.DT_BYTES32_PUB(),
            cardinality: ShapeRegistry.Cardinality.OPTIONAL,
            enumSetId: AGENT_KIND_ENUM,
            expectedClass: bytes32(0)
        });
        vm.prank(governor);
        shapes.defineShape(CLASS_TEST, props, "", bytes32(0));
        store.setBytes32(SUBJECT, ATL_AGENT_KIND, KIND_ORG);
        assertFalse(shapes.isValid(CLASS_TEST, SUBJECT, address(store)));
    }

    function test_defineEnumSet_emptyReverts() public {
        bytes32[] memory empty = new bytes32[](0);
        vm.prank(governor);
        vm.expectRevert(ShapeRegistry.EnumSetEmpty.selector);
        shapes.defineEnumSet(AGENT_KIND_ENUM, empty);
    }

    // ─── validate unknown shape ─────────────────────────────────────

    function test_validateSubject_unknownShapeReverts() public {
        vm.expectRevert(ShapeRegistry.ShapeNotDefined.selector);
        shapes.validateSubject(keccak256("never-defined"), SUBJECT, address(store));
    }

    function test_validateSubject_deactivatedShapeReverts() public {
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](0);
        vm.startPrank(governor);
        shapes.defineShape(CLASS_TEST, props, "", bytes32(0));
        shapes.deactivateShape(CLASS_TEST);
        vm.stopPrank();
        vm.expectRevert(ShapeRegistry.ShapeNotActive.selector);
        shapes.validateSubject(CLASS_TEST, SUBJECT, address(store));
    }
}
