// Verifiable-content substrate vocabulary (spec 266; ADR-0033). Asserts the
// apcnt: IRI surface, the C-box codelists, and that the ContentDescriptor shape
// bakes in R3 (a descriptor carries a retrievalPointer, never inline text).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { NS, CLASS, PREDICATE, SHAPE } from '../../src/index.js';
import { ARTIFACTS, artifactPath } from '../../src/artifacts.js';

const ttl = (rel: string) => readFileSync(artifactPath(rel), 'utf8');

describe('verifiable-content vocabulary (spec 266)', () => {
  it('apcnt namespace matches the AP ns pattern', () => {
    expect(NS.apcnt).toBe('https://agenticprimitives.dev/ns/content#');
    expect(NS.apcnt).toMatch(/^https:\/\/agenticprimitives\.dev\/ns\/[a-z][a-z-]*#$/);
  });

  it('FRBR classes resolve under apcnt', () => {
    expect(CLASS.CanonicalLocus).toBe(`${NS.apcnt}CanonicalLocus`);
    expect(CLASS.CorpusManifest).toBe(`${NS.apcnt}CorpusManifest`);
    expect(CLASS.ContentDescriptor).toBe(`${NS.apcnt}ContentDescriptor`);
    expect(CLASS.CitationAssertion).toBe(`${NS.apcnt}CitationAssertion`);
    expect(CLASS.Entitlement).toBe(`${NS.apcnt}Entitlement`);
  });

  it('core predicates + the descriptor shape resolve', () => {
    expect(PREDICATE.commitsTo).toMatch(/#commitsTo$/);
    expect(PREDICATE.retrievalPointer).toMatch(/#retrievalPointer$/);
    expect(PREDICATE.corpusRoot).toMatch(/#corpusRoot$/);
    expect(SHAPE.ContentDescriptor).toMatch(/#ContentDescriptorShape$/);
  });

  it('declares the accessPolicy + proofPolicy codelists in the C-box', () => {
    const cbox = ttl('cbox/content-vocabulary.ttl');
    for (const c of ['apcnt:Public', 'apcnt:Licensed', 'apcnt:Private']) expect(cbox).toContain(c);
    for (const c of ['apcnt:Signature', 'apcnt:MerkleInclusion', 'apcnt:Zk']) expect(cbox).toContain(c);
  });

  it('ContentDescriptorShape bakes in ADR-0033 R3 (retrievalPointer, never text)', () => {
    const cbox = ttl('cbox/content-vocabulary.ttl');
    expect(cbox).toContain('ContentDescriptorShape');
    expect(cbox).toContain('apcnt:retrievalPointer');
    expect(cbox).toMatch(/NEVER the rendering text/i);
  });

  it('the content TTL artifacts are registered + readable', () => {
    expect(ARTIFACTS.tbox).toContain('tbox/content.ttl');
    expect(ARTIFACTS.cbox).toContain('cbox/content-vocabulary.ttl');
    expect(ttl('tbox/content.ttl').length).toBeGreaterThan(0);
  });
});
