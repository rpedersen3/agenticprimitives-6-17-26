// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentNameRegistry.sol";
import "../ontology/AttributeStorage.sol";

/**
 * @title AgentNameAttributeResolver
 * @notice Per-node records resolver for the agent-naming registry.
 *
 * Inherits `AttributeStorage` so every (node, predicate) write is
 * validated against the bound `OntologyTermRegistry` — predicates MUST
 * be registered + active before they can be stored. The subject is the
 * namehash node (already `bytes32`, no conversion). The on-chain
 * `AgentName` shape (defined in `ShapeRegistry`) governs which
 * predicates / datatypes / cardinalities are well-formed for a name.
 *
 * Authorization: `msg.sender == REGISTRY.owner(node)`. The owner Smart
 * Agent's CustodyPolicy module gates the call upstream — this contract
 * trusts `msg.sender` to be the gated entity per spec 215 § Phase 3.
 *
 * Per-spec simplifications kept from the pure key/value port:
 *   - No multi-coin (ENSIP-9) address records. Other-chain identifiers
 *     ride on the `atl:nativeId` predicate (a CAIP-10 string).
 *   - No aliases, versioning, or operator approvals. Rotation flows
 *     through the registry's `setOwner` (which changes who may write).
 *
 * SDK contract: `agenticprimitives/agent-naming/records` exposes
 * the same predicate ids and routes encode / decode through the typed
 * setters here. See `AgentNamePredicates.sol` for the canonical set.
 */
contract AgentNameAttributeResolver is AttributeStorage {
    AgentNameRegistry public immutable REGISTRY;

    error NotAuthorized();
    error NodeNotFound();

    constructor(AgentNameRegistry registry, address ontology) AttributeStorage(ontology) {
        REGISTRY = registry;
    }

    // ─── Typed setters (predicate-active checked + owner-only) ──────

    function setStringAttribute(bytes32 node, bytes32 predicate, string calldata value) external {
        _requireAuth(node);
        _setString(node, predicate, value);
    }

    function setAddressAttribute(bytes32 node, bytes32 predicate, address value) external {
        _requireAuth(node);
        _setAddress(node, predicate, value);
    }

    function setBoolAttribute(bytes32 node, bytes32 predicate, bool value) external {
        _requireAuth(node);
        _setBool(node, predicate, value);
    }

    function setUintAttribute(bytes32 node, bytes32 predicate, uint256 value) external {
        _requireAuth(node);
        _setUint(node, predicate, value);
    }

    function setBytes32Attribute(bytes32 node, bytes32 predicate, bytes32 value) external {
        _requireAuth(node);
        _setBytes32(node, predicate, value);
    }

    function setStringArrayAttribute(bytes32 node, bytes32 predicate, string[] calldata values) external {
        _requireAuth(node);
        _setStringArr(node, predicate, values);
    }

    function setAddressArrayAttribute(bytes32 node, bytes32 predicate, address[] calldata values) external {
        _requireAuth(node);
        _setAddressArr(node, predicate, values);
    }

    function setBytes32ArrayAttribute(bytes32 node, bytes32 predicate, bytes32[] calldata values) external {
        _requireAuth(node);
        _setBytes32Arr(node, predicate, values);
    }

    function unsetAttribute(bytes32 node, bytes32 predicate) external {
        _requireAuth(node);
        _unset(node, predicate);
    }

    // ─── Auth ───────────────────────────────────────────────────────

    function _requireAuth(bytes32 node) internal view {
        if (!REGISTRY.recordExists(node)) revert NodeNotFound();
        if (msg.sender != REGISTRY.owner(node)) revert NotAuthorized();
    }
}
