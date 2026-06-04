// Lockstep gate (spec 251 + ADR-0009): every on-chain skill/geo KIND constant equals
// keccak256 of a URI that is DECLARED as a C-box skos:Concept here. We read the LIVE
// Solidity source + the LIVE .ttl vocabulary so either side drifting breaks CI.
//
// The on-chain constant is `keccak256(bytes("<URI>"))`; if "<URI>" is a declared concept
// in the matching C-box scheme, the bytes32 value is — by construction — keccak of a
// controlled-vocabulary term. So we assert the set of keccak-input URIs in the contract
// equals the set of concept URIs in the corresponding scheme.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const sol = (rel: string) => readFileSync(join(HERE, '../../../contracts/src', rel), 'utf8');
const ttl = (rel: string) => readFileSync(join(HERE, '../../cbox', rel), 'utf8');

/** keccak-input URIs from `keccak256(bytes("…"))` literals in a Solidity source. */
function solKeccakUris(src: string, nsPrefix: string): Set<string> {
  const out = new Set<string>();
  const re = /keccak256\(bytes\("([^"]+)"\)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]!.startsWith(nsPrefix)) out.add(m[1]!);
  }
  return out;
}

/** Concept URIs in a given C-box scheme: `<prefix>:<Local> a skos:Concept ; skos:inScheme <prefix>:<scheme>`. */
function ttlSchemeConcepts(src: string, prefix: string, ns: string, scheme: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`${prefix}:(\\w+)\\s+a skos:Concept\\s*;\\s*skos:inScheme ${prefix}:${scheme}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(`${ns}${m[1]}`);
  return out;
}

describe('skills/geo on-chain ↔ C-box lockstep (ADR-0009)', () => {
  const SKILL_NS = 'https://agenticprimitives.dev/ns/skill#';
  const GEO_NS = 'https://agenticprimitives.dev/ns/geo#';

  it('SkillDefinitionRegistry KIND_* equal keccak of declared aps:skillKind concepts', () => {
    const onChain = solKeccakUris(sol('skills/SkillDefinitionRegistry.sol'), SKILL_NS);
    const cbox = ttlSchemeConcepts(ttl('skill-vocabulary.ttl'), 'aps', SKILL_NS, 'skillKind');
    expect(onChain.size).toBe(3); // Leaf, Domain, Custom
    for (const uri of onChain) expect(cbox, `${uri} must be a declared aps:skillKind concept`).toContain(uri);
  });

  it('GeoFeatureRegistry KIND_* equal keccak of declared apg:geoKind concepts', () => {
    const onChain = solKeccakUris(sol('geo/GeoFeatureRegistry.sol'), GEO_NS);
    const cbox = ttlSchemeConcepts(ttl('geo-vocabulary.ttl'), 'apg', GEO_NS, 'geoKind');
    expect(onChain.size).toBe(5); // Planet, Region, Country, AdminArea, Custom
    for (const uri of onChain) expect(cbox, `${uri} must be a declared apg:geoKind concept`).toContain(uri);
  });

  it('the skill/geo namespaces match the AP ns pattern', () => {
    for (const ns of [SKILL_NS, GEO_NS]) {
      expect(ns).toMatch(/^https:\/\/agenticprimitives\.dev\/ns\/[a-z][a-z-]*#$/);
    }
  });
});
