// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AgentRelationship
 * @notice Trust-fabric edge store between Smart Agents.
 *
 * One edge per `(subject, object, relationshipType)` triple.
 * Each edge carries a set of role labels (subject-side + object-side
 * implicit; same bag for now) and a lifecycle status.
 *
 * Lifecycle: `PROPOSED → CONFIRMED → ACTIVE → REVOKED` (matches
 * the TypeScript `EdgeStatus` enum in
 * agenticprimitives/agent-relationships).
 *
 * Adapted from smart-agent
 * (`packages/contracts/src/AgentRelationship.sol`, 392 LOC) with the
 * following simplifications per spec 216 § Phase 3:
 *
 *   - **No baked-in relationship-type / role constants.** The
 *     vocabulary lives in `AgentRelationshipPredicates.sol` (mirrored
 *     by the TS SDK in `agent-relationships/src/constants.ts`), and
 *     type semantics live in `RelationshipTypeRegistry.sol`. Keeps
 *     this contract focused on edge mechanics.
 *
 *   - **No `isOwner(address)` fallback in auth.** Our AgentAccount is
 *     ERC-7579 modular; quorum belongs in the CustodyPolicy module.
 *     Authorization is `msg.sender == subject` (or `object` / the
 *     `createdBy` for read-back), trusting the AgentAccount's execute
 *     path to gate upstream.
 *
 *   - **Add `metadataHash`** field to the edge for off-chain
 *     content-hash anchoring (matches the AgentName resolver pattern).
 *     Off-chain JSON published at `metadataURI` MUST hash to
 *     `metadataHash`; consumers reject mismatched fetches.
 */
