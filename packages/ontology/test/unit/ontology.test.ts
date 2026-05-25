import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { NS, CLASS, PREDICATE, SHAPE, ARTIFACTS, ONTOLOGY_VERSION, artifactPath } from '../../src/index.js';

describe('ontology IRI constants', () => {
  it('namespaces share the pinned base', () => {
    for (const iri of Object.values(NS)) {
      expect(iri).toMatch(/^https:\/\/agenticprimitives\.dev\/ns\/[a-z]+#$/);
    }
  });

  it('CanonicalAgentId class IRI is under the core namespace', () => {
    expect(CLASS.CanonicalAgentId).toBe(`${NS.ap}CanonicalAgentId`);
    expect(CLASS.Agent).toBe(`${NS.ap}Agent`);
  });

  it('predicates + shapes resolve to absolute IRIs', () => {
    expect(PREDICATE.isFacetOf).toMatch(/#isFacetOf$/);
    expect(SHAPE.CanonicalAgentId).toMatch(/#CanonicalAgentIdShape$/);
  });

  it('exposes a version', () => {
    expect(ONTOLOGY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('shipped artifacts', () => {
  it('every declared artifact resolves to a readable file', () => {
    const all = [ARTIFACTS.context, ...ARTIFACTS.tbox, ...ARTIFACTS.cbox];
    for (const rel of all) {
      const abs = artifactPath(rel);
      const contents = readFileSync(abs, 'utf8');
      expect(contents.length).toBeGreaterThan(0);
    }
  });

  it('the CanonicalAgentId SHACL shape bakes the namespace allowlist into its pattern', () => {
    const shacl = readFileSync(artifactPath(ARTIFACTS.cbox[0]), 'utf8');
    expect(shacl).toContain('eip155|hedera|solana');
    expect(shacl).toContain('CanonicalAgentIdShape');
  });

  it('context.jsonld binds the ap core prefix to the pinned base', () => {
    const ctx = JSON.parse(readFileSync(artifactPath(ARTIFACTS.context), 'utf8'));
    expect(ctx['@context'].ap).toBe(NS.ap);
  });
});
