// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {SkillDefinitionRegistry} from "../src/skills/SkillDefinitionRegistry.sol";
import {GeoFeatureRegistry} from "../src/geo/GeoFeatureRegistry.sol";

/**
 * Definition registries (spec 251). On chain we hold only the PUBLIC versioned
 * definition anchors — skill/geo CLAIMS are private vault-resident credentials
 * pointing to a (definitionId, version) here, never an on-chain claim registry.
 */
contract DefinitionRegistriesTest is Test {
    SkillDefinitionRegistry skills;
    GeoFeatureRegistry geo;

    uint256 internal constant STEWARD_PK = 0x5;
    uint256 internal constant OTHER_PK = 0xA11CE;
    address internal steward;
    address internal other;

    bytes32 internal constant SKILL = keccak256("skill:grant-writing");
    bytes32 internal constant FEATURE = keccak256("geo:north-africa");

    function setUp() public {
        skills = new SkillDefinitionRegistry();
        geo = new GeoFeatureRegistry();
        steward = vm.addr(STEWARD_PK);
        other = vm.addr(OTHER_PK);
    }

    // ─── SkillDefinitionRegistry ────────────────────────────────────────

    function _publishSkill(bytes32 root) internal returns (uint64) {
        SkillDefinitionRegistry.PublishInput memory p = SkillDefinitionRegistry.PublishInput({
            skillId: SKILL,
            skillKind: skills.KIND_LEAF(),
            stewardAccount: steward,
            conceptHash: keccak256("Grant Writing"),
            ontologyMerkleRoot: root,
            metadataURI: "ipfs://skill/grant-writing",
            validAfter: 0,
            validUntil: 0
        });
        vm.prank(steward);
        return skills.publish(p);
    }

    function test_skill_publish_v1_then_v2_chainsPredecessor() public {
        assertEq(_publishSkill(keccak256("root-v1")), 1);
        assertEq(_publishSkill(keccak256("root-v2")), 2);
        assertEq(skills.latestVersion(SKILL), 2);
        SkillDefinitionRegistry.SkillRecord memory r2 = skills.getSkill(SKILL, 2);
        assertEq(r2.predecessorRoot, keccak256("root-v1"));
        assertTrue(r2.active);
        assertTrue(skills.exists(SKILL, 1) && skills.exists(SKILL, 2));
    }

    function test_skill_publish_nonSteward_reverts() public {
        SkillDefinitionRegistry.PublishInput memory p = SkillDefinitionRegistry.PublishInput({
            skillId: SKILL, skillKind: skills.KIND_LEAF(), stewardAccount: steward,
            conceptHash: keccak256("x"), ontologyMerkleRoot: 0, metadataURI: "ipfs://x", validAfter: 0, validUntil: 0
        });
        vm.prank(other);
        vm.expectRevert(SkillDefinitionRegistry.NotSteward.selector);
        skills.publish(p);
    }

    function test_skill_publish_v2_differentSteward_reverts() public {
        _publishSkill(keccak256("root-v1"));
        SkillDefinitionRegistry.PublishInput memory p = SkillDefinitionRegistry.PublishInput({
            skillId: SKILL, skillKind: skills.KIND_LEAF(), stewardAccount: other,
            conceptHash: keccak256("x"), ontologyMerkleRoot: 0, metadataURI: "ipfs://x", validAfter: 0, validUntil: 0
        });
        vm.prank(other);
        vm.expectRevert(SkillDefinitionRegistry.NotSteward.selector);
        skills.publish(p);
    }

    function test_skill_emptyMetadata_reverts() public {
        SkillDefinitionRegistry.PublishInput memory p = SkillDefinitionRegistry.PublishInput({
            skillId: SKILL, skillKind: skills.KIND_LEAF(), stewardAccount: steward,
            conceptHash: keccak256("x"), ontologyMerkleRoot: 0, metadataURI: "", validAfter: 0, validUntil: 0
        });
        vm.prank(steward);
        vm.expectRevert(SkillDefinitionRegistry.EmptyMetadata.selector);
        skills.publish(p);
    }

    function test_skill_deactivate_preservesHistory() public {
        _publishSkill(keccak256("root-v1"));
        vm.prank(steward);
        skills.deactivate(SKILL);
        assertFalse(skills.getLatest(SKILL).active);
        assertTrue(skills.exists(SKILL, 1));
    }

    function test_skill_setValidity() public {
        _publishSkill(keccak256("root-v1"));
        vm.prank(steward);
        skills.setValidity(SKILL, 1, 100, 200);
        SkillDefinitionRegistry.SkillRecord memory r = skills.getSkill(SKILL, 1);
        assertEq(r.validAfter, 100);
        assertEq(r.validUntil, 200);
    }

    // ─── GeoFeatureRegistry ─────────────────────────────────────────────

    function _publishFeature() internal returns (uint64) {
        GeoFeatureRegistry.PublishInput memory p = GeoFeatureRegistry.PublishInput({
            featureId: FEATURE,
            featureKind: geo.KIND_REGION(),
            stewardAccount: steward,
            geometryHash: keccak256("geojson-na"),
            coverageRoot: keccak256("h3-na"),
            sourceSetRoot: keccak256("src-na"),
            metadataURI: "ipfs://geo/north-africa",
            centroidLat: int256(28) * geo.COORD_SCALE(),
            centroidLon: int256(10) * geo.COORD_SCALE(),
            bboxMinLat: 0,
            bboxMinLon: 0,
            bboxMaxLat: int256(37) * geo.COORD_SCALE(),
            bboxMaxLon: int256(25) * geo.COORD_SCALE(),
            validAfter: 0,
            validUntil: 0
        });
        vm.prank(steward);
        return geo.publish(p);
    }

    function test_geo_publish_versions_offChainGeometry() public {
        assertEq(_publishFeature(), 1);
        assertEq(_publishFeature(), 2); // boundary refresh → new version
        assertEq(geo.latestVersion(FEATURE), 2);
        GeoFeatureRegistry.FeatureRecord memory r = geo.getLatest(FEATURE);
        assertEq(r.geometryHash, keccak256("geojson-na")); // only the HASH on chain
        assertEq(r.centroidLat, int256(28) * geo.COORD_SCALE());
        assertTrue(r.active);
        assertTrue(geo.exists(FEATURE, 1));
    }

    function test_geo_publish_nonSteward_reverts() public {
        GeoFeatureRegistry.PublishInput memory p;
        p.featureId = FEATURE;
        p.featureKind = geo.KIND_REGION();
        p.stewardAccount = steward;
        p.metadataURI = "ipfs://x";
        vm.prank(other);
        vm.expectRevert(GeoFeatureRegistry.NotSteward.selector);
        geo.publish(p);
    }

    function test_geo_deactivate_and_validity() public {
        _publishFeature();
        vm.prank(steward);
        geo.deactivate(FEATURE);
        assertFalse(geo.getLatest(FEATURE).active);
        vm.prank(steward);
        geo.setValidity(FEATURE, 1, 5, 9);
        assertEq(geo.getFeature(FEATURE, 1).validUntil, 9);
    }

    function test_geo_unknownFeature_reverts() public {
        vm.expectRevert(GeoFeatureRegistry.FeatureNotFound.selector);
        geo.getLatest(FEATURE);
    }

    // ─── geo revert-branch coverage (mirrors the skill cases; R12 floor) ───

    function test_geo_emptyId_reverts() public {
        GeoFeatureRegistry.PublishInput memory p;
        p.featureKind = geo.KIND_REGION();
        p.stewardAccount = steward;
        p.metadataURI = "ipfs://x"; // featureId left 0x0
        vm.prank(steward);
        vm.expectRevert(GeoFeatureRegistry.EmptyId.selector);
        geo.publish(p);
    }

    function test_geo_emptyMetadata_reverts() public {
        GeoFeatureRegistry.PublishInput memory p;
        p.featureId = FEATURE;
        p.featureKind = geo.KIND_REGION();
        p.stewardAccount = steward; // metadataURI left ""
        vm.prank(steward);
        vm.expectRevert(GeoFeatureRegistry.EmptyMetadata.selector);
        geo.publish(p);
    }

    function test_geo_publish_v2_differentSteward_reverts() public {
        _publishFeature(); // v1 by `steward`
        GeoFeatureRegistry.PublishInput memory p;
        p.featureId = FEATURE;
        p.featureKind = geo.KIND_REGION();
        p.stewardAccount = other;
        p.metadataURI = "ipfs://x";
        vm.prank(other);
        vm.expectRevert(GeoFeatureRegistry.NotSteward.selector);
        geo.publish(p);
    }

    function test_geo_deactivate_unknown_reverts() public {
        vm.expectRevert(GeoFeatureRegistry.FeatureNotFound.selector);
        geo.deactivate(FEATURE);
    }

    function test_geo_deactivate_nonSteward_reverts() public {
        _publishFeature();
        vm.prank(other);
        vm.expectRevert(GeoFeatureRegistry.NotSteward.selector);
        geo.deactivate(FEATURE);
    }

    function test_geo_setValidity_unknown_reverts() public {
        vm.expectRevert(GeoFeatureRegistry.FeatureNotFound.selector);
        geo.setValidity(FEATURE, 1, 0, 0);
    }

    function test_geo_setValidity_nonSteward_reverts() public {
        _publishFeature();
        vm.prank(other);
        vm.expectRevert(GeoFeatureRegistry.NotSteward.selector);
        geo.setValidity(FEATURE, 1, 0, 0);
    }

    function test_geo_getFeature_unknown_reverts() public {
        vm.expectRevert(GeoFeatureRegistry.FeatureNotFound.selector);
        geo.getFeature(FEATURE, 1);
    }
}
