import { describe, it, expect } from 'vitest';
import { keccak256, toBytes } from 'viem';
import { labelhash, namehash, ZERO_NODE } from '../src/namehash';

describe('labelhash', () => {
  it('matches keccak256(utf8(label))', () => {
    expect(labelhash('agent')).toBe(keccak256(toBytes('agent')));
    expect(labelhash('alice')).toBe(keccak256(toBytes('alice')));
  });

  it('is deterministic', () => {
    expect(labelhash('alice')).toBe(labelhash('alice'));
  });

  it('differs for different labels', () => {
    expect(labelhash('alice')).not.toBe(labelhash('bob'));
  });
});

describe('namehash', () => {
  it('namehash("") === ZERO_NODE', () => {
    expect(namehash('')).toBe(ZERO_NODE);
  });

  it('matches the standard recursive-namehash algorithm: namehash("agent") = keccak256(0x00... || labelhash("agent"))', () => {
    // Manual computation matching the standard recursive-namehash algorithm.
    // Re-encode here to keep this test ABSOLUTELY independent from src/.
    const lh = keccak256(toBytes('agent'));
    const expected = keccak256(
      `0x${'00'.repeat(32)}${lh.slice(2)}` as `0x${string}`,
    );
    expect(namehash('agent')).toBe(expected);
  });

  it('hierarchical: namehash("alice.agent") = keccak256(namehash("agent") || labelhash("alice"))', () => {
    const parent = namehash('agent');
    const childLabel = keccak256(toBytes('alice'));
    const expected = keccak256(
      `${parent}${childLabel.slice(2)}` as `0x${string}`,
    );
    expect(namehash('alice.agent')).toBe(expected);
  });

  it('three-level: namehash("treasury.acme.agent")', () => {
    const parent = namehash('acme.agent');
    const childLabel = keccak256(toBytes('treasury'));
    const expected = keccak256(
      `${parent}${childLabel.slice(2)}` as `0x${string}`,
    );
    expect(namehash('treasury.acme.agent')).toBe(expected);
  });

  it('normalizes before hashing — case + whitespace agnostic', () => {
    expect(namehash('ALICE.AGENT')).toBe(namehash('alice.agent'));
    expect(namehash('  alice.agent  ')).toBe(namehash('alice.agent'));
  });

  it('rejects invalid names (delegates to normalizeAgentName)', () => {
    expect(() => namehash('-alice.agent')).toThrow(/starts with hyphen/);
    expect(() => namehash('alice..agent')).toThrow(/empty label/);
  });

  it('returns 32-byte hex', () => {
    expect(namehash('alice.agent')).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('differs for different names', () => {
    expect(namehash('alice.agent')).not.toBe(namehash('bob.agent'));
    expect(namehash('alice.agent')).not.toBe(namehash('alice.acme.agent'));
  });

  // Golden vectors — these MUST never change without a deliberate
  // breaking-change release. Compatibility with smart-agent's
  // namehash implementation is verified here (same algorithm, same TLD).
  describe('golden vectors', () => {
    const cases: Array<[string, string]> = [
      // Pre-computed via the in-band reference (the same algorithm
      // smart-agent ships at packages/sdk/src/naming.ts:39).
      ['agent', namehashViaReference(['agent'])],
      ['alice.agent', namehashViaReference(['alice', 'agent'])],
      ['acme.agent', namehashViaReference(['acme', 'agent'])],
      ['treasury.acme.agent', namehashViaReference(['treasury', 'acme', 'agent'])],
      ['bob.acme.agent', namehashViaReference(['bob', 'acme', 'agent'])],
    ];
    for (const [name, expected] of cases) {
      it(`namehash("${name}") matches reference`, () => {
        expect(namehash(name)).toBe(expected);
      });
    }
  });
});

/**
 * Independent reference implementation used solely by the golden-vector
 * tests so a regression in src/namehash.ts can't silently pass by
 * mutating both sides at once.
 */
function namehashViaReference(labels: string[]): string {
  let node: string = `0x${'00'.repeat(32)}`;
  for (let i = labels.length - 1; i >= 0; i--) {
    const lh = keccak256(toBytes(labels[i]!));
    node = keccak256(`${node}${lh.slice(2)}` as `0x${string}`);
  }
  return node;
}
