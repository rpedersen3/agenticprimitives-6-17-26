// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title GeoFeatureRegistry
 * @notice Versioned PUBLIC geo features — the definition layer of the
 *         definition-vs-claim model (spec 251). Exact geometry stays OFF chain
 *         behind `metadataURI`; on chain we anchor a `geometryHash`, coverage +
 *         source merkle roots, and a COARSE centroid/bbox (UI only).
 *
 *   ─── Doctrine ───
 *
 * GFR-01 Keyed by Smart Agent ADDRESS (the `stewardAccount`); names are never
 *        authority (ADR-0010).
 * GFR-02 Authorization is `msg.sender == stewardAccount` — the steward SA
 *        publishes through its own `execute()` path. NO `isOwner` staticcall.
 * GFR-03 Monotonic per-`featureId` versioning; a boundary refresh is a new
 *        version (claims pin a version, so they don't retroactively re-target).
 * GFR-04 `featureKind` is a C-box-anchored codelist value (ADR-0009 lockstep).
 * GFR-05 Geo CLAIMS are NOT on chain — they are verifiable credentials that
 *        point to a `(featureId, version)` here (spec 251). No GeoClaimRegistry.
 * GFR-06 NO domain/faith vocabulary (reusable substrate).
 * GFR-07 NEUTRAL public geography ONLY. A feature is a generic public place
 *        (planet/region/country/admin area). It is NEVER tagged with — and its
 *        `metadataURI` NEVER carries — domain or operational data that could
 *        imply a private presence (e.g. "where a worker operates", access
 *        sensitivity, ministry context). Sensitivity classification is an
 *        OFF-chain app/domain policy applied OVER neutral features, never an
 *        on-chain feature attribute. All metadata MUST be sanitized.
 * GFR-08 NO on-chain skill↔geo mapping. This registry holds geo features only
 *        and has ZERO reference to SkillDefinitionRegistry (or any skill id).
 *        Any "serves skill X in region Y" fact is an off-chain claim/credential.
 *
 * Ported from smart-agent `GeoFeatureRegistry`; diverges per spec 251 (AP auth,
 * C-box-anchored kinds, no name binding in v1).
 */
contract GeoFeatureRegistry {
    // ─── C-box feature-kind codelist (keccak of the cbox URIs) ──────────
    bytes32 public constant KIND_PLANET = keccak256(bytes("https://ontology.agenticprimitives.dev/cbox/geo-kind#Planet"));
    bytes32 public constant KIND_REGION = keccak256(bytes("https://ontology.agenticprimitives.dev/cbox/geo-kind#Region"));
    bytes32 public constant KIND_COUNTRY = keccak256(bytes("https://ontology.agenticprimitives.dev/cbox/geo-kind#Country"));
    bytes32 public constant KIND_ADMIN = keccak256(bytes("https://ontology.agenticprimitives.dev/cbox/geo-kind#AdminArea"));
    bytes32 public constant KIND_CUSTOM = keccak256(bytes("https://ontology.agenticprimitives.dev/cbox/geo-kind#Custom"));
    int256 public constant COORD_SCALE = 1e7;

    // ─── Errors ─────────────────────────────────────────────────────────
    error NotSteward();
    error FeatureNotFound();
    error EmptyMetadata();
    error EmptyId();

    // ─── Storage ────────────────────────────────────────────────────────
    struct FeatureRecord {
        bytes32 featureId;
        uint64 version;
        address stewardAccount;
        bytes32 featureKind;
        bytes32 geometryHash; // keccak of canonical GeoJSON (off chain)
        bytes32 coverageRoot; // merkle root over covering cells (e.g. H3)
        bytes32 sourceSetRoot; // merkle root over the source dataset
        string metadataURI;
        int256 centroidLat; // degrees × 1e7, coarse — UI only
        int256 centroidLon;
        int256 bboxMinLat;
        int256 bboxMinLon;
        int256 bboxMaxLat;
        int256 bboxMaxLon;
        uint64 validAfter;
        uint64 validUntil;
        bool active;
        uint64 registeredAt;
    }

    mapping(bytes32 => mapping(uint64 => FeatureRecord)) private _records;
    mapping(bytes32 => uint64) public latestVersion;
    bytes32[] private _allFeatures;

    // ─── Events ─────────────────────────────────────────────────────────
    event FeaturePublished(
        bytes32 indexed featureId,
        uint64 indexed version,
        address indexed steward,
        bytes32 featureKind,
        bytes32 geometryHash,
        bytes32 coverageRoot,
        bytes32 sourceSetRoot,
        string metadataURI
    );
    event FeatureDeactivated(bytes32 indexed featureId, uint64 version);
    event FeatureValidityChanged(bytes32 indexed featureId, uint64 version, uint64 validAfter, uint64 validUntil);

    // ─── Publish ────────────────────────────────────────────────────────
    struct PublishInput {
        bytes32 featureId;
        bytes32 featureKind;
        address stewardAccount;
        bytes32 geometryHash;
        bytes32 coverageRoot;
        bytes32 sourceSetRoot;
        string metadataURI;
        int256 centroidLat;
        int256 centroidLon;
        int256 bboxMinLat;
        int256 bboxMinLon;
        int256 bboxMaxLat;
        int256 bboxMaxLon;
        uint64 validAfter;
        uint64 validUntil;
    }

    function publish(PublishInput calldata p) external returns (uint64 version) {
        if (p.featureId == bytes32(0)) revert EmptyId();
        if (bytes(p.metadataURI).length == 0) revert EmptyMetadata();
        if (msg.sender != p.stewardAccount) revert NotSteward();

        uint64 prevVer = latestVersion[p.featureId];
        if (prevVer != 0 && _records[p.featureId][prevVer].stewardAccount != p.stewardAccount) {
            revert NotSteward();
        }

        version = prevVer + 1;
        _records[p.featureId][version] = FeatureRecord({
            featureId: p.featureId,
            version: version,
            stewardAccount: p.stewardAccount,
            featureKind: p.featureKind,
            geometryHash: p.geometryHash,
            coverageRoot: p.coverageRoot,
            sourceSetRoot: p.sourceSetRoot,
            metadataURI: p.metadataURI,
            centroidLat: p.centroidLat,
            centroidLon: p.centroidLon,
            bboxMinLat: p.bboxMinLat,
            bboxMinLon: p.bboxMinLon,
            bboxMaxLat: p.bboxMaxLat,
            bboxMaxLon: p.bboxMaxLon,
            validAfter: p.validAfter,
            validUntil: p.validUntil,
            active: true,
            registeredAt: uint64(block.timestamp)
        });
        latestVersion[p.featureId] = version;
        if (prevVer == 0) _allFeatures.push(p.featureId);

        emit FeaturePublished(p.featureId, version, p.stewardAccount, p.featureKind, p.geometryHash, p.coverageRoot, p.sourceSetRoot, p.metadataURI);
    }

    function deactivate(bytes32 featureId) external {
        uint64 v = latestVersion[featureId];
        if (v == 0) revert FeatureNotFound();
        FeatureRecord storage r = _records[featureId][v];
        if (msg.sender != r.stewardAccount) revert NotSteward();
        r.active = false;
        emit FeatureDeactivated(featureId, v);
    }

    function setValidity(bytes32 featureId, uint64 version, uint64 validAfter, uint64 validUntil) external {
        FeatureRecord storage r = _records[featureId][version];
        if (r.version == 0) revert FeatureNotFound();
        if (msg.sender != r.stewardAccount) revert NotSteward();
        r.validAfter = validAfter;
        r.validUntil = validUntil;
        emit FeatureValidityChanged(featureId, version, validAfter, validUntil);
    }

    // ─── Views ──────────────────────────────────────────────────────────
    function getFeature(bytes32 featureId, uint64 version) external view returns (FeatureRecord memory) {
        FeatureRecord memory r = _records[featureId][version];
        if (r.version == 0) revert FeatureNotFound();
        return r;
    }

    function getLatest(bytes32 featureId) external view returns (FeatureRecord memory) {
        uint64 v = latestVersion[featureId];
        if (v == 0) revert FeatureNotFound();
        return _records[featureId][v];
    }

    /// @notice True if `version` of `featureId` exists (used by off-chain geo claim credentials to
    ///         confirm the pinned definition version they reference).
    function exists(bytes32 featureId, uint64 version) external view returns (bool) {
        return _records[featureId][version].version != 0;
    }

    function allFeatures() external view returns (bytes32[] memory) {
        return _allFeatures;
    }
}
