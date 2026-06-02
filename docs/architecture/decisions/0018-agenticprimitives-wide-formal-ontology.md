# ADR-0018 — A formal, monorepo-wide ontology (RDFS/OWL/SHACL) in its own package

**Status:** Accepted (2026-05-25).
**Related:** [spec 225](../../../specs/225-ontology.md), [spec 223](../../../specs/223-identity-directory.md), [ADR-0009](./0009-on-chain-ontology-shacl-naming.md), [ADR-0010](./0010-smart-agent-canonical-identifier.md), [ADR-0016](./0016-canonical-agent-id-is-the-sso-subject.md), [spec 226](../../../specs/226-hcs-alignment-and-standards.md).

---

## Context

agenticprimitives has a rich, recurring concept vocabulary — Agent, Credential,
Name, Delegation, Caveat, Custodian, Trustee, Org, Tool, Audit event, OIDC
subject — that today lives implicitly across `specs/`, `CLAUDE.md` files, and
`docs/architecture/vocabulary-map.md`. As the SSO wave adds a directory + graph,
we need a **machine-readable, validated vocabulary** so that: (a) the directory
can project instances and check them; (b) cross-package vocabulary stays
consistent (the firewall becomes checkable, not just prose); (c) we can align
with external standards (Hashgraph Online HCS, ERC-8004) by mapping IRIs. An
ontology scoped to "identity" only would under-serve this — the concepts span
the whole monorepo.

An **on-chain** ontology already exists ([ADR-0009](./0009-on-chain-ontology-shacl-naming.md)):
`OntologyTermRegistry` + `ShapeRegistry` govern permitted predicates + SHACL-style
shapes for naming/relationships/identity and emit a knowledge-graph mirror event
feed. What is missing is the **canonical off-chain formal vocabulary** those
contracts instantiate — the source of the IRIs, datatypes, and shapes — with a
home that spans the whole monorepo, not just the on-chain trust-fabric records.
This ADR adds that; it does not unwind ADR-0009.

## Decision

> **Adopt a single, formal, monorepo-wide ontology expressed in RDFS/OWL for the
> vocabulary and SHACL for instance shapes, shipped as its own package
> `@agenticprimitives/ontology`. It is the shared vocabulary every other package
> references; it does not depend on any other `@agenticprimitives/*` package.**

- The ontology defines **classes** (Agent, CredentialFacet, NameFacet,
  OidcSubject, Org, Delegation, Caveat, Custodian, Trustee, AuditEvent, …) and
  **predicates/edges** (controls, isFacetOf, memberOf, delegatesTo,
  hasEvidence, …) with stable IRIs under one namespace.
- **SHACL shapes** validate instances (e.g. a `CanonicalAgentId` is a CAIP-10
  string; a `CredentialFacet` must reference exactly one `Agent`).
