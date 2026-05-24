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
