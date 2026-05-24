import { keccak256, toHex } from 'viem';

/**
 * Derive a bytes32 ID for a relationship-type name. We hash the raw
 * UTF-8 bytes (matches Solidity `keccak256(bytes(name))`).
 * Done at module load so the constants are static `0x...` strings.
 */
export function hashRelationshipType(name: string): `0x${string}` {
  return keccak256(toHex(name));
}

/**
 * Derive a bytes32 ID for a role name. Same convention as
 * `hashRelationshipType` — distinct helper so call sites read clearly.
 */
export function hashRole(name: string): `0x${string}` {
  return keccak256(toHex(name));
}

/**
 * Well-known relationship types. Values are `keccak256(name)` —
 * deterministic across deployments, so the off-chain Edge IDs always
 * match the on-chain ones.
 *
 * IMPORTANT (ADR-0006): `NAMESPACE_CONTAINS` is intentionally absent.
 * Naming hierarchy lives in agent-naming via a parent-pointer, NOT
 * via a relationships-edge.
 */
export const RELATIONSHIP_TYPE = {
  /** Membership: subject is a member of object (org / DAO / collective). */
  HAS_MEMBER: hashRelationshipType('HAS_MEMBER'),
  /** Governance: subject has governance authority over object. */
  HAS_GOVERNANCE_OVER: hashRelationshipType('HAS_GOVERNANCE_OVER'),
  /** Validation trust: subject trusts object as a validator / verifier. */
  VALIDATION_TRUST: hashRelationshipType('VALIDATION_TRUST'),
  /** Bilateral partnership / cross-recognition. */
  PARTNERSHIP: hashRelationshipType('PARTNERSHIP'),
  /** Marker that subject acts on behalf of object. */
  OPERATES_ON_BEHALF_OF: hashRelationshipType('OPERATES_ON_BEHALF_OF'),
  /** Recommendation: subject endorses / recommends object. */
  RECOMMENDS: hashRelationshipType('RECOMMENDS'),
} as const;

/** Well-known role labels (bytes32-hashed). */
export const ROLE = {
  /** Generic member role. */
  MEMBER: hashRole('MEMBER'),
  /** Board / governance member. */
  BOARD_MEMBER: hashRole('BOARD_MEMBER'),
  /** Operational executor. */
  OPERATOR: hashRole('OPERATOR'),
  /** Validator / verifier. */
  VALIDATOR: hashRole('VALIDATOR'),
  /** Treasurer (holds the asset account). */
  TREASURER: hashRole('TREASURER'),
  /** Recovery contact. */
  RECOVERY_CONTACT: hashRole('RECOVERY_CONTACT'),
} as const;