- **Organized as T-box / C-box / A-box**, mirroring the reference work
  ([`agentictrustlabs/smart-agent/docs/ontology`](https://github.com/agentictrustlabs/smart-agent/tree/master/docs/ontology)):
  T-box = OWL/RDFS schema (per-domain `.ttl`); C-box = SHACL shapes **plus
  controlled-vocabulary codelists** (closed enum/SKOS sets); A-box = instances.
  The live A-box knowledge graph runs on a SPARQL triple store (reference:
  Ontotext GraphDB, per `agent-explorer/docs/graphdb`) behind the directory's
  `IndexerPort` — an explicit indexer, ADR-0012-compliant. See [spec 225](../../../specs/225-ontology.md).
- The package ships the ontology **artifacts** (Turtle / JSON-LD) plus a thin TS
  surface to load IRIs and run SHACL validation. It is a near-leaf:
  `@agenticprimitives/ontology` → (no internal deps).
- `identity-directory` and other consumers **conform to** the ontology; they do
  not define their own. The directory's graph nodes/edges are ontology
  instances.
- The ontology is the home for **external-standard mappings**: `owl:sameAs` /
  `rdfs:seeAlso` links to HCS concepts ([spec 226](../../../specs/226-hcs-alignment-and-standards.md))
  and ERC-8004, so alignment + divergence are expressed formally, not only in
  prose.
- **Pairs with the on-chain ontology ([ADR-0009](./0009-on-chain-ontology-shacl-naming.md)),
  does not replace it.** ADR-0009's `OntologyTermRegistry` / `ShapeRegistry` are
  the **on-chain governance + enforcement + KG-mirror** of the vocabulary
  (per-chain, governed, fail-closed at the chain edge). `@agenticprimitives/ontology`
  is the **canonical off-chain formal vocabulary** they instantiate: each on-chain
  term's `(curie, uri)` references an IRI defined here, and on-chain shapes match
  shapes here. Off-chain RDF/SHACL is the source of truth for the *vocabulary*;
  the on-chain registry is the source of truth for *what is currently permitted
  on a given chain*. The two are kept in lockstep.

### Forbidden

- A second, package-local ontology (e.g. an `ontology` subpath inside
  `identity-directory`). One ontology, one package.
- The ontology depending on any `@agenticprimitives/*` package (it is the
  vocabulary root; depending on consumers would invert the graph).
- Treating the ontology as runtime authority — it validates and names; it does
  not grant custody or mint identity.
- Drifting the off-chain vocabulary from the on-chain `OntologyTermRegistry` /
  `ShapeRegistry` ([ADR-0009](./0009-on-chain-ontology-shacl-naming.md)): a
  predicate registered on chain MUST have an IRI here, and a shape here MUST
  match its on-chain counterpart. Lockstep, not two sources of truth. The
  mechanism (the `atl:`⟷`ap*:` CURIE crosswalk + the precise definition of "shape
  match") is in [spec 225 §8](../../../specs/225-ontology.md); the
  `check:ontology-lockstep` CI gate enforces it once code + a deployed registry
  exist.

## Acknowledgment 2026-06-02b — v2 coordination substrate vocabulary IS monorepo-wide

When this ADR was originally accepted, "monorepo-wide" effectively meant the
identity / credential / custody / delegation / audit / naming / org substrate
that existed at the time. The v2 coordination substrate introduced by
[ADR-0024](./0024-intent-coordination-substrate.md) (15-layer spine; six W1
packages) materially expands the substrate's scope with **intent / constraint /
resolution / agreement / payment / fulfillment / attestation** vocabulary.

This ADR's "monorepo-wide formal ontology" claim **explicitly covers** that v2
vocabulary. The T-box class definitions for the v2 spine live in this package
under `tbox/intents.ttl`, `tbox/constraints.ttl`, `tbox/resolution.ttl`,
`tbox/agreement.ttl`, `tbox/payment.ttl`, `tbox/fulfillment.ttl`, and
`tbox/attestation.ttl`. Cross-standard crosswalks live in
`mappings/spine-standards.ttl`.

**What does NOT change.** The runtime SHACL shapes for these vocabularies live
in their owning packages (`intent-marketplace`, `agreements`, `payments`,
`fulfillment`, `attestations`, `mcp-runtime`) per [PD-19](../../../apps/demo-jp/docs/packages.md).
The hybrid model — T-box centralized; SHACL shapes distributed — preserves the
"one ontology, one package" property (the ontology root) while keeping
runtime-validation concerns local to each package's flows.

**Reference:**
- [spec 225 §11.5](../../../specs/225-ontology.md) — scope expansion
- [docs/architecture/spine-ontology-extensions.md](../spine-ontology-extensions.md) — TTL drafts + migration plan
- [docs/architecture/coordination-substrate.md](../coordination-substrate.md) — 15-layer spine
- [ADR-0024](./0024-intent-coordination-substrate.md) — substrate decisions

## Consequences

**Positive:** vocabulary becomes machine-checkable and externally mappable; the
vocabulary firewall gains a formal backstop; the directory + SSO + future
packages share one source of truth for concept names; HCS/ERC-8004 alignment has
a formal home.

**Negative:** RDFS/OWL/SHACL is a new toolchain and skillset in the repo
(candidate libs: `n3`, `rdf-ext`, a SHACL engine) — pin the choice in spec 225;
the ontology must be versioned and kept in lockstep with the prose vocabulary
map, or the two drift. Initial scope must be bounded (identity + custody +
delegation + audit first) to avoid boiling the ocean.

## Cross-references

- [spec 225 — ontology](../../../specs/225-ontology.md)
- [spec 223 — identity-directory](../../../specs/223-identity-directory.md) (first consumer)
- [spec 226 — HCS alignment & standards](../../../specs/226-hcs-alignment-and-standards.md) (external mapping)
- `docs/architecture/vocabulary-map.md` (the prose peer the ontology formalizes)
