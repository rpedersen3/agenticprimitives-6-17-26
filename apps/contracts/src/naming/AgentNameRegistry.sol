// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AgentNameRegistry
 * @notice Hierarchical multi-root name registry for Smart Agents.
 *
 * Names are keyed by `node` (the ENS-style namehash:
 * `keccak256(parentNode || labelhash)`). Each node has an owner (a Smart
 * Agent address), a resolver, an optional subregistry delegate that may
 * issue children, a parent pointer, the labelhash, and an optional
 * expiry.
 *
 * Adapted from smart-agent (`packages/contracts/src/AgentNameRegistry.sol`,
 * 359 LOC) with the following simplifications per spec 215 § Phase 3 +
 * ADR-0006:
 *
 *   - **No AgentRelationship dependency.** The smart-agent original
 *     created a `NAMESPACE_CONTAINS` edge on every register; ADR-0006
 *     rules that as parallel authority. The parent pointer in
 *     `_records[node].parent` IS the hierarchy.
 *
 *   - **No OpenZeppelin AccessControl / TimelockController.** The owner
 *     Smart Agent's CustodyPolicy module IS the timelock + RBAC.
 *     Authorization here is purely `msg.sender == owner` (the Smart
 *     Agent executes through its CustodyPolicy gate, then calls into
 *     this contract).
 *
 *   - **No multi-owner `isOwner(address)` fallback.** Our AgentAccount
 *     is ERC-7579 modular with no built-in owner registry; quorum
 *     belongs to the CustodyPolicy module. The legacy smart-agent path
 *     `staticcall isOwner(msg.sender)` does not apply.
 *
 * Reverse-records (primary names: address → node) ALSO live here
 * for atomicity; the universal resolver enforces the round-trip
 * discipline (a primary name only counts when the forward record
 * agrees).
 */
