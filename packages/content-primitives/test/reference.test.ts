import { describe, it, expect } from 'vitest';
import { keccak256, concat, toBytes } from 'viem';
import { jcsCanonicalize } from '@agenticprimitives/verifiable-credentials';
import { computeCanonicalId, canonicalReference, corpusRef, LOCUS_ID_SCHEME } from '../src/reference.js';
import type { CanonicalLocusEnvelope } from '../src/types.js';

const envelope = (locus: Record<string, unknown>): CanonicalLocusEnvelope => ({
  idScheme: LOCUS_ID_SCHEME,
  contentDomain: 'scripture',
  locusProfile: 'ap.scripture.locus.v1',
  canonicalLocus: locus,
});

const john = envelope({ kind: 'scripture.locus', work: 'bible.book.john', canon: 'bible.protestant-66', versification: 'kjv-v1', locusType: 'verse', chapter: 3, verse: 16 });

describe('computeCanonicalId (domain-separated envelope hash)', () => {
  it('matches keccak256(DOMAIN_SEP || JCS(envelope))', () => {
    const expected = keccak256(concat([toBytes('ap:canonical-locus-id:v1\0'), toBytes(jcsCanonicalize(john))]));
    expect(computeCanonicalId(john)).toBe(expected);
  });

  it('is key-order independent (JCS)', () => {
    const reordered = envelope({ verse: 16, chapter: 3, locusType: 'verse', versification: 'kjv-v1', canon: 'bible.protestant-66', work: 'bible.book.john', kind: 'scripture.locus' });
    expect(computeCanonicalId(john)).toBe(computeCanonicalId(reordered));
  });

  it('commits to the locus PROFILE (different profile → different id)', () => {
    const v2 = { ...john, locusProfile: 'ap.scripture.locus.v2' };
    expect(computeCanonicalId(john)).not.toBe(computeCanonicalId(v2));
  });

  it('versification is the governance seam', () => {
    const other = envelope({ ...john.canonicalLocus, versification: 'vulgate-v1' });
    expect(computeCanonicalId(john)).not.toBe(computeCanonicalId(other));
  });

  it('undefined fields do not shift the id', () => {
    const withUndef = envelope({ ...john.canonicalLocus, note: undefined });
    expect(computeCanonicalId(withUndef)).toBe(computeCanonicalId(john));
  });
});

describe('canonicalReference', () => {
  it('carries the id, envelope, and optional alias', () => {
    const ref = canonicalReference(john, 'scripture:john.3.16');
    expect(ref.id).toBe(computeCanonicalId(john));
    expect(ref.alias).toBe('scripture:john.3.16');
    expect(ref.envelope.locusProfile).toBe('ap.scripture.locus.v1');
  });
});

describe('corpusRef', () => {
  it('is casing-independent on the issuer address', () => {
    const lower = corpusRef('0xabcabcabcabcabcabcabcabcabcabcabcabcabca', 'bsb', '2023');
    const mixed = corpusRef('0xABCabcABCabcABCabcABCabcABCabcABCabcABCA', 'bsb', '2023');
    expect(lower).toBe(mixed);
  });
});
