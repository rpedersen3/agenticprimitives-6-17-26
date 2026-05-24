// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AgentRelationshipPredicates
 * @notice Canonical bytes32 ids for the agent-relationships trust
 *         fabric (relationship types + role labels). Single source of
 *         truth shared by:
 *           - AgentRelationship.sol (uses the IDs as bytes32 keys)
 *           - Deploy.s.sol (bootstraps the type set in
 *             RelationshipTypeRegistry)
 *           - agenticprimitives/agent-relationships SDK (mirror
 *             constants in src/constants.ts)
 *
 * The six well-known relationship types match spec 216 § 5; matching
 * `keccak256(name)` IDs are derived here. The role set is deliberately
 * narrower than the smart-agent original (start small, add via PR + a
 * golden-vector test when concrete consumers need a role).
 */
library AgentRelationshipPredicates {
    // ─── Well-known relationship types ──────────────────────────────

    /// Membership: subject is a member of object.
    bytes32 internal constant HAS_MEMBER               = keccak256("HAS_MEMBER");
    /// Governance: subject has governance authority over object.
    bytes32 internal constant HAS_GOVERNANCE_OVER      = keccak256("HAS_GOVERNANCE_OVER");
    /// Validation: subject trusts object as a validator / verifier.
    bytes32 internal constant VALIDATION_TRUST         = keccak256("VALIDATION_TRUST");
    /// Bilateral partnership / cross-recognition (symmetric).
    bytes32 internal constant PARTNERSHIP              = keccak256("PARTNERSHIP");
    /// Operational delegation marker: subject operates on behalf of object.
    bytes32 internal constant OPERATES_ON_BEHALF_OF    = keccak256("OPERATES_ON_BEHALF_OF");
    /// Endorsement: subject recommends object.
    bytes32 internal constant RECOMMENDS               = keccak256("RECOMMENDS");

    // ─── Well-known roles ───────────────────────────────────────────

    bytes32 internal constant ROLE_MEMBER              = keccak256("MEMBER");
    bytes32 internal constant ROLE_BOARD_MEMBER        = keccak256("BOARD_MEMBER");
    bytes32 internal constant ROLE_OPERATOR            = keccak256("OPERATOR");
    bytes32 internal constant ROLE_VALIDATOR           = keccak256("VALIDATOR");
    bytes32 internal constant ROLE_TREASURER           = keccak256("TREASURER");
    bytes32 internal constant ROLE_RECOVERY_CONTACT    = keccak256("RECOVERY_CONTACT");
}