contract AgentNameRegistry {
    // ─── Types ──────────────────────────────────────────────────────

    struct NameRecord {
        address owner;       // Smart Agent that controls this name
        address resolver;    // resolver contract for this node's records
        address subregistry; // 0 = owner-only; non-zero = delegate may also register children
        bytes32 parent;      // parent namehash; bytes32(0) for roots
        bytes32 labelhash;   // keccak256(bytes(label))
        uint64  expiry;      // 0 = no expiry
        uint64  registeredAt;
    }

    // ─── Errors ─────────────────────────────────────────────────────

    error NotAuthorized();
    error NodeAlreadyExists();
    error NodeNotFound();
    error ParentNotFound();
    error NameExpired();
    error RootAlreadyInitialized();
    error EmptyLabel();
    error ZeroOwner();

    // ─── Events ─────────────────────────────────────────────────────

    event RootInitialized(bytes32 indexed rootNode, string label, address indexed owner, bytes32 kind);
    event NameRegistered(
        bytes32 indexed node,
        bytes32 indexed parent,
        string label,
        address owner,
        address resolver,
        uint64 expiry
    );
    event OwnerChanged(bytes32 indexed node, address indexed newOwner);
    event ResolverChanged(bytes32 indexed node, address indexed resolver);
    event SubregistryChanged(bytes32 indexed node, address indexed subregistry);
    event NameRenewed(bytes32 indexed node, uint64 newExpiry);
    event PrimaryNameSet(address indexed agent, bytes32 indexed node);
    event PrimaryNameCleared(address indexed agent);

    // ─── Storage ────────────────────────────────────────────────────

    mapping(bytes32 => NameRecord) private _records;
    mapping(bytes32 => mapping(bytes32 => bytes32)) private _children; // parent => labelhash => childNode
    mapping(bytes32 => bytes32[]) private _childLabels;                // parent => labelhash[]

    /// @notice Multi-root registry — `true` iff `node` was initialized via `initializeRoot`.
    mapping(bytes32 => bool) public isRoot;
    /// @notice Per-root opaque kind tag (e.g. `keccak256("namespace:Agent")`).
    mapping(bytes32 => bytes32) public rootKind;
    /// @notice Lookup root node by ASCII TLD label.
    mapping(string => bytes32) private _rootByLabel;
    /// @notice Enumeration of every initialized root.
    bytes32[] private _allRoots;

    /// @notice Reverse-record: Smart Agent address → primary name node.
    /// @dev    Forward agreement (resolver-addr == agent) is enforced by
    ///         the universal resolver, NOT here — keeping registry writes
    ///         simple. A primary-name claim with no forward agreement
    ///         returns null on reverseResolve via the resolver.
    mapping(address => bytes32) private _primaryName;

    /// @notice Default kind tags downstream callers may use.
    bytes32 public constant KIND_AGENT = keccak256("namespace:Agent");

    // ─── Namehash Helpers ───────────────────────────────────────────

    /// @notice Pure namehash for a top-level label (parent = bytes32(0)).
    function namehashRoot(string memory label) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes32(0), keccak256(bytes(label))));
    }

    /// @notice Backward-compat helper returning `namehash("agent")` — SDK
    ///         callers use this to derive `.agent` without re-implementing
    ///         the algorithm.
    function AGENT_ROOT() public pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes32(0), keccak256(bytes("agent"))));
    }

    // ─── Root Initialization (multi-root) ───────────────────────────

    /**
     * @notice Initialize a TLD root.
     * @param label             TLD label without leading dot (e.g. "agent").
     * @param rootOwner         Address that will own the root (Smart Agent or deployer EOA for bootstrap).
     * @param resolverContract  Default resolver for the root (0 = none).
     * @param kind              Opaque tag; SDK / downstream binders use it to dispatch.
     */
    function initializeRoot(
        string calldata label,
        address rootOwner,
        address resolverContract,
        bytes32 kind
    ) external returns (bytes32 rootNode) {
        if (bytes(label).length == 0) revert EmptyLabel();
        if (rootOwner == address(0)) revert ZeroOwner();
        rootNode = namehashRoot(label);
        if (_records[rootNode].registeredAt != 0) revert RootAlreadyInitialized();

        _records[rootNode] = NameRecord({
            owner: rootOwner,
            resolver: resolverContract,
            subregistry: rootOwner,
            parent: bytes32(0),
            labelhash: keccak256(bytes(label)),
            expiry: 0,
            registeredAt: uint64(block.timestamp)
        });

        isRoot[rootNode] = true;
        rootKind[rootNode] = kind;
        _rootByLabel[label] = rootNode;
        _allRoots.push(rootNode);

        emit RootInitialized(rootNode, label, rootOwner, kind);
    }

    /// @notice Enumerate every initialized root.
    function getRoots() external view returns (bytes32[] memory) {
        return _allRoots;
    }

    /// @notice Look up a root by its TLD label. Returns `bytes32(0)` if not initialized.
    function rootByLabel(string calldata label) external view returns (bytes32) {
        return _rootByLabel[label];
    }

    // ─── Registration ───────────────────────────────────────────────

    /**
     * @notice Register a child name under a parent.
     * @dev    Caller must be parent's owner OR parent's subregistry delegate.
     *         Caller's Smart Agent is responsible for routing through its
     *         CustodyPolicy before this call lands; this function trusts
     *         `msg.sender` to be the gated entity.
     */
    function register(
        bytes32 parentNode,
        string calldata label,
        address newOwner,
        address resolverContract,
        uint64 expiry
    ) external returns (bytes32 childNode) {
        if (bytes(label).length == 0) revert EmptyLabel();
        if (newOwner == address(0)) revert ZeroOwner();
        _requireParentAuth(parentNode);
        _requireNotExpired(parentNode);

        bytes32 lh = keccak256(bytes(label));
        childNode = keccak256(abi.encodePacked(parentNode, lh));
        if (_records[childNode].registeredAt != 0) revert NodeAlreadyExists();

        _records[childNode] = NameRecord({
            owner: newOwner,
            resolver: resolverContract,
            subregistry: address(0),
            parent: parentNode,
            labelhash: lh,
            expiry: expiry,
            registeredAt: uint64(block.timestamp)
        });

        _children[parentNode][lh] = childNode;
        _childLabels[parentNode].push(lh);

        emit NameRegistered(childNode, parentNode, label, newOwner, resolverContract, expiry);
    }

    // ─── Setters ────────────────────────────────────────────────────

    function setOwner(bytes32 node, address newOwner) external {
        _requireNodeAuth(node);
        if (newOwner == address(0)) revert ZeroOwner();
        _records[node].owner = newOwner;
        emit OwnerChanged(node, newOwner);
    }

    function setResolver(bytes32 node, address resolverContract) external {
        _requireNodeAuth(node);
        _records[node].resolver = resolverContract;
        emit ResolverChanged(node, resolverContract);
    }

    function setSubregistry(bytes32 node, address subregistryContract) external {
        _requireNodeAuth(node);
        _records[node].subregistry = subregistryContract;
        emit SubregistryChanged(node, subregistryContract);
    }

    function renew(bytes32 node, uint64 newExpiry) external {
        _requireNodeAuth(node);
        _records[node].expiry = newExpiry;
        emit NameRenewed(node, newExpiry);
    }

    /**
     * @notice Set the reverse-record (primary name) for `msg.sender`.
     * @dev    Anyone may set their own primary name; the registry does
     *         NOT verify the forward record points back here. The
     *         universal resolver enforces the round-trip on reads.
     */
    function setPrimaryName(bytes32 node) external {
        if (node != bytes32(0) && _records[node].registeredAt == 0) revert NodeNotFound();
        _primaryName[msg.sender] = node;
        if (node == bytes32(0)) emit PrimaryNameCleared(msg.sender);
        else emit PrimaryNameSet(msg.sender, node);
    }

    /// @notice Read the unverified primary-name node for `agent`. The
    ///         universal resolver MUST round-trip this against the
    ///         resolver's `addr(node)`.
    function primaryName(address agent) external view returns (bytes32) {
        return _primaryName[agent];
    }

    // ─── Queries ────────────────────────────────────────────────────

    function owner(bytes32 node) external view returns (address) { return _records[node].owner; }
    function resolver(bytes32 node) external view returns (address) { return _records[node].resolver; }
    function subregistry(bytes32 node) external view returns (address) { return _records[node].subregistry; }
    function parent(bytes32 node) external view returns (bytes32) { return _records[node].parent; }
    function labelhash(bytes32 node) external view returns (bytes32) { return _records[node].labelhash; }
    function expiry(bytes32 node) external view returns (uint64) { return _records[node].expiry; }
    function recordExists(bytes32 node) external view returns (bool) { return _records[node].registeredAt != 0; }
    function registeredAt(bytes32 node) external view returns (uint64) { return _records[node].registeredAt; }

    function childNode(bytes32 parentNode, bytes32 lh) external view returns (bytes32) {
        return _children[parentNode][lh];
    }
    function childCount(bytes32 parentNode) external view returns (uint256) {
        return _childLabels[parentNode].length;
    }
    function childLabelhashes(bytes32 parentNode) external view returns (bytes32[] memory) {
        return _childLabels[parentNode];
    }
    function isExpired(bytes32 node) public view returns (bool) {
        uint64 exp = _records[node].expiry;
        return exp != 0 && block.timestamp > exp;
    }

    // ─── Auth ───────────────────────────────────────────────────────

    function _requireNodeAuth(bytes32 node) internal view {
        NameRecord storage r = _records[node];
        if (r.registeredAt == 0) revert NodeNotFound();
        if (msg.sender != r.owner) revert NotAuthorized();
    }

    function _requireParentAuth(bytes32 parentNode) internal view {
        NameRecord storage r = _records[parentNode];
        if (r.registeredAt == 0) revert ParentNotFound();
        if (msg.sender == r.owner) return;
        if (r.subregistry != address(0) && msg.sender == r.subregistry) return;
        revert NotAuthorized();
    }

    function _requireNotExpired(bytes32 node) internal view {
        if (isExpired(node)) revert NameExpired();
    }
}

