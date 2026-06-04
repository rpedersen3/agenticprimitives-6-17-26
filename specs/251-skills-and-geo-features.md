# Spec 251 — Generic skills + geo substrate (definitions + agent claims)

**Status:** draft, 2026-06-03.
**Owner:** `packages/contracts` (`src/skills/`, `src/geo/`) + `packages/ontology` (T-box/C-box) + future
SDKs (`@agenticprimitives/agent-skills`, `@agenticprimitives/geo-features`).
**Architecture-of-record:** the **Skills & Geo C-Box plan** (Rich Pedersen, 2026-06-03) + [ADR-0018]
(C-box = SHACL + controlled-vocabulary codelists) + [ADR-0009] (on-chain ontology enforcement via
OntologyTermRegistry / ShapeRegistry / AttributeStorage) + [ADR-0010] (Smart Agent address is canonical).
**Domain consumer:** `apps/demo-gs` (spec 250) is the first domain projection over this substrate.

## Thesis — three layers

```
C-box (ontology)        controlled vocabularies + SHACL shapes (skill kinds, geo kinds, relations,
                        visibility modes, proficiency labels) — VOCABULARY, not user data
   │
   ▼
Public definitions      versioned, public, indexable anchors ON CHAIN: id, version, steward, kind,
(on chain)              content hash / merkle root (geometry hash for geo), metadata URI, validity
   │                    │
   │                    └──► a credential's claimed skill/geo POINTS HERE by (definitionId, version)
   ▼
Agent claims            PRIVATE verifiable credentials in the org's / person's VAULT (spec 247):
(OFF chain — vault)     "this SA HAS a skill / SERVES a geo feature", referencing the on-chain
                        definition id+version. The agent↔definition ASSOCIATION is NEVER on chain by
                        default. Optional public assertion is opt-in via the EXISTING generic
                        AttestationRegistry (a credential hash), not a skill/geo-specific contract.
```

**Definitions are separate from claims — and live in different places.** A *definition* is a public,
versioned, on-chain vocabulary anchor (the skill/geo feature, incl. geo geometry hashes). A *claim* (the
**association** of a Person/Org/Service SA to a definition) is a **private verifiable credential in that
agent's vault** that points to the on-chain `(definitionId, version)`. **Geometry can be on chain; the
org/person association must be off chain.** There is **no on-chain skill/geo claim registry.**

## Rules (the boundary — non-negotiable)

1. **C-box is vocabulary, not user data.** Skill kinds, skill relations, geo kinds, geo relations,
   visibility modes, proficiency labels, claim relation types → `packages/ontology` T-box/C-box.
2. **On-chain definitions are public/versioned anchors.** Small, stable, indexable public facts only.
3. **Claims are separate from definitions AND are off-chain.** A claim (agent↔definition association) is a
   private verifiable credential in the agent's vault (spec 247), pointing to an on-chain
   `(definitionId, version)` and carrying issuer, evidence, visibility, validity, revocation in the
   credential body. It is NOT an on-chain row. Public assertion (rare, opt-in) reuses the generic
   `AttestationRegistry` credential-hash path — never a skill/geo-specific contract.
4. **Everything is keyed by Smart Agent ADDRESS**, never names as authority (ADR-0010). Names are optional
   facets (a future `.skill` / geo name bind), never the key.
5. **Exact geometry stays off chain.** On chain: a `geometryHash` + coverage/source merkle roots + a
   coarse centroid/bbox for UI only. The GeoJSON lives behind `metadataURI`.
6. **Domain-specific A-box facts stay out of `packages/contracts`.** A domain app may publish a *generic*
   skill / geo / attestation / credential hash whose *content* is faith-based — the reusable
   contract/package name + schema MUST stay neutral.
