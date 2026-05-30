import { keccak256, concat } from 'viem';
import type { Address, Hex } from '@agenticprimitives/types';
import type { RelationshipType } from './types';
import { InvalidEdgeError } from './errors';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Deterministic edge-ID derivation. Matches the on-chain port that
 * will land in `packages/contracts/src/relationships/AgentRelationship.sol`
 * (Phase 3): `keccak256(abi.encodePacked(subject, object, relType))`.
 *
 * Solidity `address` is a 20-byte value with no casing — we lowercase
 * each input so two callers using different casings (and the on-chain
 * port) produce identical IDs. We deliberately do NOT route through
 * `viem.getAddress`, which requires either all-lowercase OR a valid
 * EIP-55 checksum and rejects all-uppercase.
 */
export function computeEdgeId(
  subject: Address,
  object: Address,
  relationshipType: RelationshipType,
): Hex {
  if (!subject) throw new InvalidEdgeError('subject required', 'subject');
  if (!object) throw new InvalidEdgeError('object required', 'object');
  if (!relationshipType) {
    throw new InvalidEdgeError('relationshipType required', 'relationshipType');
  }
  if (!ADDRESS_RE.test(subject)) throw new InvalidEdgeError(`malformed subject ${subject}`, 'subject');
  if (!ADDRESS_RE.test(object)) throw new InvalidEdgeError(`malformed object ${object}`, 'object');
  if (subject.toLowerCase() === object.toLowerCase()) {
    throw new InvalidEdgeError('subject and object must differ — self-edges not allowed');
  }
  const s = subject.toLowerCase() as `0x${string}`;
  const o = object.toLowerCase() as `0x${string}`;
  return keccak256(concat([s, o, relationshipType]));
}
