// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title SkillDefinitionRegistry
 * @notice Versioned PUBLIC skill definitions — the definition layer of the
 *         definition-vs-claim model (spec 251). Small, stable, public, indexable
 *         anchors only: id, version, steward, kind, content hashes, metadata URI,
 *         validity. The full SKOS expansion + taxonomy live OFF chain behind
 *         `metadataURI` + `ontologyMerkleRoot`.
 *
 *   ─── Doctrine ───
 *
 * SDR-01 Keyed by Smart Agent ADDRESS (the `stewardAccount`); names are never
 *        authority (ADR-0010).
 * SDR-02 Authorization is `msg.sender == stewardAccount` — the steward SA
 *        publishes through its own `execute()` path. NO `isOwner(address)`
 *        staticcall fallback (AP diverges from smart-agent; see AgentRelationship).
 * SDR-03 Monotonic per-`skillId` versioning; each version chains the prior
 *        version's `ontologyMerkleRoot` as `predecessorRoot` (auditable taxonomy
 *        refresh). A skill is never deleted; `deactivate` flips `active`.
 * SDR-04 `skillKind` is a C-box-anchored codelist value: `keccak256(<cbox URI>)`,
 *        gate-checked against `packages/ontology` (ADR-0009 lockstep).
 * SDR-05 NO domain/faith vocabulary. This is reusable substrate (spec 251
 *        "People groups are excluded").
 * SDR-06 SANITIZED metadata only. `metadataURI` + `conceptHash` carry NEUTRAL,
 *        public, non-operational skill vocabulary — never anything that implies
 *        private operational data about who holds the skill or where it is used.
 *        The agent↔skill association is an OFF-chain vault credential (spec 251).
 * SDR-07 NO on-chain skill↔geo mapping. This registry holds skills only and has
 *        ZERO reference to GeoFeatureRegistry (or any geo id). A "skill X in
 *        region Y" co-occurrence is an off-chain claim/credential, never an
 *        on-chain link between the two definition registries.
 *
 * Ported from smart-agent `SkillDefinitionRegistry`; diverges per spec 251 (AP
 * auth model, C-box-anchored kinds, no `.skill` name binding in v1).
 */