7. **Sanitized, neutral metadata.** On-chain skill + geo definitions (incl. `metadataURI`, `conceptHash`,
   `geometryHash`) carry only neutral, public, non-operational vocabulary. A geo feature is generic public
   geography (planet/region/country/admin area) — it is NEVER tagged with, and its metadata NEVER carries,
   anything that could imply private operational data (where a worker operates, access sensitivity,
   ministry context). **Sensitivity classification is an off-chain app/domain policy applied OVER neutral
   features, never an on-chain feature attribute** (e.g. demo-gs's `creative_access` flag is app-local).
8. **No on-chain skill↔geo mapping.** `SkillDefinitionRegistry` and `GeoFeatureRegistry` are independent
   and reference NOTHING of each other. Any "serves skill X in region Y" co-occurrence is an OFF-chain
   claim/credential — there is no on-chain link tying a skill to a geo feature (it would leak operational
   association). Enforced structurally (no cross-import) + by the boundary test.

## People groups are EXCLUDED (hard boundary)

Per the plan + ADR-0021, the following NEVER enter reusable `packages/` or `packages/contracts/`:
- **No** `PeopleGroupConceptRegistry.sol`, **no** `@agenticprimitives/people-groups`, **no**
  `tbox/people-groups.ttl` / `cbox/people-group-vocabulary.ttl`.
- **No** contract constants or schema named for faith-domain terms — Kingdom Consultant, GCO, Gospel
  Worker, Tentmakers, Creative Access, Prayer Circles, faith-specific causes, people-group / reachedness /
  adoption / facilitator / recognition semantics.
- People-group / faith-domain records live in **apps, domain MCPs, private vault credentials, or
  domain-specific deployment data** (e.g. `apps/demo-jp/src/lib/people-groups.ts`, `apps/demo-gs`). They
  MAY reference generic skills / geo / credentials, but MUST NOT add reusable vocabulary.
- Enforced by `check:no-domain-in-packages` + `check:forbidden-terms` + a boundary test that asserts the
  skills/geo contracts + SDKs contain no faith-domain term.

## Contract surfaces

### `packages/contracts/src/skills/SkillDefinitionRegistry.sol`
Versioned public skill definitions. Per `skillId`: monotonic `version`, `stewardAccount` (Address),
`skillKind` (bytes32 from the C-box kind codelist), `conceptHash` (keccak of the canonical SKOS
prefLabel + ancestors), `ontologyMerkleRoot` (anchors the RDF/SKOS expansion), `predecessorRoot` (prior
version's root, chains taxonomy refreshes), `metadataURI`, `validAfter`/`validUntil`, `active`,
`registeredAt`. `publish(...)` increments version; first publish requires the steward, later versions the
**same** steward. `deactivate` / `setValidity`. Address-keyed steward authorization (ERC-1271 owner
fallback). Events: `SkillPublished`, `SkillDeactivated`, `SkillValidityChanged`.

### `packages/contracts/src/geo/GeoFeatureRegistry.sol`
Versioned public geo features. `FeatureRecord`: `featureId`, `version`, `stewardAccount`, `featureKind`
(bytes32), `geometryHash` (keccak of canonical GeoJSON — **off chain**), `coverageRoot` + `sourceSetRoot`
(merkle), `metadataURI`, coarse `centroid`/`bbox` (`int256`, degrees × 1e7, UI only), `validAfter`/
`validUntil`, `active`. Same versioning + steward auth + `deactivate`/`setValidity` as skills.

### Claims = off-chain vault credentials (NO on-chain claim registry)

A skill or geo **claim** — the association of a subject SA to a definition — is a **private verifiable
credential in that org's / person's vault** (spec 247 per-agent vault), NOT an on-chain row. The credential
body carries: `subject` (Address), `issuer` (Address), the referenced `(definitionId, version)` (a stable
pointer into `SkillDefinitionRegistry` / `GeoFeatureRegistry`), `relation` + `visibility` (C-box codelist
values), `proficiency` / evidence, validity, and revocation — all in the VC, governed off chain.

The SDK layer (`@agenticprimitives/agent-skills`, `@agenticprimitives/geo-features`) owns the credential
**shapes** + builders + a resolver that confirms the pinned `(definitionId, version)` still `exists()` in
the on-chain registry. Sharing a claim is consent-gated (the demo-jp/demo-gs vault-delegation model). A
claim becomes public ONLY by explicit opt-in, and then through the **existing generic `AttestationRegistry`**
(it stores a credential hash + parties) — there is deliberately no skill/geo-specific claim contract.

**Why off chain:** the agent↔skill / agent↔geo association is sensitive (who serves where, who has which
capability) and must stay in the vault under the agent's control; only the neutral *definition* is public.

## Ontology (C-box) — extend first

`packages/ontology`: `tbox/skills.ttl` + `cbox/skill-vocabulary.ttl` (skill kinds, skill relations,
proficiency labels, visibility modes) + skill-claim SHACL; `tbox/geo.ttl` + `cbox/geo-vocabulary.ttl`
(geo kinds, geo relations) + geo-feature/claim SHACL. The on-chain `bytes32` kind/relation constants MUST
equal `keccak256` of the C-box codelist URIs (lockstep, gate-checked like the EIP-712 typehash gate).

## Reference: smart-agent patterns to port

From `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`),
`packages/contracts/src/{SkillDefinitionRegistry,AgentSkillRegistry,GeoFeatureRegistry,GeoClaimRegistry}.sol`:
- **PORT (structure) — for the DEFINITION registries only:** monotonic per-id versioning with a
  predecessor-root chain; off-chain geometry (geometry hash + coverage/source roots + coarse centroid/bbox);
  the steward model; the C-box Visibility enum (`Public, PublicCoarse, PrivateCommitment, PrivateZk,
  OffchainOnly`) — used by the off-chain claim credentials, not an on-chain row.
- **DELIBERATELY DIVERGE:**
  1. **Claims are OFF chain.** smart-agent puts skill/geo claims in on-chain `AgentSkillRegistry` /
     `GeoClaimRegistry`. AP does NOT: the agent↔definition association is a **private vault credential**
     (the user-stated boundary: "geometry can be on chain, but association to org or person has to be off
     chain"). We port the claim *semantics* (claimId = `keccak(subject‖id‖relation‖nonce)`,
     self-vs-endorsed, EIP-712 endorsement, evidence commitment, revocation epoch) into the credential
     **SDK** (`@agenticprimitives/agent-skills` / `geo-features`) + the existing vault — not a contract. A
     public assertion (opt-in) reuses the generic `AttestationRegistry`.
  2. **Authorization (definitions)** — smart-agent uses a bare `isOwner(address)` staticcall. AP **rejects**
     that (`AgentRelationship.sol`: "No `isOwner(address)` fallback in auth"). Match AP: `msg.sender ==
     stewardAccount` directly — the steward SA publishes through its own `execute()` path (ADR-0010).
  3. **Kind/relation constants are C-box-anchored** — ours equal `keccak256(<C-box codelist URI>)`,
     gate-checked against the ontology (ADR-0009 lockstep).
  4. **Drop name binding from v1** — defer the `.skill`/geo TLD bind (names are facets, not the key).
  5. **No people-group anything** — smart-agent's skill/geo registries are already clean (confirmed); keep
     them so, and add the boundary test.

## Implementation sequence

1. This spec. 2. Ontology T-box/C-box + the lockstep `bytes32` kind/relation constants.
3. **SkillDefinitionRegistry + GeoFeatureRegistry (on chain)** + Foundry tests (publish/version/deactivate/
validity; off-chain geometry). **[DONE this increment.]** 4. Wire both into `Deploy.s.sol` + deployments
JSON + ABI export. 5. Minimal SDKs — `@agenticprimitives/agent-skills` + `geo-features`: the credential
**shapes** (claim references `(definitionId, version)`), builders (self + ERC-1271-endorsed), an `exists()`
resolver against the on-chain registry, and the vault read/write glue (spec 247). One-way dep on
`types`/`contracts`/`ontology`/`verifiable-credentials`; no MCP/runtime back-edges. 6. Directory/search
projections so intent matching can discover agents by their (consent-shared) skill/geo claims. 7. demo-gs
Phase 3 resolves `SkillRef`/`GeoFacet` from these registries + stores Offerings' skill claims as vault
credentials.

## Validation target

- Ontology unit tests prove the new vocabularies load + validate; on-chain kind/relation constants equal
  the C-box keccak (lockstep gate).
- Forge tests cover the DEFINITION registries: publish / version (predecessor-root chain) / deactivate /
  setValidity / non-steward + empty-metadata reverts / off-chain geometry hash anchoring. **[DONE: 10
  passing in `DefinitionRegistries.t.sol`.]** Claim semantics (self/endorsed, revocation epoch) are unit-
  tested in the credential SDK, not on chain.
- `check:package-boundaries` / `check:dependency-graph` confirm no MCP/runtime dep enters the SDKs/ontology.
- A boundary test proves no people-group / faith-domain term appears in `src/skills/`, `src/geo/`, or the
  SDKs.

## Out of scope (this wave)

`.skill` / geo name binding; ZK verifier wiring for `PrivateZk`; the directory/search indexer; the demo-gs
Phase-3 migration; on-chain H3 math (coverage stays a merkle root).
