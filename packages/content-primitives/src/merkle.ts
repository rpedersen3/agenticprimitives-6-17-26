import { keccak256, concat, toBytes, type Hex } from 'viem';

// Generic Merkle commitment over a corpus of descriptor commitments (spec 266
// §4). Net-new to the monorepo (the repo previously had only flat keccak
// commitments in `agreements`). Sorted-pair hashing (OpenZeppelin-compatible)
// so inclusion proofs are sibling-order-independent and verifiable on-chain in
// a future ContentCorpusRegistry (spec 266 Phase 3).

/** Order two hashes ascending (sorted-pair convention). */
function sortPair(a: Hex, b: Hex): [Hex, Hex] {
  return a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
}

/** Hash an ordered pair after sorting: keccak256(min || max). */
export function hashPair(a: Hex, b: Hex): Hex {
  const [lo, hi] = sortPair(a, b);
  return keccak256(concat([lo, hi]));
}

/**
 * Leaf hash for a descriptor commitment. Double-hash (`keccak256(keccak256(c))`)
 * to domain-separate leaves from internal nodes (second-preimage resistance).
 */
export function leafHash(descriptorCommitment: Hex): Hex {
  return keccak256(toBytes(keccak256(toBytes(descriptorCommitment))));
}

export interface CorpusTree {
  root: Hex;
  /** layers[0] = leaves, layers[n] = [root]. */
  layers: Hex[][];
}

/**
 * Build a Merkle tree over already-hashed leaves (see {@link leafHash}). An odd
 * node at any level is promoted unchanged to the next level. Empty input yields
 * the zero root.
 */
export function buildCorpusTree(leaves: Hex[]): CorpusTree {
  if (leaves.length === 0) {
    return { root: ('0x' + '0'.repeat(64)) as Hex, layers: [[]] };
  }
  const layers: Hex[][] = [leaves.slice()];
  while (layers[layers.length - 1]!.length > 1) {
    const prev = layers[layers.length - 1]!;
    const next: Hex[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      if (i + 1 === prev.length) next.push(prev[i]!);
      else next.push(hashPair(prev[i]!, prev[i + 1]!));
    }
    layers.push(next);
  }
  return { root: layers[layers.length - 1]![0]!, layers };
}

/** Convenience: root of a fresh tree over `leaves`. */
export function merkleRoot(leaves: Hex[]): Hex {
  return buildCorpusTree(leaves).root;
}

/**
 * Inclusion proof (sibling path) for the leaf at `index`. Promoted (odd) nodes
 * contribute no sibling at that level — matching {@link buildCorpusTree}.
 */
export function merkleProof(tree: CorpusTree, index: number): Hex[] {
  const proof: Hex[] = [];
  let idx = index;
  for (let level = 0; level < tree.layers.length - 1; level++) {
    const nodes = tree.layers[level]!;
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    if (siblingIdx < nodes.length) proof.push(nodes[siblingIdx]!);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Fold a leaf with its proof and compare against the root. */
export function verifyInclusion(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let computed = leaf;
  for (const sibling of proof) computed = hashPair(computed, sibling);
  return computed.toLowerCase() === root.toLowerCase();
}
