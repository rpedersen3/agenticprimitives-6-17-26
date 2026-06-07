import { describe, it, expect } from 'vitest';
import { keccak256, toBytes, type Hex } from 'viem';
import { leafHash, buildCorpusTree, merkleRoot, merkleProof, verifyInclusion } from '../src/merkle.js';

const leaves = (n: number): Hex[] => Array.from({ length: n }, (_, i) => leafHash(keccak256(toBytes(`v${i}`))));

describe('merkle corpus commitments', () => {
  it('single-leaf root is the leaf itself', () => {
    const l = leaves(1);
    expect(merkleRoot(l)).toBe(l[0]);
  });

  it('empty corpus has the zero root', () => {
    expect(merkleRoot([])).toBe(('0x' + '0'.repeat(64)) as Hex);
  });

  it('every leaf proves under the root (incl. odd counts via promotion)', () => {
    for (const n of [2, 3, 4, 5, 8, 31, 100]) {
      const ls = leaves(n);
      const tree = buildCorpusTree(ls);
      for (let i = 0; i < n; i++) {
        const proof = merkleProof(tree, i);
        expect(verifyInclusion(ls[i]!, proof, tree.root), `leaf ${i}/${n}`).toBe(true);
      }
    }
  });

  it('a wrong leaf does not verify', () => {
    const ls = leaves(8);
    const tree = buildCorpusTree(ls);
    const proof = merkleProof(tree, 3);
    expect(verifyInclusion(leafHash(keccak256(toBytes('not-in-tree'))), proof, tree.root)).toBe(false);
  });

  it('leaf hashing is domain-separated from a raw commitment (second-preimage)', () => {
    const commitment = keccak256(toBytes('v0'));
    expect(leafHash(commitment)).not.toBe(commitment);
  });

  it('sorted-pair hashing makes sibling order irrelevant (intended)', () => {
    const ls = leaves(4);
    const siblingSwapped = [ls[1]!, ls[0]!, ls[2]!, ls[3]!]; // swap the (0,1) sibling pair
    expect(merkleRoot(ls)).toBe(merkleRoot(siblingSwapped));
  });

  it('a different leaf SET changes the root', () => {
    expect(merkleRoot(leaves(4))).not.toBe(merkleRoot(leaves(5)));
  });
});
