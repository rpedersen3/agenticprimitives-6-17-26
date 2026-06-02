# Spec 225 — Agentic Primitives Ontology (T-box / C-box / A-box)

**Status:** v0 / planned (2026-05-25).
**Owner:** `@agenticprimitives/ontology` (new).
**Architecture commitment:**
[ADR-0018 — monorepo-wide formal ontology](../docs/architecture/decisions/0018-agenticprimitives-wide-formal-ontology.md).
**Related ADRs:** 0009 (on-chain ontology / SHACL — the enforcement peer),
0008 (CAIP-10 `nativeId`), 0016 (CanonicalAgentId).
**Related specs:** [223 (directory)](./223-identity-directory.md),
[226 (HCS alignment)](./226-hcs-alignment-and-standards.md),
[215 (naming)](./215-agent-naming.md), [216 (relationships)](./216-agent-relationships.md),
[217 (profile)](./217-agent-profile.md).
**Reference ontology work:**
[`agentictrustlabs/smart-agent/docs/ontology`](https://github.com/agentictrustlabs/smart-agent/tree/master/docs/ontology)
(abox/cbox/tbox + `context.jsonld`),
[`agentictrustlabs/agent-explorer/docs`](https://github.com/agentictrustlabs/agent-explorer/tree/main/docs)
(ontology + GraphDB).

---

## 1. Purpose

Define the **canonical, off-chain, formal vocabulary** for the whole monorepo —
the source of truth for IRIs, datatypes, and shapes that everything else
references. It is what the on-chain ontology ([ADR-0009](../docs/architecture/decisions/0009-on-chain-ontology-shacl-naming.md))
instantiates, what `identity-directory` (spec 223) conforms to, and where
external-standard mappings (HCS, ERC-8004) live formally.

## 2. The three-box split (mirrors the reference)

The ontology is organized into three boxes, exactly as the reference work does:

- **T-box (terminological)** — `tbox/`. The schema: OWL/RDFS **classes** and
  **properties/predicates**, split per domain into `.ttl` modules. Pure
  vocabulary + axioms; no instances, no constraints.
- **C-box (constraints + controlled-vocabularies)** — `cbox/`. Two kinds of
  artifact, as in the reference:
  1. **SHACL shapes** (`*.shacl.ttl`) — structural validation of instances.
  2. **Controlled vocabularies** (`*.ttl`) — closed codelists / SKOS concept
     schemes for enumerated terms (e.g. `agentKind`, `riskTier`,
     `credentialKind`, capability codelists).
- **A-box (assertional)** — `abox/`. Instances/individuals: actual agents,
  credential facets, names, edges. The `identity-directory` projected graph
  (spec 223) IS A-box data; this package ships only **example/fixture** A-box
  for tests + golden vectors, not live data.

`context.jsonld` at the package root holds the JSON-LD `@context` (prefix → IRI
map) so any artifact or consumer shares one namespace binding.

## 3. Package shape

`@agenticprimitives/ontology` — **no internal `@agenticprimitives/*` deps** (it
is the vocabulary root; depending on a consumer would invert the graph). Ships:

```
packages/ontology/
  context.jsonld            # @context: prefix → IRI bindings
  tbox/   core.ttl identity.ttl credential.ttl delegation.ttl
          custody.ttl audit.ttl naming.ttl relationships.ttl org.ttl
  cbox/   *.shacl.ttl (shapes)  +  *-vocabulary.ttl / *-types.ttl (codelists)
  abox/   fixtures/*.ttl        # examples + test vectors only
  mappings/ ap-hcs-mappings.ttl ap-erc8004-mappings.ttl
  src/    index.ts              # thin TS: load IRIs, resolve prefixes, run SHACL
```

TS surface is intentionally thin: expose the IRIs as typed constants, load the
artifacts, and run SHACL validation. Candidate libs (pin in implementation):
`n3` (parse), `rdf-ext` (dataset), a SHACL engine (`shacl-engine` /
`rdf-validate-shacl`). No runtime dep on a triple store — validation is local.

## 4. Namespaces

Base `https://agenticprimitives.dev/ns/`, split per domain like the reference's
`smartagent.io/ontology/<domain>#` scheme. Indicative bindings (final strings
pinned in `context.jsonld`):

| prefix | IRI | scope |
|---|---|---|
| `ap`    | `…/ns/core#`          | Agent, CanonicalAgentId, Facet, Evidence, Assurance |
| `apid`  | `…/ns/identity#`      | identity facets, OidcSubject |
| `apcr`  | `…/ns/credential#`    | CredentialFacet, CredentialKind, CredentialRole |
| `apdel` | `…/ns/delegation#`    | Delegation, Caveat, Enforcer |
| `apcus` | `…/ns/custody#`       | Custodian, Trustee, CustodyCouncil, RiskTier |
| `apaud` | `…/ns/audit#`         | AuditEvent |
| `apnam` | `…/ns/naming#`        | NameFacet |
| `aprel` | `…/ns/relationships#` | relationship predicates |
| `aporg` | `…/ns/org#`           | Org, membership |

External: `rdf`, `rdfs`, `owl`, `xsd`, `sh` (SHACL), `prov`, `skos`.

## 5. T-box (selected classes / predicates)

- **`ap:Agent`** — the canonical Smart Agent (ADR-0010). Every other node is a
  facet of, or edge to, an `ap:Agent`.
- **`ap:CanonicalAgentId`** — the CAIP-10 identifier (ADR-0016); the subject key.
- **`ap:Facet`** ⊃ `apcr:CredentialFacet`, `apnam:NameFacet`,
  `apid:OidcSubject` — all `apid:isFacetOf` exactly one `ap:Agent`.
- **`ap:Evidence`** + `ap:hasEvidence`, `ap:assurance` — provenance for every
  asserted edge (spec 223).
- Predicates: `apcr:controls` (credential → agent), `aporg:memberOf`,
  `apdel:delegatesTo`, `apnam:resolvesTo`.

## 6. C-box (shapes + controlled vocabularies)

- **`CanonicalAgentIdShape`** — `ap:CanonicalAgentId` MUST match the CAIP-10
  grammar; namespace ∈ the allowlist `{eip155, hedera, solana}` (ADR-0008). Every
  instance carries `ap:controlStatus`: `eip155:*` → `"custodied"` (EVM
  ERC-4337/ERC-1271, the only custodied namespace today); **`hedera:*` AND
  `solana:*` → `"identifier-only"`** (addressable, not custodied — security audit
  P1-5; spec 224 §5 gates control on this). Do not leave any allowlisted
  namespace without a `controlStatus`.
- **`CredentialFacetShape`** — a `CredentialFacet` references exactly one
  `ap:Agent` and carries exactly one `ap:Evidence`.
- **Two distinct "kind" controlled vocabularies (audit P1-4) — do not conflate:**
  - `agentKind` `{person, org, service}` — the **3-value, on-chain-bound** set
    (ADR-0009's enum / `types.AgentType`). **treasury is NOT an agentKind** — it
    is a kind of service (`ap:Treasury rdfs:subClassOf ap:ServiceAgent`; tbox/core).
  - `profileType` `{person, org, service, treasury, mcpServer, multisig}` — the
    **6-value** `agent-profile`/HCS-11 set (spec 217). `treasury`, `mcpServer`,
    and `multisig` are modeled as `profileType` subtypes of an `agentKind`
    (`treasury ⊂ service`, `mcpServer ⊂ service`, `multisig ⊂ org`/`service`);
    this mapping feeds the AP-11 alignment pass (spec 226 §7).
- **Other controlled vocabularies (SKOS):** `riskTier` `{T1…T6}`, `credentialKind`
  `{passkey, siwe-eoa, hardware, oidc}`, `assurance`
  `{unverified, asserted, onchain-read, onchain-confirmed}`.

The `agentKind`/`riskTier` codelists are the **same closed sets** the on-chain
`OntologyTermRegistry` enum-sets bind — see §8.

## 7. A-box & the knowledge-graph backend

The live A-box is the `identity-directory` projected graph (spec 223). Reference
deployment (from `agent-explorer/docs/graphdb`): **Ontotext GraphDB** as the
triple store, deployed via `docker-compose.graphdb.yml`, fronted by a Cloudflare
tunnel, queried over **SPARQL** (the "agentkg" agent knowledge graph). In our
architecture GraphDB (or an equivalent SPARQL store) backs the directory's
**`IndexerPort`** — an *explicit indexer*, which is exactly the ADR-0012-compliant
home for "indexed registry" reads (never `eth_getLogs`). This package ships only
fixture A-box; the live store is operated as substrate, not shipped in the package.

## 8. On-chain lockstep (ADR-0009)

The on-chain `OntologyTermRegistry` + `ShapeRegistry` are the **per-chain
governance + enforcement** of this vocabulary. Discipline:
- Each on-chain term `(curie, uri)` references an IRI defined in `tbox/`.
- Each on-chain `ShapeRegistry` class shape corresponds to a `cbox/` SHACL shape.
- On-chain enum-sets (e.g. `agentKind`) equal the C-box controlled vocabularies.
- A predicate added on chain MUST get an IRI here; a shape here MUST match its
  on-chain counterpart. Lockstep, not two sources of truth ([ADR-0018](../docs/architecture/decisions/0018-agenticprimitives-wide-formal-ontology.md)).

**Two gaps the lockstep must close before it is mechanizable (audit P1-3):**
1. **CURIE/IRI binding.** The on-chain heritage uses the `atl:` prefix
   (e.g. `atl:AgentName`, `keccak256("atl:AgentName")` classIds); this ontology
   uses `ap*:`. Resolve by EITHER publishing a `mappings/ap-onchain-curies.ttl`
   `atl:` ⟷ `ap*:` crosswalk, OR migrating the on-chain CURIEs to `ap*:` on the
   next redeploy (cheaper per "redeploys are cheap, drift is expensive";
   ADR-0009 already budgets a redeploy). Until one exists, "references an IRI
   here" has no mechanism.
2. **Definition of "shape match."** Off-chain SHACL and the on-chain
   `(predicate, expectedDatatype, cardinality, enumSetId, expectedClass)` tuples
   are different formalisms. **"Match" := every on-chain shape property has a
   corresponding `sh:property` with equal datatype + cardinality + enum set.**
   This definition is the prerequisite for the Phase-4 `check:ontology-lockstep`
   CI gate (§11); it cannot exist until both the `.ttl` artifacts and a deployed
   `ShapeRegistry` exist.

## 9. External-standard mappings

`mappings/ap-hcs-mappings.ttl` (per the advisor crosswalk, spec 226):
- **`owl:sameAs`** — reserved for genuine identity-equality. The only one in v0:
  `ap:CanonicalAgentId owl:sameAs` CAIP-10 (`chainagnostic.org/CAIPs/caip-10`).
- **`rdfs:seeAlso`** — for *parallel* (not identity-equal) HCS concepts:
  `ap:AgentProfile`→HCS-11, `ap:CanonicalAgentId`→HCS-14 nativeId,
  `apcr:CredentialFacet`→HCS-15, `ap:RegistryEntry`→HCS-2,
  `ap:OntologyShape`→HCS-13, `apaud:AuditEvent`→HCS-20, `aporg` Flora→HCS-16,
  `apcr:Capability`→HCS-26. Most HCS links are `seeAlso` because substrate
  divergence means they are not `sameAs`.
- `ap-erc8004-mappings.ttl` for ERC-8004 (Trustless Agents).

## 10. Reference: smart-agent / agent-explorer patterns to port

- `agentictrustlabs/smart-agent/docs/ontology` — port the **A/T/C-box layout**
  + `context.jsonld` per-domain namespacing verbatim in structure; adapt the
  T-box modules to our domains. The reference T-box has ~20 modules (core,
  identity, delegation, governance, trust, roles, skills, relationships,
  resources, people-groups, intents, needs, marketplace-lifecycle, matches,
  entitlements, geo, hub, namespace, …); keep the agent-trust core
  (core/identity/credential/delegation/custody/audit/naming/relationships/org)
  and drop the out-of-domain ones (e.g. marketplace/intents/needs/geo/hub) per
  the §11 scope bound — this list is illustrative, not exhaustive.
- The C-box **dual pattern** (SHACL shapes + controlled-vocabulary codelists in
  one box) is the model — keep it.
- `agentictrustlabs/agent-explorer/docs/graphdb` — GraphDB + SPARQL + Cloudflare
  tunnel deployment is the reference substrate for the A-box knowledge graph
  (the directory's `IndexerPort` backend).
- On-chain: smart-agent `packages/contracts/src/{OntologyTermRegistry,
  AttributeStorage, ShapeRegistry}.sol` (already ported per ADR-0009) are the
  on-chain projection of this T-box/C-box.

**Deliberate divergence:** the reference ontology is broad (marketplace, intents,
geo). Ours is bounded to the agent-trust core (§11). And our A-box keys are
CAIP-10 `CanonicalAgentId`s, with `hedera:*` admitted as identifier-only.

## 11. Scope bounding & phased plan

Phase-1 scope: **identity + credential + custody + delegation + audit + naming +
org** (`org` is in scope, not deferred — spec 223 §4 makes `Org`/`memberOf`
first-class directory nodes and many-agent disambiguation references org
membership; audit P2-3).

**Phase-1.5 scope addition (added 2026-06-02b — see §11.5 below):** the v2
coordination substrate spine vocabulary (intent / constraint / resolution /
agreement / payment / fulfillment / attestation) per
[ADR-0024](../docs/architecture/decisions/0024-intent-coordination-substrate.md).
Still defer marketplace UI / branding / vertical content. Do not boil the ocean.

1. `context.jsonld` + `tbox/core.ttl` + `tbox/identity.ttl` + the
   `CanonicalAgentIdShape` (cbox) — enough for spec 223 to conform.
2. Remaining T-box modules + C-box codelists matching ADR-0009 enum-sets.
3. `mappings/ap-hcs-mappings.ttl` (spec 226 crosswalk) + ERC-8004 mappings +
   the `atl:`⟷`ap*:` CURIE crosswalk (§8 gap 1).
4. SHACL validation in `src/` + golden A-box fixtures + the Phase-4
   `check:ontology-lockstep` gate (the §8 "shape match" definition: every
   on-chain term has an IRI here AND every on-chain shape property matches a
   `cbox/` `sh:property`).

### 11.5 Substrate spine vocabulary (added 2026-06-02b — scope expansion)

The monorepo-wide formal ontology (per
[ADR-0018](../docs/architecture/decisions/0018-agenticprimitives-wide-formal-ontology.md))
includes T-box class definitions, properties, and external-standard crosswalks
for the v2 15-layer coordination spine introduced by
[ADR-0024](../docs/architecture/decisions/0024-intent-coordination-substrate.md)
and detailed in
[docs/architecture/coordination-substrate.md](../docs/architecture/coordination-substrate.md).

**In-scope (new T-box files in `packages/ontology/tbox/`):**

- `tbox/intents.ttl` — Intent + IntentMatch + Commitment + Desire (per [ADR-0024](../docs/architecture/decisions/0024-intent-coordination-substrate.md) Layer 2 + 7)
- `tbox/constraints.ttl` — ConstraintSet + AssumptionSet + Constraint domains (Layer 3, Anoma CSP-shaped)
- `tbox/resolution.ttl` — Resolver + ResolvedOrder (Layer 4 — skeleton W1)
- `tbox/agreement.ttl` — AgreementCommitment + AgreementCredential (Layer 8)
- `tbox/payment.ttl` — PaymentMandate + PaymentReceipt + ContextBinding + MandateConstraints (Layer 9b)
- `tbox/fulfillment.ttl` — FulfillmentCase + Task + Message + Artifact + HandoffPolicy + IntentTraceSpan (Layers 10–12)
- `tbox/attestation.ttl` — Association + Evidence + Outcome + Validation + TrustUpdate credential types (Layers 12–15)

**In-scope (new crosswalks):**

- `mappings/spine-standards.ttl` — `owl:equivalentClass` + `rdfs:subClassOf` to ERC-7521 / ERC-7683 / ERC-8004 / A2A / Anoma / x402 / W3C VC / UFO-C / ValueFlows / PROV-O.

**Out-of-scope (NOT moved into this package):**

- **Runtime SHACL shapes** for these vocabularies — live in their owning
  packages per [PD-19](../apps/demo-jp/docs/packages.md):
  `packages/intent-marketplace/src/shapes/*.shacl.ttl`,
  `packages/agreements/src/shapes/*.shacl.ttl`,
  `packages/payments/src/shapes/*.shacl.ttl`,
  `packages/fulfillment/src/shapes/*.shacl.ttl`,
  `packages/attestations/src/shapes/*.shacl.ttl`,
  `packages/mcp-runtime/src/shapes/a2a-task.shacl.ttl`.
- **Vertical / branding / white-label content** (faith, health, education,
  geo-specific domain terms) — lives in apps per
  [ADR-0021](../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md).

**Why expanded.** When §11 was originally written, the substrate's vocabulary
was effectively just identity + credential + custody + delegation + audit +
naming + org. The v2 coordination substrate doubles the substrate vocabulary
with the spine concepts above. Because they're substrate-wide (six W1 packages
consume them), they belong in the monorepo-wide formal ontology root per
ADR-0018, not scattered across each owning package's TTL files. The
hybrid model (T-box centralized; SHACL distributed) preserves both: one
ontology root + per-package runtime SHACL validation.

**Implementation plan + TTL drafts:** see
[`docs/architecture/spine-ontology-extensions.md`](../docs/architecture/spine-ontology-extensions.md).

**Lockstep.** Every new T-box term registered here MUST be registered on chain
via `ShapeRegistry.defineShape(...)` per the existing
[ADR-0009](../docs/architecture/decisions/0009-on-chain-ontology-shacl-naming.md)
lockstep convention. The `check:ontology-lockstep` gate covers all new shapes.
