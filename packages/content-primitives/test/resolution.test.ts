import { describe, it, expect } from 'vitest';
import type { Hex } from 'viem';
import { resolveCandidates, type TrustProfileConfig } from '../src/resolution.js';
import { canonicalReference } from '../src/reference.js';
import type { ContentDescriptor } from '../src/types.js';

const TRUSTED = '0x1111111111111111111111111111111111111111' as const;
const UNTRUSTED = '0x9999999999999999999999999999999999999999' as const;

const env = (locus: Record<string, unknown>) => ({
  idScheme: 'ap-locus-id-v1',
  contentDomain: 'scripture',
  locusProfile: 'ap.scripture.locus.v1',
  canonicalLocus: locus,
});
const ref = canonicalReference(env({ kind: 'scripture.locus', work: 'bible.book.john', canon: 'bible.protestant-66', versification: 'kjv-v1', locusType: 'verse', chapter: 3, verse: 16 }));

function desc(overrides: Partial<ContentDescriptor>): ContentDescriptor {
  return {
    id: 'd',
    canonicalId: ref.id,
    contentType: 'scripture.verse',
    issuer: { address: TRUSTED },
    issuedAt: '2026-06-07T00:00:00Z',
    status: 'active',
    work: { language: 'en', rightsStatus: 'public-domain' },
    retrievalPointer: 'content://x',
    proofPolicy: 'issuer-signature-and-hash-v1',
    accessPolicy: 'public',
    signature: '0x' as Hex,
    ...overrides,
  };
}

const profile: TrustProfileConfig = {
  profile: 'public-domain-demo',
  trustedIssuers: [TRUSTED],
  allowedRightsStatus: ['public-domain'],
  requireTrustedIssuer: true,
};

describe('resolveCandidates (multi-candidate, policy-aware)', () => {
  it('returns ALL descriptors for the locus as candidates (not one official answer)', () => {
    const r = resolveCandidates(ref, [desc({ id: 'a' }), desc({ id: 'b', issuer: { address: UNTRUSTED } })], profile);
    expect(r.candidates).toHaveLength(2);
  });

  it('admits a trusted, public-domain candidate', () => {
    const r = resolveCandidates(ref, [desc({ id: 'a' })], profile);
    expect(r.candidates[0]!.admitted).toBe(true);
    expect(r.candidates[0]!.issuerTrusted).toBe(true);
  });

  it('screens out an untrusted issuer under requireTrustedIssuer', () => {
    const r = resolveCandidates(ref, [desc({ id: 'b', issuer: { address: UNTRUSTED } })], profile);
    expect(r.candidates[0]!.admitted).toBe(false);
    expect(r.candidates[0]!.reason).toMatch(/allowlist/);
  });

  it('screens out non-permitted rights status', () => {
    const r = resolveCandidates(ref, [desc({ id: 'c', work: { rightsStatus: 'licensed' } })], profile);
    expect(r.candidates[0]!.admitted).toBe(false);
    expect(r.candidates[0]!.reason).toMatch(/rightsStatus/);
  });

  it('screens out revoked descriptors', () => {
    const r = resolveCandidates(ref, [desc({ id: 'd', status: 'revoked' })], profile);
    expect(r.candidates[0]!.admitted).toBe(false);
  });

  it('ignores descriptors for a different canonical locus', () => {
    const other = canonicalReference(env({ kind: 'scripture.locus', work: 'bible.book.rom', canon: 'bible.protestant-66', versification: 'kjv-v1', locusType: 'verse', chapter: 8, verse: 28 }));
    const r = resolveCandidates(ref, [desc({ id: 'x', canonicalId: other.id })], profile);
    expect(r.candidates).toHaveLength(0);
  });
});
