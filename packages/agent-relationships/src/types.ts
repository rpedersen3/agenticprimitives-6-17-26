import type { Address, Hex } from '@agenticprimitives/types';

/**
 * Branded bytes32 — the keccak256 hash of a relationship-type name
 * (e.g. `HAS_MEMBER`). Use the `RELATIONSHIP_TYPE` constants in
 * `src/constants.ts` rather than constructing literals.
 */
export type RelationshipType = Hex & { readonly __brand: 'relationshipType' };

/**
 * Branded bytes32 — the keccak256 hash of a role name (e.g. `MEMBER`).
 * Use the `ROLE` constants rather than constructing literals.
 */
export type Role = Hex & { readonly __brand: 'role' };

/**
 * Edge lifecycle. Spec § 4:
 *   PROPOSED → CONFIRMED → ACTIVE → REVOKED.
 *
 * - `PROPOSED` — one side has expressed intent. Has NO authority effect.
 * - `CONFIRMED` — both sides have signed (or single-side for symmetric
 *   types). Authority effects in force.
 * - `ACTIVE` — alias for CONFIRMED, set when contract-level activation
 *   conditions are met (e.g. timelock elapsed for governance edges).
 * - `REVOKED` — terminated by either side. Authority effects removed.
 *
 * Numeric values match the on-chain enum (Phase 3 port).
 */
export enum EdgeStatus {
  /** Sentinel — never assigned to a real edge. Matches Solidity enum index 0. */
  NONE = 0,
  PROPOSED = 1,
  CONFIRMED = 2,
  ACTIVE = 3,
  REVOKED = 4,
}

/**
 * The trust-fabric edge primitive. An edge is uniquely identified by
 * `(subject, object, relationshipType)`; same triple → same `edgeId`.
 * This invariant prevents duplicate edges and enables idempotent
 * propose-edge writes.
 */
export interface Edge {
  /** Deterministic ID: `keccak256(subject || object || relationshipType)`. */
  edgeId: Hex;
  /** Subject Smart Agent (the "from" side). */
  subject: Address;
  /** Object Smart Agent (the "to" side). */
  object: Address;
  /** Hashed relationship type. */
  relationshipType: RelationshipType;
  /** Role bytes32 hashes attached to the subject side. */
  subjectRoles: Role[];
  /** Role bytes32 hashes attached to the object side. */
  objectRoles: Role[];
  /** Lifecycle status. */
  status: EdgeStatus;
  /** Optional metadata URI (off-chain JSON; same content-hash discipline as agent-identity). */
  metadataUri?: string;
  /** keccak256 of canonical metadata JSON (if `metadataUri` set). */
  metadataHash?: Hex;
  /** Unix-seconds timestamp the edge first entered PROPOSED. */
  createdAt: number;
}

export interface ProposeEdgeInput {
  subject: Address;
  object: Address;
  relationshipType: RelationshipType;
  subjectRoles?: Role[];
  objectRoles?: Role[];
  metadataUri?: string;
  metadataHash?: Hex;
}

export interface ConfirmEdgeInput {
  edgeId: Hex;
  /** Role set the confirming side attaches to its own side. */
  selfRoles?: Role[];
}

export interface RevokeEdgeInput {
  edgeId: Hex;
  /** Optional revocation reason (off-chain — not enforced on-chain). */
  reason?: string;
}

export interface SetRolesInput {
  edgeId: Hex;
  /** Set the subject-side role bag (the caller MUST be the subject). */
  subjectRoles?: Role[];
  /** Set the object-side role bag (the caller MUST be the object). */
  objectRoles?: Role[];
}

export interface AgentRelationshipsClientOpts {
  rpcUrl: string;
  chainId: number;
}
