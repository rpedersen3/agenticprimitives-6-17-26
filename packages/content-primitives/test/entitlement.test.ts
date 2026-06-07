import { describe, it, expect } from 'vitest';
import type { Hex } from 'viem';
import { evaluateEntitlement, buildCitationAssertion } from '../src/entitlement.js';
import { contentCommitment } from '../src/descriptor.js';
import { buildInclusionZkProof, bindPaymentMandate } from '../src/reserved.js';
import type { Entitlement } from '../src/types.js';

const CORPUS = ('0x' + 'cc'.repeat(32)) as Hex;
const OTHER = ('0x' + 'dd'.repeat(32)) as Hex;
const NOW = 1_900_000_000;

const ent = (overrides: Partial<Entitlement['credentialSubject']> = {}, validUntil?: string): Entitlement => ({
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential', 'Entitlement'],
  issuer: 'eip155:31337:0x2222222222222222222222222222222222222222',
  validFrom: '2020-01-01T00:00:00Z',
  ...(validUntil ? { validUntil } : {}),
  credentialSubject: { id: 'eip155:31337:0xreader', corpusRef: CORPUS, accessPolicy: 'licensed', ...overrides },
});

describe('evaluateEntitlement (fail-closed)', () => {
  it('public corpus needs no entitlement', () => {
    expect(evaluateEntitlement('public', CORPUS, undefined, NOW).decision).toBe('allow');
  });
  it('licensed corpus denies without an entitlement', () => {
    expect(evaluateEntitlement('licensed', CORPUS, undefined, NOW).decision).toBe('deny');
  });
  it('licensed corpus allows with a matching, unexpired entitlement', () => {
    expect(evaluateEntitlement('licensed', CORPUS, ent(), NOW).decision).toBe('allow');
  });
  it('denies an entitlement for a different corpus', () => {
    expect(evaluateEntitlement('licensed', OTHER, ent(), NOW).decision).toBe('deny');
  });
  it('denies an expired entitlement', () => {
    const past = new Date((NOW - 100) * 1000).toISOString();
    expect(evaluateEntitlement('licensed', CORPUS, ent({}, past), NOW).decision).toBe('deny');
  });
  it('denies an unknown access policy', () => {
    // @ts-expect-error testing the fail-closed default
    expect(evaluateEntitlement('weird', CORPUS, ent(), NOW).decision).toBe('deny');
  });
});

describe('buildCitationAssertion', () => {
  it('produces an enriched, unsigned CitationAssertion carrying provenance, never text', () => {
    const vc = buildCitationAssertion({
      issuer: 'did:web:scripture-resolver.agent',
      subjectId: 'urn:scripture:reader',
      canonicalId: ('0x' + 'aa'.repeat(32)) as Hex,
      descriptorId: 'desc_bsb_john_3_16',
      contentType: 'scripture.verse',
      citationKind: 'quote',
      commitment: contentCommitment('For God so loved the world'),
      commitmentVerified: true,
      contentIssuer: '0x2222222222222222222222222222222222222222',
      validFrom: '2026-06-07T00:00:00Z',
      agentRunId: 'run_123',
      outputId: 'out_456',
      normalizationSpec: 'ap:normalization:canonical-text-v1',
    });
    expect(vc.type).toContain('CitationAssertion');
    expect(vc.credentialSubject.citationKind).toBe('quote');
    expect(vc.credentialSubject.agentRunId).toBe('run_123');
    expect(vc.credentialSubject.commitmentVerified).toBe(true);
    expect('proof' in vc).toBe(false);
    expect(JSON.stringify(vc)).not.toMatch(/God so loved/); // no rendering text, only the commitment
  });
});

describe('reserved phase fns throw (no silent no-op)', () => {
  it('zk + payments are reserved', async () => {
    await expect(buildInclusionZkProof()).rejects.toThrow(/Phase 4/);
    expect(() => bindPaymentMandate()).toThrow(/Phase 5/);
  });
});
