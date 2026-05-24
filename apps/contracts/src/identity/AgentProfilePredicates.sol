// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AgentProfilePredicates
 * @notice Canonical bytes32 ids for identity-profile predicates,
 *         registered in the shared OntologyTermRegistry alongside
 *         the AgentName predicates from NS Phase 3.
 *
 * Some predicates are SHARED with AgentName (`atl:displayName`,
 * `atl:metadataURI`, `atl:metadataHash`, `atl:agentKind`) — same
 * vocabulary across stores is the whole point of the central
 * OntologyTermRegistry. The IDs here that overlap MUST equal the
 * AgentName ones (they're both `keccak256("atl:displayName")` etc.).
 *
 * Identity-only predicates (`atl:description`, `atl:homepage`,
 * `atl:avatar`, `atl:profileSchemaURI`, `atl:profileActive`,
 * `atl:profileRegisteredAt`) are NEW and registered by Deploy.s.sol.
 */
library AgentProfilePredicates {
    // ─── Shared with AgentName (MUST equal AgentNamePredicates.*) ────

    bytes32 internal constant ATL_DISPLAY_NAME      = keccak256("atl:displayName");
    bytes32 internal constant ATL_AGENT_KIND        = keccak256("atl:agentKind");
    bytes32 internal constant ATL_METADATA_URI      = keccak256("atl:metadataURI");
    bytes32 internal constant ATL_METADATA_HASH     = keccak256("atl:metadataHash");

    // ─── Identity-only ──────────────────────────────────────────────

    bytes32 internal constant ATL_DESCRIPTION       = keccak256("atl:description");
    bytes32 internal constant ATL_HOMEPAGE          = keccak256("atl:homepage");
    bytes32 internal constant ATL_AVATAR            = keccak256("atl:avatar");
    bytes32 internal constant ATL_PROFILE_SCHEMA_URI = keccak256("atl:profileSchemaURI");
    bytes32 internal constant ATL_PROFILE_ACTIVE    = keccak256("atl:profileActive");
    bytes32 internal constant ATL_PROFILE_REGISTERED_AT = keccak256("atl:profileRegisteredAt");

    // ─── Class id ───────────────────────────────────────────────────

    bytes32 internal constant CLASS_AGENT_PROFILE   = keccak256("atl:AgentProfile");
}
