import { keccak256, encodePacked, toBytes, type Hex } from 'viem';
import { normalizeAgentName } from './normalize';

/**
 * Compute the recursive namehash of an agent name
 * (`keccak256(parentNode || labelhash)` convention).
 *
 *   namehash('')                = 0x00…00
 *   namehash('agent')           = keccak256(namehash('') || labelhash('agent'))
 *   namehash('alice.acme.agent')
 *                               = keccak256(namehash('acme.agent') || labelhash('alice'))
 *
 * The hash is computed against the NORMALIZED name (see
 * `normalizeAgentName`). Two strings that normalize identically
 * produce identical namehashes.
 *
 * Throws `InvalidNameError` (via `normalizeAgentName`) on malformed
 * input. Passing `''` returns `0x00…00` — the canonical "empty / root"
 * sentinel matching the recursive-namehash convention.
 */
export function namehash(name: string): Hex {
  if (name === '') return ZERO_NODE;
  const labels = normalizeAgentName(name).split('.');
  let node: Hex = ZERO_NODE;
  // Walk from rightmost (TLD-side) label inward so the root anchors
  // the recursion — the standard recursive-namehash algorithm.
  for (let i = labels.length - 1; i >= 0; i--) {
    const lh = labelhash(labels[i]!);
    node = keccak256(encodePacked(['bytes32', 'bytes32'], [node, lh]));
  }
  return node;
}

/**
 * Compute the labelhash of a single label.
 *
 * `labelhash(label)` = keccak256(utf8Bytes(label))
 *
 * No normalization is applied here — the caller is expected to pass a
 * label produced by splitting a normalized name. Pass a non-normalized
 * label at your own risk.
 */
export function labelhash(label: string): Hex {
  return keccak256(toBytes(label));
}

/** The all-zeros 32-byte sentinel namehash (the root of the tree). */
export const ZERO_NODE: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000';
