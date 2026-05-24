// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title OntologyTermRegistry
 * @notice Governed registry of valid ontology predicates for the
 *         agenticprimitives trust fabric.
 *
 * Controls which predicate bytes32 ids may appear on any
 * `AttributeStorage` subclass (naming records, future relationships /
 * identity records). Each term maps a `bytes32` id (keccak256 of a
 * CURIE like `"atl:displayName"`) to its full URI, human label, and
 * expected datatype family.
 *
 * Governance: only `governor` may register or deactivate terms.
 * Deployer is the bootstrap governor; rotation to a multi-sig /
 * Smart Agent CustodyPolicy is a single `transferGovernor` call.
 *
 * Adapted from smart-agent
 * (`packages/contracts/src/OntologyTermRegistry.sol`, 136 LOC) —
 * structurally identical; copied here to keep the agenticprimitives
 * trust fabric self-contained.
 */
contract OntologyTermRegistry {
    struct Term {
        bytes32 id;          // keccak256("atl:displayName")
        string curie;        // "atl:displayName"
        string uri;          // "https://agentictrust.io/ontology/core#displayName"
        string label;        // "Display Name"
        string datatype;     // "string" | "address" | "bool" | "uint256" | "bytes32" | "string[]" | "address[]" | "bytes32[]"
        bool active;
        uint256 registeredAt;
    }

    address public governor;
    mapping(bytes32 => Term) private _terms;
    bytes32[] private _termIds;

    event TermRegistered(bytes32 indexed id, string curie, string uri);
    event TermDeactivated(bytes32 indexed id);
    event TermActivated(bytes32 indexed id);
    event GovernorTransferred(address indexed oldGovernor, address indexed newGovernor);

    error NotGovernor();
    error TermExists();
    error TermNotFound();
    error ZeroGovernor();

    modifier onlyGovernor() {
        if (msg.sender != governor) revert NotGovernor();
        _;
    }

    constructor(address governor_) {
        if (governor_ == address(0)) revert ZeroGovernor();
        governor = governor_;
    }

    function transferGovernor(address newGovernor) external onlyGovernor {
        if (newGovernor == address(0)) revert ZeroGovernor();
        emit GovernorTransferred(governor, newGovernor);
        governor = newGovernor;
    }

    function registerTerm(
        bytes32 id,
        string calldata curie,
        string calldata uri,
        string calldata label,
        string calldata datatype
    ) external onlyGovernor {
        if (_terms[id].registeredAt != 0) revert TermExists();
        _terms[id] = Term({
            id: id,
            curie: curie,
            uri: uri,
            label: label,
            datatype: datatype,
            active: true,
            registeredAt: block.timestamp
        });
        _termIds.push(id);
        emit TermRegistered(id, curie, uri);
    }

    function registerTermBatch(
        bytes32[] calldata ids,
        string[] calldata curies,
        string[] calldata uris,
        string[] calldata labels,
        string[] calldata datatypes
    ) external onlyGovernor {
        for (uint256 i = 0; i < ids.length; i++) {
            if (_terms[ids[i]].registeredAt != 0) continue; // skip existing
            _terms[ids[i]] = Term({
                id: ids[i],
                curie: curies[i],
                uri: uris[i],
                label: labels[i],
                datatype: datatypes[i],
                active: true,
                registeredAt: block.timestamp
            });
            _termIds.push(ids[i]);
            emit TermRegistered(ids[i], curies[i], uris[i]);
        }
    }

    function deactivateTerm(bytes32 id) external onlyGovernor {
        if (_terms[id].registeredAt == 0) revert TermNotFound();
        _terms[id].active = false;
        emit TermDeactivated(id);
    }

    function activateTerm(bytes32 id) external onlyGovernor {
        if (_terms[id].registeredAt == 0) revert TermNotFound();
        _terms[id].active = true;
        emit TermActivated(id);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getTerm(bytes32 id) external view returns (Term memory) {
        return _terms[id];
    }

    function isRegistered(bytes32 id) external view returns (bool) {
        return _terms[id].registeredAt != 0;
    }

    function isActive(bytes32 id) external view returns (bool) {
        return _terms[id].active;
    }

    function termCount() external view returns (uint256) {
        return _termIds.length;
    }

    function getTermAt(uint256 index) external view returns (Term memory) {
        return _terms[_termIds[index]];
    }

    function getAllTermIds() external view returns (bytes32[] memory) {
        return _termIds;
    }
}
