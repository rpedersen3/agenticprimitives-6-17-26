// AUDIT NEW-RAG-2 — the related-agent write challenge must bind content + person + agent + nonce + expiry,
// so a captured signature can't be replayed for a different write, a different content, or forever.
import { describe, it, expect } from 'vitest';
import { relatedAgentWriteContentHash, hashRelatedAgentWriteChallenge } from '../../src/index';

const A = (h: string) => (`0x${h.repeat(40).slice(0, 40)}`) as `0x${string}`;
const PERSON = A('a');
const ORG = A('b');
const N = (h: string) => (`0x${h.repeat(64).slice(0, 64)}`) as `0x${string}`;
const base = { orgAgent: ORG, orgName: 'lbsb', purpose: 'jp-adopter-org', requestedBy: 'demo-jp' };

describe('relatedAgentWriteContentHash', () => {
  it('is deterministic for the same content', () => {
    expect(relatedAgentWriteContentHash(base)).toBe(relatedAgentWriteContentHash({ ...base }));
  });
  it('changes when ANY content field changes (binds the exact write)', () => {
    const h0 = relatedAgentWriteContentHash(base);
    expect(relatedAgentWriteContentHash({ ...base, orgName: 'other' })).not.toBe(h0);
    expect(relatedAgentWriteContentHash({ ...base, purpose: 'jp-facilitator-org' })).not.toBe(h0);
    expect(relatedAgentWriteContentHash({ ...base, requestedBy: 'demo-gs' })).not.toBe(h0);
    expect(relatedAgentWriteContentHash({ ...base, orgAgent: A('c') })).not.toBe(h0);
  });
});

describe('hashRelatedAgentWriteChallenge', () => {
  const c = relatedAgentWriteContentHash(base);
  const args = { person: PERSON, orgAgent: ORG, contentHash: c, nonce: N('11'), expiry: 1_700_000_300 };

  it('is deterministic', () => {
    expect(hashRelatedAgentWriteChallenge(args)).toBe(hashRelatedAgentWriteChallenge({ ...args }));
  });
  it('changes with nonce (one-shot), expiry, content, person, and agent', () => {
    const h0 = hashRelatedAgentWriteChallenge(args);
    expect(hashRelatedAgentWriteChallenge({ ...args, nonce: N('22') })).not.toBe(h0);
    expect(hashRelatedAgentWriteChallenge({ ...args, expiry: args.expiry + 1 })).not.toBe(h0);
    expect(hashRelatedAgentWriteChallenge({ ...args, contentHash: relatedAgentWriteContentHash({ ...base, orgName: 'x' }) })).not.toBe(h0);
    expect(hashRelatedAgentWriteChallenge({ ...args, person: A('9') })).not.toBe(h0);
    expect(hashRelatedAgentWriteChallenge({ ...args, orgAgent: A('9') })).not.toBe(h0);
  });
  it('is NOT the old constant challenge (no cross-format collision)', () => {
    // Sanity: the v2 digest is domain-tagged, so it can never equal the legacy constant.
    expect(hashRelatedAgentWriteChallenge(args)).not.toBe(N('00'));
  });
});