contract SkillDefinitionRegistry {
    // ─── C-box skill-kind codelist (keccak of the cbox vocabulary URIs) ──
    string internal constant KIND_NS = "https://ontology.agenticprimitives.dev/cbox/skill-kind#";
    /// @dev A leaf skill in a controlled taxonomy (e.g. an OASF leaf).
    bytes32 public constant KIND_LEAF = keccak256(bytes("https://ontology.agenticprimitives.dev/cbox/skill-kind#Leaf"));
    /// @dev A domain/grouping concept (a non-leaf category).
    bytes32 public constant KIND_DOMAIN = keccak256(bytes("https://ontology.agenticprimitives.dev/cbox/skill-kind#Domain"));
    /// @dev A steward-defined custom skill outside the controlled set.
    bytes32 public constant KIND_CUSTOM = keccak256(bytes("https://ontology.agenticprimitives.dev/cbox/skill-kind#Custom"));

    // ─── Errors ─────────────────────────────────────────────────────────
    error NotSteward();
    error SkillNotFound();
    error EmptyMetadata();
    error EmptyId();

    // ─── Storage ────────────────────────────────────────────────────────
    struct SkillRecord {
        bytes32 skillId; // stable id across versions
        uint64 version; // monotonic per skillId (1-based; 0 = absent)
        address stewardAccount; // governing steward SA
        bytes32 skillKind; // C-box kind codelist value
        bytes32 conceptHash; // keccak of canonical SKOS prefLabel + ancestors
        bytes32 ontologyMerkleRoot; // anchors the RDF/SKOS expansion (off chain)
        bytes32 predecessorRoot; // prior version's ontologyMerkleRoot (0 for v1)
        string metadataURI; // ipfs://… or https://… JSON-LD blob
        uint64 validAfter; // 0 = since inception
        uint64 validUntil; // 0 = indefinite
        bool active;
        uint64 registeredAt;
    }

    /// @dev skillId => version => record.
    mapping(bytes32 => mapping(uint64 => SkillRecord)) private _records;
    /// @dev skillId => latest version (0 = unknown).
    mapping(bytes32 => uint64) public latestVersion;
    bytes32[] private _allSkills;

    // ─── Events ─────────────────────────────────────────────────────────
    event SkillPublished(
        bytes32 indexed skillId,
        uint64 indexed version,
        address indexed steward,
        bytes32 skillKind,
        bytes32 conceptHash,
        bytes32 ontologyMerkleRoot,
        bytes32 predecessorRoot,
        string metadataURI
    );
    event SkillDeactivated(bytes32 indexed skillId, uint64 version);
    event SkillValidityChanged(bytes32 indexed skillId, uint64 version, uint64 validAfter, uint64 validUntil);

    // ─── Publish ────────────────────────────────────────────────────────
    struct PublishInput {
        bytes32 skillId;
        bytes32 skillKind;
        address stewardAccount;
        bytes32 conceptHash;
        bytes32 ontologyMerkleRoot;
        string metadataURI;
        uint64 validAfter;
        uint64 validUntil;
    }

    /// @notice Publish a new skill definition, or a new version of an existing one.
    function publish(PublishInput calldata p) external returns (uint64 version) {
        if (p.skillId == bytes32(0)) revert EmptyId();
        if (bytes(p.metadataURI).length == 0) revert EmptyMetadata();
        // SDR-02 — only the steward SA, acting through its own execute() path.
        if (msg.sender != p.stewardAccount) revert NotSteward();

        uint64 prevVer = latestVersion[p.skillId];
        if (prevVer != 0 && _records[p.skillId][prevVer].stewardAccount != p.stewardAccount) {
            // SDR-03 — a new version must come from the SAME steward.
            revert NotSteward();
        }

        version = prevVer + 1;
        bytes32 predecessorRoot = prevVer == 0 ? bytes32(0) : _records[p.skillId][prevVer].ontologyMerkleRoot;

        _records[p.skillId][version] = SkillRecord({
            skillId: p.skillId,
            version: version,
            stewardAccount: p.stewardAccount,
            skillKind: p.skillKind,
            conceptHash: p.conceptHash,
            ontologyMerkleRoot: p.ontologyMerkleRoot,
            predecessorRoot: predecessorRoot,
            metadataURI: p.metadataURI,
            validAfter: p.validAfter,
            validUntil: p.validUntil,
            active: true,
            registeredAt: uint64(block.timestamp)
        });
        latestVersion[p.skillId] = version;
        if (prevVer == 0) _allSkills.push(p.skillId);

        emit SkillPublished(p.skillId, version, p.stewardAccount, p.skillKind, p.conceptHash, p.ontologyMerkleRoot, predecessorRoot, p.metadataURI);
    }

    /// @notice Deactivate the latest version (history is preserved).
    function deactivate(bytes32 skillId) external {
        uint64 v = latestVersion[skillId];
        if (v == 0) revert SkillNotFound();
        SkillRecord storage r = _records[skillId][v];
        if (msg.sender != r.stewardAccount) revert NotSteward();
        r.active = false;
        emit SkillDeactivated(skillId, v);
    }

    /// @notice Update the validity window of a published version.
    function setValidity(bytes32 skillId, uint64 version, uint64 validAfter, uint64 validUntil) external {
        SkillRecord storage r = _records[skillId][version];
        if (r.version == 0) revert SkillNotFound();
        if (msg.sender != r.stewardAccount) revert NotSteward();
        r.validAfter = validAfter;
        r.validUntil = validUntil;
        emit SkillValidityChanged(skillId, version, validAfter, validUntil);
    }

    // ─── Views ──────────────────────────────────────────────────────────
    function getSkill(bytes32 skillId, uint64 version) external view returns (SkillRecord memory) {
        SkillRecord memory r = _records[skillId][version];
        if (r.version == 0) revert SkillNotFound();
        return r;
    }

    function getLatest(bytes32 skillId) external view returns (SkillRecord memory) {
        uint64 v = latestVersion[skillId];
        if (v == 0) revert SkillNotFound();
        return _records[skillId][v];
    }

    /// @notice True if `version` of `skillId` exists (used by the claim registry to pin a version).
    function exists(bytes32 skillId, uint64 version) external view returns (bool) {
        return _records[skillId][version].version != 0;
    }

    function allSkills() external view returns (bytes32[] memory) {
        return _allSkills;
    }
}
