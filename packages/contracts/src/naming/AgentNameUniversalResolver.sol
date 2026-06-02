// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentNameRegistry.sol";
import "./AgentNameAttributeResolver.sol";
import "./AgentNamePredicates.sol";

/**
 * @title AgentNameUniversalResolver
 * @notice Read-only aggregator for the agent-naming registry +
 *         ontology-backed AttributeResolver.
 *
 * Combines the registry (who owns what node) with the per-node typed
 * resolver (what records are stored) into a single, gas-efficient read
 * surface. The SDK targets this contract for `resolveName`,
 * `reverseResolve`, and typed multi-record reads.
 *
 * Round-trip discipline (security invariant from spec 215 § 10):
 *   `resolveName(reverseResolve(addr)) == addr` MUST hold. We enforce
 *   this on the read side; `AgentNameRegistry.setPrimaryName` stays
 *   permissive so callers can sequence forward + reverse writes
 *   independently.
 */
contract AgentNameUniversalResolver {
    AgentNameRegistry public immutable REGISTRY;

    constructor(AgentNameRegistry registry) {
        REGISTRY = registry;
    }

    // ─── Forward resolution ─────────────────────────────────────────

    /**
     * @notice Resolve `node` to its Smart Agent address.
     *
     * Lookup order:
     *   1. resolver.getAddress(node, ATL_ADDR) — explicit forward record.
     *   2. REGISTRY.owner(node) — fallback when ATL_ADDR is unset.
     *
     * Returns `address(0)` for unregistered nodes (does NOT revert) so
     * a multi-call can probe many names without partial reverts.
     */
    function resolveName(bytes32 node) external view returns (address) {
        if (!REGISTRY.recordExists(node)) return address(0);
        address resolverAddr = REGISTRY.resolver(node);
        if (resolverAddr != address(0)) {
            try AgentNameAttributeResolver(resolverAddr).getAddress(node, AgentNamePredicates.ATL_ADDR) returns (address resolved) {
                if (resolved != address(0)) return resolved;
            } catch {}
        }
        return REGISTRY.owner(node);
    }

    /// @notice Resolve a single string-valued record by predicate id.
    function resolveString(bytes32 node, bytes32 predicate) external view returns (string memory) {
        address resolverAddr = REGISTRY.resolver(node);
        if (resolverAddr == address(0)) return "";
        try AgentNameAttributeResolver(resolverAddr).getString(node, predicate) returns (string memory value) {
            return value;
        } catch {
            return "";
        }
    }

    /// @notice Resolve a single bytes32-valued record by predicate id.
    function resolveBytes32(bytes32 node, bytes32 predicate) external view returns (bytes32) {
        address resolverAddr = REGISTRY.resolver(node);
        if (resolverAddr == address(0)) return bytes32(0);
        try AgentNameAttributeResolver(resolverAddr).getBytes32(node, predicate) returns (bytes32 value) {
            return value;
        } catch {
            return bytes32(0);
        }
    }

    /// @notice Resolve a single address-valued record by predicate id.
    function resolveAddress(bytes32 node, bytes32 predicate) external view returns (address) {
        address resolverAddr = REGISTRY.resolver(node);
        if (resolverAddr == address(0)) return address(0);
        try AgentNameAttributeResolver(resolverAddr).getAddress(node, predicate) returns (address value) {
            return value;
        } catch {
            return address(0);
        }
    }

    /// @notice Multi-read of N string records in a single static-call.
    function resolveStringBatch(bytes32 node, bytes32[] calldata predicates)
        external
        view
        returns (string[] memory values)
    {
        values = new string[](predicates.length);
        address resolverAddr = REGISTRY.resolver(node);
        if (resolverAddr == address(0)) return values;
        for (uint256 i = 0; i < predicates.length; i++) {
            try AgentNameAttributeResolver(resolverAddr).getString(node, predicates[i]) returns (string memory value) {
                values[i] = value;
            } catch {
                values[i] = "";
            }
        }
    }

    // ─── Reverse resolution (round-trip enforced) ───────────────────

    /**
     * @notice Resolve a Smart Agent address back to its primary-name node.
     * @return node The primary-name node, OR `bytes32(0)` when no primary
     *              name is set OR when the forward record does not point
     *              back to `agent` (round-trip fails — squat protection).
     */
    function reverseResolve(address agent) external view returns (bytes32 node) {
        node = REGISTRY.primaryName(agent);
        if (node == bytes32(0)) return bytes32(0);
        if (!REGISTRY.recordExists(node)) return bytes32(0);
        address forward = _resolveNameView(node);
        if (forward != agent) return bytes32(0);
        return node;
    }

    /**
     * @notice Reverse-resolve a Smart Agent address to its primary name
     *         STRING in a single external call. Per spec/222 this is
     *         the on-chain reverse path — no log walks, no name
     *         reconstruction in the SDK, no event indexer required.
     *
     *         Walks `parent(node)` up the registry, reading `label(node)`
     *         at each level, joining with `.`. All view calls. Returns
     *         `""` when (a) no primary set, (b) round-trip fails (squat
     *         protection), or (c) any node along the parent chain has
     *         no on-chain label string (pre-spec/222 backfill not done).
     */
    function reverseResolveString(address agent) external view returns (string memory) {
        bytes32 node = REGISTRY.primaryName(agent);
        if (node == bytes32(0)) return "";
        if (!REGISTRY.recordExists(node)) return "";
        if (_resolveNameView(node) != agent) return "";
        return _composeName(node);
    }

    /**
     * @notice Compose the full dotted name string for `node` by walking
     *         the parent chain. Generalizes: works for ANY registered
     *         node, not just an agent's primary. Returns `""` if any
     *         label in the chain is missing on chain.
     */
    function nameOf(bytes32 node) external view returns (string memory) {
        if (node == bytes32(0)) return "";
        if (!REGISTRY.recordExists(node)) return "";
        return _composeName(node);
    }

    function _composeName(bytes32 startNode) internal view returns (string memory) {
        // Collect labels walking up to root. Bounded depth = 10 to
        // match the SDK's previous _reconstructName cap (no demo path
        // exceeds 4 — alice7.demo.agent is 3).
        string[10] memory labels;
        uint256 depth = 0;
        bytes32 cur = startNode;
        while (cur != bytes32(0) && depth < 10) {
            string memory lbl = REGISTRY.label(cur);
            if (bytes(lbl).length == 0) return "";
            labels[depth] = lbl;
            cur = REGISTRY.parent(cur);
            unchecked { depth++; }
        }
        if (depth == 0) return "";

        // Concatenate labels[0..depth-1] with '.' separators.
        uint256 totalLen = depth - 1; // for the dots
        for (uint256 i = 0; i < depth; i++) totalLen += bytes(labels[i]).length;
        bytes memory out = new bytes(totalLen);
        uint256 pos = 0;
        for (uint256 i = 0; i < depth; i++) {
            bytes memory lbl = bytes(labels[i]);
            for (uint256 j = 0; j < lbl.length; j++) out[pos++] = lbl[j];
            if (i + 1 < depth) out[pos++] = 0x2e; // '.'
        }
        return string(out);
    }

    function _resolveNameView(bytes32 node) internal view returns (address) {
        address resolverAddr = REGISTRY.resolver(node);
        if (resolverAddr != address(0)) {
            try AgentNameAttributeResolver(resolverAddr).getAddress(node, AgentNamePredicates.ATL_ADDR) returns (address resolved) {
                if (resolved != address(0)) return resolved;
            } catch {}
        }
        return REGISTRY.owner(node);
    }

    // ─── Directory listing ──────────────────────────────────────────

    /// @notice List a node's children and their resolved addresses.
    function getChildren(bytes32 parentNode)
        external
        view
        returns (bytes32[] memory childNodes, address[] memory owners)
    {
        bytes32[] memory labelhashes = REGISTRY.childLabelhashes(parentNode);
        childNodes = new bytes32[](labelhashes.length);
        owners = new address[](labelhashes.length);
        for (uint256 i = 0; i < labelhashes.length; i++) {
            bytes32 child = REGISTRY.childNode(parentNode, labelhashes[i]);
            childNodes[i] = child;
            owners[i] = REGISTRY.owner(child);
        }
    }
}
