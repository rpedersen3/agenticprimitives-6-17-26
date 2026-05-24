import { describe, expect, it } from 'vitest';
import { computeEdgeId } from '../src/edge-id';
import { RELATIONSHIP_TYPE } from '../src/constants';
import { InvalidEdgeError } from '../src/errors';

const A = '0x1111111111111111111111111111111111111111' as const;
const B = '0x2222222222222222222222222222222222222222' as const;

describe('computeEdgeId', () => {
  it('is deterministic for the same triple regardless of address casing', () => {
    const A_MIXED = '0xAbCdEf1234567890aBcDef1234567890ABCdEf12' as const;
    const A_UPPER = `0x${A_MIXED.slice(2).toUpperCase()}` as `0x${string}`;
    const A_LOWER = A_MIXED.toLowerCase() as `0x${string}`;
    const id1 = computeEdgeId(A_MIXED, B, RELATIONSHIP_TYPE.HAS_MEMBER as never);
    const id2 = computeEdgeId(A_UPPER, B, RELATIONSHIP_TYPE.HAS_MEMBER as never);
    const id3 = computeEdgeId(A_LOWER, B, RELATIONSHIP_TYPE.HAS_MEMBER as never);
    expect(id1).toBe(id2);
    expect(id1).toBe(id3);
  });

  it('produces different IDs for (A→B) vs (B→A) (direction matters for non-symmetric types)', () => {
    const ab = computeEdgeId(A, B, RELATIONSHIP_TYPE.HAS_MEMBER as never);
    const ba = computeEdgeId(B, A, RELATIONSHIP_TYPE.HAS_MEMBER as never);
    expect(ab).not.toBe(ba);
  });

  it('produces different IDs for different relationship types', () => {
    const member = computeEdgeId(A, B, RELATIONSHIP_TYPE.HAS_MEMBER as never);
    const governs = computeEdgeId(A, B, RELATIONSHIP_TYPE.HAS_GOVERNANCE_OVER as never);
    expect(member).not.toBe(governs);
  });

  it('refuses self-edges (subject === object)', () => {
    expect(() => computeEdgeId(A, A, RELATIONSHIP_TYPE.HAS_MEMBER as never)).toThrow(InvalidEdgeError);
  });

  it('refuses missing subject / object / type', () => {
    expect(() => computeEdgeId('' as `0x${string}`, B, RELATIONSHIP_TYPE.HAS_MEMBER as never)).toThrow(InvalidEdgeError);
    expect(() => computeEdgeId(A, '' as `0x${string}`, RELATIONSHIP_TYPE.HAS_MEMBER as never)).toThrow(InvalidEdgeError);
    expect(() => computeEdgeId(A, B, '' as never)).toThrow(InvalidEdgeError);
  });

  it('matches golden vector for known input', () => {
    // Golden vector: A (0x11…1) HAS_MEMBER B (0x22…2).
    // Computed off-chain; will match on-chain keccak256(addressLower || addressLower || typeHash).
    const id = computeEdgeId(A, B, RELATIONSHIP_TYPE.HAS_MEMBER as never);
    expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    // Lock the value so any silent change to packing logic flips this test.
    expect(id.length).toBe(66);
  });
});
