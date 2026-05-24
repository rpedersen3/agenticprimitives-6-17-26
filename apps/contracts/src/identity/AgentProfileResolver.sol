// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ontology/AttributeStorage.sol";
import "./AgentProfilePredicates.sol";

/**
 * @title AgentProfileResolver
 * @notice Per-agent profile resolver. Inherits the shared
 *         AttributeStorage so writes are predicate-active-checked
 *         against the OntologyTermRegistry deployed in NS Phase 3.
 *
 * Subject encoding: `bytes32(uint256(uint160(agent)))`. This places
 * the agent's address in the low 20 bytes of the bytes32 subject id
 * — same convention smart-agent uses, lets the SDK convert
 * mechanically between `address` and `subject` without lookup.
 *
 * Authorization: `msg.sender == agent`. The agent's Smart Agent
 * executes through its CustodyPolicy gate, then calls into this
 * contract — `msg.sender` here equals the agent. No isOwner fallback
 * (our AgentAccount has no built-in owner registry; quorum belongs
 * in the CustodyPolicy module).
 *
 * Adapted from smart-agent
 * (`packages/contracts/src/AgentAccountResolver.sol`, 274 LOC) with
 * the following simplifications per spec 217 § Phase 3 + ADR-0007:
 *
 *   - Single auth path (`msg.sender == agent`) — no isOwner staticcall.
 *   - Profile shape (`atl:AgentProfile`) defined in ShapeRegistry,
 *     not via a hand-written `CoreRecord` struct here.
 *   - Off-chain `AgentCard` JSON is the source of truth; this
 *     resolver stores the content-hash anchor + typed metadata only.
 */
contract AgentProfileResolver is AttributeStorage {
    address[] private _agents;
    mapping(address => bool) private _registered;

    event AgentRegistered(address indexed agent, string displayName, bytes32 indexed agentKind);
    event MetadataUpdated(address indexed agent, string metadataURI, bytes32 metadataHash);
    event PropertySet(address indexed agent, bytes32 indexed predicate);

    error NotAgentOwner();
    error AlreadyRegistered();
    error NotRegistered();

    /// @notice `msg.sender == agent` (the canonical path). For any
    ///         other principal, callers must route through their own
    ///         CustodyPolicy / AgentAccount execute path.
    modifier onlyAgent(address agent) {
        if (msg.sender != agent) revert NotAgentOwner();
        _;
    }

    modifier onlyRegistered(address agent) {
        if (!_registered[agent]) revert NotRegistered();
        _;
    }

    constructor(address ontologyRegistry) AttributeStorage(ontologyRegistry) {}

    function _subject(address agent) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(agent)));
    }

    // ─── Registration ───────────────────────────────────────────────

    /**
     * @notice One-time profile registration for a Smart Agent. The
     *         agent calls this on itself (`msg.sender == agent`).
     *         Subsequent edits go through the typed setters below.
     */
    function register(
        address agent,
        string calldata displayName,
        string calldata description,
        bytes32 agentKind,
        string calldata profileSchemaURI
    ) external onlyAgent(agent) {
        if (_registered[agent]) revert AlreadyRegistered();
        bytes32 s = _subject(agent);
        _setString(s, AgentProfilePredicates.ATL_DISPLAY_NAME, displayName);
        if (bytes(description).length > 0) {
            _setString(s, AgentProfilePredicates.ATL_DESCRIPTION, description);
        }
        if (agentKind != bytes32(0)) {
            _setBytes32(s, AgentProfilePredicates.ATL_AGENT_KIND, agentKind);
        }
        if (bytes(profileSchemaURI).length > 0) {
            _setString(s, AgentProfilePredicates.ATL_PROFILE_SCHEMA_URI, profileSchemaURI);
        }
        _setBool(s, AgentProfilePredicates.ATL_PROFILE_ACTIVE, true);
        _setUint(s, AgentProfilePredicates.ATL_PROFILE_REGISTERED_AT, block.timestamp);
        _registered[agent] = true;
        _agents.push(agent);
        emit AgentRegistered(agent, displayName, agentKind);
    }

    // ─── Typed setters ──────────────────────────────────────────────

    function setMetadata(
        address agent,
        string calldata metadataURI,
        bytes32 metadataHash
    ) external onlyAgent(agent) onlyRegistered(agent) {
        bytes32 s = _subject(agent);
        _setString(s, AgentProfilePredicates.ATL_METADATA_URI, metadataURI);
        _setBytes32(s, AgentProfilePredicates.ATL_METADATA_HASH, metadataHash);
        emit MetadataUpdated(agent, metadataURI, metadataHash);
    }

    function setStringProperty(address agent, bytes32 predicate, string calldata value)
        external onlyAgent(agent) onlyRegistered(agent)
    {
        _setString(_subject(agent), predicate, value);
        emit PropertySet(agent, predicate);
    }

    function setAddressProperty(address agent, bytes32 predicate, address value)
        external onlyAgent(agent) onlyRegistered(agent)
    {
        _setAddress(_subject(agent), predicate, value);
        emit PropertySet(agent, predicate);
    }

    function setBoolProperty(address agent, bytes32 predicate, bool value)
        external onlyAgent(agent) onlyRegistered(agent)
    {
        _setBool(_subject(agent), predicate, value);
        emit PropertySet(agent, predicate);
    }

    function setBytes32Property(address agent, bytes32 predicate, bytes32 value)
        external onlyAgent(agent) onlyRegistered(agent)
    {
        _setBytes32(_subject(agent), predicate, value);
        emit PropertySet(agent, predicate);
    }

    function setUintProperty(address agent, bytes32 predicate, uint256 value)
        external onlyAgent(agent) onlyRegistered(agent)
    {
        _setUint(_subject(agent), predicate, value);
        emit PropertySet(agent, predicate);
    }

    function setActive(address agent, bool active)
        external onlyAgent(agent) onlyRegistered(agent)
    {
        _setBool(_subject(agent), AgentProfilePredicates.ATL_PROFILE_ACTIVE, active);
        emit PropertySet(agent, AgentProfilePredicates.ATL_PROFILE_ACTIVE);
    }

    // ─── Convenience readers ────────────────────────────────────────

    function isRegistered(address agent) external view returns (bool) {
        return _registered[agent];
    }

    function getStringProperty(address agent, bytes32 predicate) external view returns (string memory) {
        return this.getString(_subject(agent), predicate);
    }

    function getAddressProperty(address agent, bytes32 predicate) external view returns (address) {
        return this.getAddress(_subject(agent), predicate);
    }

    function getBoolProperty(address agent, bytes32 predicate) external view returns (bool) {
        return this.getBool(_subject(agent), predicate);
    }

    function getBytes32Property(address agent, bytes32 predicate) external view returns (bytes32) {
        return this.getBytes32(_subject(agent), predicate);
    }

    function getUintProperty(address agent, bytes32 predicate) external view returns (uint256) {
        return this.getUint(_subject(agent), predicate);
    }

    function getPredicateKeys(address agent) external view returns (bytes32[] memory) {
        return this.predicatesOf(_subject(agent));
    }

    function agentCount() external view returns (uint256) {
        return _agents.length;
    }

    function getAllAgents() external view returns (address[] memory) {
        return _agents;
    }

    function subjectFor(address agent) external pure returns (bytes32) {
        return bytes32(uint256(uint160(agent)));
    }
}
