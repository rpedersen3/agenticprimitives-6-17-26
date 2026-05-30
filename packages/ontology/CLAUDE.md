# @agenticprimitives/ontology — Claude guide

## What this package owns
- The **monorepo-wide formal vocabulary**, organized T-box / C-box / A-box
  (spec 225; ADR-0018), shipped as TTL/JSON-LD artifacts at the package root:
  - `context.jsonld` — namespace `@context`.
  - `tbox/*.ttl` — RDFS/OWL classes + properties.
  - `cbox/*.ttl` — SHACL shapes + SKOS controlled vocabularies (codelists).
  - `abox/` — example/fixture instances (tests + golden vectors only).
- A **declarative TS surface** (`src/index.ts`): typed IRI constants (`NS`,
  `CLASS`, `PREDICATE`, `SHAPE`), the shipped-artifact paths (`ARTIFACTS`),
  `ONTOLOGY_VERSION`, and `artifactPath()` to resolve them for a SPARQL/SHACL
  loader.

## What this package does NOT own
- **Runtime auth/policy/validation logic.** It is declarative. SHACL-engine
  validation over instances is Phase 2 (spec 225 §11), and even then it stays a
  validator, never an authority.
- The **runtime CAIP-10 builder** (`buildCaip10Address`) → `agent-profile`.
- The **types** (`CanonicalAgentId`, `Assurance`, …) → `@agenticprimitives/types`.
  This package names the IRIs; types owns the TS shapes. They mirror each other.
- The **live A-box graph** → projected by `identity-directory` (spec 223) onto a
  SPARQL store (GraphDB reference); this package ships only fixtures.
- On-chain enforcement (`OntologyTermRegistry`/`ShapeRegistry`) → `packages/contracts`
  (ADR-0009). This package is the off-chain source of truth it instantiates.

## Vocabulary
**Owns:** the `ap*:` IRI namespaces and every class/predicate/shape/codelist
under them (`Agent`, `CanonicalAgentId`, `Facet`, `Evidence`, `CredentialFacet`,
`NameFacet`, `OidcSubject`, `Org`; `agentKind`/`credentialKind`/`assurance`/
`controlStatus` codelists). As the vocabulary root it legitimately NAMES every
domain concept — that is its job; it does not USE them as runtime logic.
**Disambiguation:** `agentKind` (4 values, on-chain-bound) ≠ `profileType`
(6 values; agent-profile/HCS-11). See `docs/architecture/vocabulary-map.md`.

## Read these first (in order)
1. `capability.manifest.json` — boundary (vocabulary root; depends on nothing).
2. `../../specs/225-ontology.md` — the contract (T/C/A-box, namespaces, lockstep).
3. `../../docs/architecture/decisions/0018-agenticprimitives-wide-formal-ontology.md`
4. `../../docs/architecture/decisions/0009-on-chain-ontology-shacl-naming.md` — the on-chain peer.
5. `src/index.ts` — the IRI constants; then `tbox/` + `cbox/`.

## Stable public exports
- **Main entry (BROWSER-SAFE — pure IRIs, no Node builtins):** `NS` (namespace IRI
  map), `CLASS` / `PREDICATE` / `SHAPE` (IRI constants), `ONTOLOGY_VERSION`. This
  is what `identity-directory` (→ `connect` → browser apps) imports.
- **`/artifacts` subpath (NODE-ONLY — uses `node:url`/fs):** `ARTIFACTS` (relative
  paths of shipped TTL/JSON-LD) + `artifactPath(rel)` (→ absolute filesystem path).
  Import server-side only (a SPARQL loader / SHACL engine); never from browser code.

## Allowed imports
`node:url` (builtin, for `artifactPath`). Nothing from `@agenticprimitives/*` —
this is the vocabulary root; depending on a consumer would invert the graph.

## Forbidden imports
- `apps/*`
- **Every** `@agenticprimitives/*` package (including `types`).
- Heavy RDF/SHACL libs in the published surface — keep the package light; a
  SHACL engine is wired by the Phase-2 validator/consumers, not exported here.

## Drift triggers — STOP and route
- "Add a runtime validator / SHACL engine call here" — **STOP** until Phase 2,
  and even then it validates, never authorizes.
- "Add the CAIP-10 builder / a credential check" — **STOP.** Runtime CAIP-10 →
  `agent-profile`; auth → `connect`/`account-custody`.
- "Mirror a codelist as a TS `const` array here" — **STOP.** The `.ttl` C-box is
  the source of truth; a generator derives TS later (avoid hand-duplication).
- "Add marketplace/intents/geo vocabulary" — **STOP.** Out of the spec 225 §11
  scope bound (identity/credential/custody/delegation/audit/naming/org).

## Before you write code
- [ ] Is the change a vocabulary artifact (`tbox`/`cbox`/`abox`/`context`) or an
      IRI constant — not runtime logic?
- [ ] Did I keep `src/index.ts` declarative + dependency-light?
- [ ] If I added/renamed an IRI, does it stay in lockstep with the on-chain
      term (ADR-0009; the `atl:`⟷`ap*:` crosswalk, spec 225 §8) AND the
      `types` union it mirrors?
- [ ] Did I update `specs/225-ontology.md` if the namespace/shape set changed?

## Security invariants (DO NOT BREAK)
- **Declarative only.** No runtime auth/policy/validation that another package
  could mistake for authority.
- **One brand.** The CAIP-10 TS brand is `@agenticprimitives/types`'
  `CanonicalAgentId`; this package only names the IRI, never redefines the type.
- **Lockstep with on-chain.** A shape/predicate here must match its on-chain
  counterpart (spec 225 §8); drift is a finding.

## Validate the package
```bash
pnpm --filter @agenticprimitives/ontology typecheck
pnpm --filter @agenticprimitives/ontology test
pnpm check:forbidden-terms
```

## Common task routing
- New class/predicate → the right `tbox/*.ttl` + an IRI in `src/index.ts` (`CLASS`/`PREDICATE`).
- New shape → `cbox/*.shacl.ttl` + `SHAPE`. New codelist → `cbox/controlled-vocabularies.ttl`.
- External-standard mapping (HCS/ERC-8004) → `mappings/*.ttl` (spec 225 §9; spec 226).

## Capabilities this package participates in
- **Knowledge graph / vocabulary** — the shared T/C/A-box `identity-directory`
  (spec 223) conforms to; HCS/ERC-8004 mappings (spec 226).
- Index: [`docs/architecture/cross-cutting-capabilities.md`](../../docs/architecture/cross-cutting-capabilities.md).

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
