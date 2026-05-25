// @agenticprimitives/ontology — the monorepo-wide formal vocabulary.
//
// This package is DECLARATIVE: it ships the RDFS/OWL T-box + SHACL/SKOS C-box
// artifacts (the source of truth) and exposes their stable IRIs + paths as
// typed constants. It has NO runtime auth/policy logic and depends on nothing
// (the vocabulary root — ADR-0018; spec 225). SHACL-engine validation over
// arbitrary instances is Phase 2 (spec 225 §11).
//
// See:
//   - ../../specs/225-ontology.md — the contract
//   - ../../docs/architecture/decisions/0018-agenticprimitives-wide-formal-ontology.md
//   - ../../docs/architecture/decisions/0009-on-chain-ontology-shacl-naming.md (the on-chain peer)

import { fileURLToPath } from 'node:url';

/** Bumped on any breaking change to the shipped vocabulary. */
export const ONTOLOGY_VERSION = '0.1.0' as const;

/**
 * Namespace IRIs, split per domain (mirrors the reference
 * `smartagent.io/ontology/<domain>#` scheme; spec 225 §4). Pinned base:
 * `https://agenticprimitives.dev/ns/`.
 */
export const NS = {
  ap: 'https://agenticprimitives.dev/ns/core#',
  apid: 'https://agenticprimitives.dev/ns/identity#',
  apcr: 'https://agenticprimitives.dev/ns/credential#',
  apdel: 'https://agenticprimitives.dev/ns/delegation#',
  apcus: 'https://agenticprimitives.dev/ns/custody#',
  apaud: 'https://agenticprimitives.dev/ns/audit#',
  apnam: 'https://agenticprimitives.dev/ns/naming#',
  aprel: 'https://agenticprimitives.dev/ns/relationships#',
  aporg: 'https://agenticprimitives.dev/ns/org#',
} as const;

/** Class IRIs (T-box). Each is `<namespace><LocalName>`. */
export const CLASS = {
  Agent: `${NS.ap}Agent`,
  CanonicalAgentId: `${NS.ap}CanonicalAgentId`,
  Facet: `${NS.ap}Facet`,
  Evidence: `${NS.ap}Evidence`,
  CredentialFacet: `${NS.apcr}CredentialFacet`,
  NameFacet: `${NS.apnam}NameFacet`,
  OidcSubject: `${NS.apid}OidcSubject`,
  Org: `${NS.aporg}Org`,
} as const;

/** Predicate / property IRIs (T-box). */
export const PREDICATE = {
  isFacetOf: `${NS.apid}isFacetOf`,
  controls: `${NS.apcr}controls`,
  hasEvidence: `${NS.ap}hasEvidence`,
  assurance: `${NS.ap}assurance`,
  controlStatus: `${NS.ap}controlStatus`,
  resolvesTo: `${NS.apnam}resolvesTo`,
  memberOf: `${NS.aporg}memberOf`,
  delegatesTo: `${NS.apdel}delegatesTo`,
} as const;

/** SHACL shape IRIs (C-box). */
export const SHAPE = {
  CanonicalAgentId: `${NS.ap}CanonicalAgentIdShape`,
  CredentialFacet: `${NS.apcr}CredentialFacetShape`,
} as const;

/**
 * Relative paths (from the package root) of the shipped vocabulary artifacts.
 * Resolve to an absolute filesystem path with {@link artifactPath} and load
 * into a SPARQL store / SHACL engine.
 */
export const ARTIFACTS = {
  context: 'context.jsonld',
  tbox: ['tbox/core.ttl', 'tbox/identity.ttl'],
  cbox: ['cbox/canonical-agent-id-shape.shacl.ttl', 'cbox/controlled-vocabularies.ttl'],
} as const;

/**
 * Resolve a shipped artifact's relative path (see {@link ARTIFACTS}) to an
 * absolute filesystem path. Works in dev (running from `src/`) and after build
 * (from `dist/`) — the artifacts ship at the package root in both cases.
 */
export function artifactPath(relativePath: string): string {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
}
