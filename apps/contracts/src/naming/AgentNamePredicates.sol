// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AgentNamePredicates
 * @notice Canonical bytes32 predicate ids for the AgentName ontology
 *         (`atl:*` CURIEs). Single source of truth shared by:
 *           - Deploy.s.sol (registers these in OntologyTermRegistry)
 *           - AgentNameAttributeResolver (typed-attribute setters
 *             validate against these ids)
 *           - agenticprimitives/agent-naming SDK (off-chain encoders /
 *             decoders use the same ids)
 *
 * Naming convention: `ATL_<UPPER_SNAKE_NAME>` where the CURIE is
 * `atl:<lowerCamelName>`. Use a library so the constants can be
 * imported as `using AgentNamePredicates for *;` OR referenced
 * directly as `AgentNamePredicates.ATL_DISPLAY_NAME`.
 */
library AgentNamePredicates {
    // ─── Resolver-record predicates (forward record + typed metadata) ─

    /// `atl:addr` — the forward record. Stored as `address` datatype.
    bytes32 internal constant ATL_ADDR                       = keccak256("atl:addr");

    /// `atl:agentKind` — discriminator (`person`/`org`/`service`/`treasury`).
    /// Stored as `bytes32` (hashed enum value). Bound to AGENT_KIND_ENUM in ShapeRegistry.
    bytes32 internal constant ATL_AGENT_KIND                 = keccak256("atl:agentKind");

    /// `atl:displayName` — human-friendly label. `string`.
    bytes32 internal constant ATL_DISPLAY_NAME               = keccak256("atl:displayName");

    /// `atl:a2aEndpoint` — A2A service URL. `string`.
    bytes32 internal constant ATL_A2A_ENDPOINT               = keccak256("atl:a2aEndpoint");

    /// `atl:mcpEndpoint` — MCP service URL. `string`.
    bytes32 internal constant ATL_MCP_ENDPOINT               = keccak256("atl:mcpEndpoint");

    /// `atl:metadataURI` — off-chain JSON profile URL. `string`.
    bytes32 internal constant ATL_METADATA_URI               = keccak256("atl:metadataURI");

    /// `atl:metadataHash` — keccak256 of the canonical-JSON profile
    /// (matches `agenticprimitives/agent-identity.profileContentHash`).
    /// `bytes32`.
    bytes32 internal constant ATL_METADATA_HASH              = keccak256("atl:metadataHash");

    /// `atl:passkeyCredentialDigest` — keccak256 of the controlling
    /// passkey credentialId (NEVER the raw credentialId). `bytes32`.
    bytes32 internal constant ATL_PASSKEY_CREDENTIAL_DIGEST  = keccak256("atl:passkeyCredentialDigest");

    /// `atl:custodyPolicy` — address of the owner Smart Agent's
    /// CustodyPolicy module. `address`.
    bytes32 internal constant ATL_CUSTODY_POLICY             = keccak256("atl:custodyPolicy");

    /// `atl:nativeId` — CAIP-10 chain-agnostic account identifier
    /// (per ADR-0008). `string`.
    bytes32 internal constant ATL_NATIVE_ID                  = keccak256("atl:nativeId");

    // ─── Shape + enum-set ids ───────────────────────────────────────

    /// `atl:AgentName` — the class id for ShapeRegistry validation.
    bytes32 internal constant CLASS_AGENT_NAME               = keccak256("atl:AgentName");

    /// Enum set bound to `atl:agentKind`. Contains the four hashed
    /// member ids below.
    bytes32 internal constant AGENT_KIND_ENUM                = keccak256("atl:AgentKindEnum");

    bytes32 internal constant AGENT_KIND_PERSON              = keccak256("person");
    bytes32 internal constant AGENT_KIND_ORG                 = keccak256("org");
    bytes32 internal constant AGENT_KIND_SERVICE             = keccak256("service");
    bytes32 internal constant AGENT_KIND_TREASURY            = keccak256("treasury");
}