contract AgentRelationship {
    enum EdgeStatus {
        NONE,        // 0 — never set (sentinel)
        PROPOSED,    // 1
        CONFIRMED,   // 2
        ACTIVE,      // 3
        REVOKED      // 4
    }

    struct Edge {
        bytes32 edgeId;
        address subject;
        address object_;
        bytes32 relationshipType;
        EdgeStatus status;
        address createdBy;
        uint64 createdAt;
        uint64 updatedAt;
        string metadataURI;
        bytes32 metadataHash;
    }

    // ─── Storage ────────────────────────────────────────────────────

    mapping(bytes32 => Edge) private _edges;
    mapping(bytes32 => bytes32[]) private _roles;                           // edgeId → role[]
    mapping(bytes32 => mapping(bytes32 => bool)) private _hasRole;          // edgeId → role → exists
    mapping(address => bytes32[]) private _edgesBySubject;
    mapping(address => bytes32[]) private _edgesByObject;
    mapping(address => mapping(address => mapping(bytes32 => bytes32))) private _byTriple;

    // ─── Events ─────────────────────────────────────────────────────

    event EdgeProposed(
        bytes32 indexed edgeId,
        address indexed subject,
        address indexed object_,
        bytes32 relationshipType,
        address createdBy
    );
    event EdgeConfirmed(bytes32 indexed edgeId, address indexed confirmedBy);
    event EdgeActivated(bytes32 indexed edgeId, address indexed activatedBy);
    event EdgeRevoked(bytes32 indexed edgeId, address indexed revokedBy);
    event RoleAdded(bytes32 indexed edgeId, bytes32 indexed role, address indexed updater);
    event RoleRemoved(bytes32 indexed edgeId, bytes32 indexed role, address indexed updater);
    event EdgeMetadataUpdated(bytes32 indexed edgeId, string metadataURI, bytes32 metadataHash, address indexed updater);

    // ─── Errors ─────────────────────────────────────────────────────

    error InvalidEdge();
    error EdgeAlreadyExists();
    error EdgeNotFound();
    error RoleAlreadyExists();
    error RoleNotFound();
    error NotAuthorized();
    error InvalidTransition();

    // ─── Edge ID ────────────────────────────────────────────────────

    /**
     * @notice Deterministic edge id =
     *         `keccak256(abi.encodePacked(subject, object, relationshipType))`.
     *         Matches the TS SDK's `computeEdgeId` (lowercased addresses
     *         packed in the same order).
     */
    function computeEdgeId(
        address subject,
        address object_,
        bytes32 relationshipType
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(subject, object_, relationshipType));
    }

    // ─── Propose ────────────────────────────────────────────────────

    /**
     * @notice Propose a new edge. The caller must be the subject's
     *         Smart Agent OR (for relayed flows) any party authorized
     *         to act on its behalf upstream.
     *
     * Phase 3 auth model: `msg.sender` is the proposer (typically the
     * subject's AgentAccount execute path). The contract trusts the
     * caller to be gated upstream; cross-side confirmation is required
     * before the edge becomes ACTIVE.
     */
    function proposeEdge(
        address subject,
        address object_,
        bytes32 relationshipType,
        bytes32[] calldata initialRoles,
        string calldata metadataURI,
        bytes32 metadataHash
    ) external returns (bytes32 edgeId) {
        if (subject == address(0) || object_ == address(0)) revert InvalidEdge();
        if (subject == object_) revert InvalidEdge();
        if (msg.sender != subject) revert NotAuthorized();
        edgeId = computeEdgeId(subject, object_, relationshipType);
        if (_edges[edgeId].createdAt != 0) revert EdgeAlreadyExists();

        _edges[edgeId] = Edge({
            edgeId: edgeId,
            subject: subject,
            object_: object_,
            relationshipType: relationshipType,
            status: EdgeStatus.PROPOSED,
            createdBy: msg.sender,
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp),
            metadataURI: metadataURI,
            metadataHash: metadataHash
        });

        _edgesBySubject[subject].push(edgeId);
        _edgesByObject[object_].push(edgeId);
        _byTriple[subject][object_][relationshipType] = edgeId;

        for (uint256 i = 0; i < initialRoles.length; i++) {
            _addRole(edgeId, initialRoles[i]);
            emit RoleAdded(edgeId, initialRoles[i], msg.sender);
        }

        emit EdgeProposed(edgeId, subject, object_, relationshipType, msg.sender);
    }

    // ─── Confirm ────────────────────────────────────────────────────

    /**
     * @notice The object side confirms a PROPOSED edge.
     *         PROPOSED → CONFIRMED. Caller MUST be the object.
     */
    function confirmEdge(bytes32 edgeId) external {
        Edge storage e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        if (e.status != EdgeStatus.PROPOSED) revert InvalidTransition();
        if (msg.sender != e.object_) revert NotAuthorized();
        e.status = EdgeStatus.CONFIRMED;
        e.updatedAt = uint64(block.timestamp);
        emit EdgeConfirmed(edgeId, msg.sender);
    }

    /**
     * @notice Activate a CONFIRMED edge. CONFIRMED → ACTIVE. Either
     *         side may activate; off-chain resolvers may sequence the
     *         activation when ancillary checks pass (e.g. timelock).
     */
    function activateEdge(bytes32 edgeId) external {
        Edge storage e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        if (e.status != EdgeStatus.CONFIRMED) revert InvalidTransition();
        if (msg.sender != e.subject && msg.sender != e.object_) revert NotAuthorized();
        e.status = EdgeStatus.ACTIVE;
        e.updatedAt = uint64(block.timestamp);
        emit EdgeActivated(edgeId, msg.sender);
    }

    /**
     * @notice Permissionless revocation from either side. Spec 216
     *         security invariant: either party may revoke
     *         unilaterally. Once REVOKED, the edge is terminal.
     */
    function revokeEdge(bytes32 edgeId) external {
        Edge storage e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        if (e.status == EdgeStatus.REVOKED) revert InvalidTransition();
        if (msg.sender != e.subject && msg.sender != e.object_) revert NotAuthorized();
        e.status = EdgeStatus.REVOKED;
        e.updatedAt = uint64(block.timestamp);
        emit EdgeRevoked(edgeId, msg.sender);
    }

    // ─── Roles ──────────────────────────────────────────────────────

    /**
     * @notice Add a role to an existing edge. Either side may add
     *         roles to the edge's role bag.
     */
    function addRole(bytes32 edgeId, bytes32 role) external {
        Edge storage e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        if (msg.sender != e.subject && msg.sender != e.object_) revert NotAuthorized();
        if (_hasRole[edgeId][role]) revert RoleAlreadyExists();
        _addRole(edgeId, role);
        e.updatedAt = uint64(block.timestamp);
        emit RoleAdded(edgeId, role, msg.sender);
    }

    function removeRole(bytes32 edgeId, bytes32 role) external {
        Edge storage e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        if (msg.sender != e.subject && msg.sender != e.object_) revert NotAuthorized();
        if (!_hasRole[edgeId][role]) revert RoleNotFound();
        _removeRole(edgeId, role);
        e.updatedAt = uint64(block.timestamp);
        emit RoleRemoved(edgeId, role, msg.sender);
    }

    // ─── Metadata ───────────────────────────────────────────────────

    function setMetadata(bytes32 edgeId, string calldata metadataURI, bytes32 metadataHash) external {
        Edge storage e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        if (msg.sender != e.subject && msg.sender != e.object_) revert NotAuthorized();
        e.metadataURI = metadataURI;
        e.metadataHash = metadataHash;
        e.updatedAt = uint64(block.timestamp);
        emit EdgeMetadataUpdated(edgeId, metadataURI, metadataHash, msg.sender);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getEdge(bytes32 edgeId) external view returns (Edge memory) {
        Edge memory e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        return e;
    }
    function getRoles(bytes32 edgeId) external view returns (bytes32[] memory) {
        return _roles[edgeId];
    }
    function hasRole(bytes32 edgeId, bytes32 role) external view returns (bool) {
        return _hasRole[edgeId][role];
    }
    function getEdgesBySubject(address subject) external view returns (bytes32[] memory) {
        return _edgesBySubject[subject];
    }
    function getEdgesByObject(address object_) external view returns (bytes32[] memory) {
        return _edgesByObject[object_];
    }
    function getEdgeByTriple(address subject, address object_, bytes32 relationshipType) external view returns (bytes32) {
        return _byTriple[subject][object_][relationshipType];
    }
    function edgeExists(bytes32 edgeId) external view returns (bool) {
        return _edges[edgeId].createdAt != 0;
    }

    // ─── Internal ───────────────────────────────────────────────────

    function _addRole(bytes32 edgeId, bytes32 role) internal {
        _roles[edgeId].push(role);
        _hasRole[edgeId][role] = true;
    }

    function _removeRole(bytes32 edgeId, bytes32 role) internal {
        _hasRole[edgeId][role] = false;
        bytes32[] storage roles = _roles[edgeId];
        for (uint256 i = 0; i < roles.length; i++) {
            if (roles[i] == role) {
                roles[i] = roles[roles.length - 1];
                roles.pop();
                break;
            }
        }
    }
}
