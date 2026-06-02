# Spine Ontology Extensions — Planning + TTL Drafts

> **What this is.** Draft TTL vocabulary + SHACL shape content for the v2 15-layer coordination spine ([coordination-substrate.md](./coordination-substrate.md)), with explicit package-residency assignments per a **hybrid model** (T-box centralized in `@agenticprimitives/ontology` per ADR-0018; SHACL shapes distributed to owning packages per PD-19).
>
> **REVISED 2026-06-02b after architectural challenge.** Initial draft placed all TTL (T-box + SHACL) in owning packages. That respected the existing `packages/ontology/CLAUDE.md` drift trigger but was reconsidered on the merits: the v2 spine introduces substrate-wide vocabulary (six W1 packages consume it), so its T-box belongs in the monorepo-wide ontology root per ADR-0018. The drift trigger was written before the v2 spine and requires explicit revision (see §13).

**Status:** Planning + draft (2026-06-02b — revised).
**Companion docs:** [coordination-substrate.md](./coordination-substrate.md), [privacy-and-self-sovereign-identity.md](./privacy-and-self-sovereign-identity.md), [ADR-0009](./decisions/0009-on-chain-ontology-shacl-naming.md) (on-chain ontology + SHACL), [ADR-0018](./decisions/0018-agenticprimitives-wide-formal-ontology.md) (formal ontology — broadened by this doc), [ADR-0024](./decisions/0024-intent-coordination-substrate.md) (substrate decisions), [spec 225](../../specs/225-ontology.md) (ontology package — §11.5 addendum needed).

---

## 1. The boundary: T-box centralized, SHACL distributed

The hybrid model splits each spine vocabulary into TWO files in TWO different packages:

| Concern | Where | Why |
|---|---|---|
| **T-box** — class definitions, properties, equivalences to upper ontologies (UFO-C, ValueFlows, PROV-O) and standards (ERC-7521, ERC-7683, A2A, ERC-8004) | `@agenticprimitives/ontology` (`tbox/`) | Monorepo-wide formal ontology per ADR-0018; consumers reference one source of truth for IRIs |
| **SHACL shapes** — runtime invariants enforced inside each package's flows | Owning package's `src/shapes/` | Package-specific validation; matches PD-19 framing; on-chain `ShapeRegistry` hash registered per package's deploy step |
| **Cross-standard mappings** (`owl:equivalentClass` to ERC-7521 / A2A / Anoma / etc.) | `@agenticprimitives/ontology` (`mappings/spine-standards.ttl`) | Same role HCS/ERC-8004 mappings already play in the ontology package |

| TTL artifact | T-box (ontology pkg) | SHACL shapes (owning pkg) | Status |
|---|---|---|---|
| Core `Agent` / `CanonicalAgentId` / `Facet` / `Evidence` | `packages/ontology/tbox/core.ttl` | (existing shapes per package) | ✅ shipped |
| Identity facets | `packages/ontology/tbox/identity.ttl` | — | ✅ shipped |
| Controlled vocabularies | `packages/ontology/cbox/controlled-vocabularies.ttl` | — | ✅ shipped |
| **Intent + IntentMatch + Commitment** | `packages/ontology/tbox/intents.ttl` *(NEW)* | `packages/intent-marketplace/src/shapes/intents.shacl.ttl` | 🟡 W1 |
| **ConstraintSet + AssumptionSet + Constraint domains** | `packages/ontology/tbox/constraints.ttl` *(NEW)* | `packages/intent-marketplace/src/shapes/constraints.shacl.ttl` | 🟡 W1 |
| **Resolution + ResolvedOrder** | `packages/ontology/tbox/resolution.ttl` *(NEW; skeleton)* | `packages/intent-resolver/src/shapes/resolution.shacl.ttl` *(W2)* | 🟡 W1 skeleton |
| **AgreementCommitment + AgreementCredential** | `packages/ontology/tbox/agreement.ttl` *(NEW)* | `packages/agreements/src/shapes/agreement.shacl.ttl` | 🟡 W1 |
| **PaymentMandate + PaymentReceipt + MandateConstraints + ContextBinding** | `packages/ontology/tbox/payment.ttl` *(NEW)* | `packages/payments/src/shapes/payment.shacl.ttl` | 🟡 W1 |
| **FulfillmentCase + Task + Message + Artifact + HandoffPolicy + IntentTraceSpan** | `packages/ontology/tbox/fulfillment.ttl` *(NEW)* | `packages/fulfillment/src/shapes/fulfillment.shacl.ttl` | 🟡 W1 |
| **A2A Task wire compat** | (re-uses `tbox/fulfillment.ttl` Task class) | `packages/mcp-runtime/src/shapes/a2a-task.shacl.ttl` *(spec 245)* | 🟡 W1 |
| **AssociationCredential + EvidenceCredential + OutcomeCredential + ValidationCredential + TrustUpdate** | `packages/ontology/tbox/attestation.ttl` *(NEW)* | `packages/attestations/src/shapes/credentials.shacl.ttl` | 🟡 W1 |
| **Spine ↔ industry-standard crosswalks** | `packages/ontology/mappings/spine-standards.ttl` *(NEW)* | — | 🟡 W1 |

**Net effect on the ontology package:** seven new `tbox/*.ttl` files + one new `mappings/spine-standards.ttl` + a `context.jsonld` extension (namespace prefix registrations). No runtime validation logic added — the package stays declarative per its capability manifest.

**Net effect on owning packages:** each ships its own `src/shapes/*.shacl.ttl` with runtime invariants for that package's flows. These are package-local SHACL shapes that get registered to `ShapeRegistry.defineShape(...)` at deploy time per the existing on-chain lockstep convention.

## 2. Namespace plan

All spine vocabularies use `ap*:` sub-namespaces, parallel to the ontology root:

```
ap:    https://agenticprimitives.dev/ns/core#       (ontology root — shipped)
apid:  https://agenticprimitives.dev/ns/identity#   (identity facets — shipped)
apnam: https://agenticprimitives.dev/ns/naming#     (naming — shipped)

apint: https://agenticprimitives.dev/ns/intent#         (NEW — intent-marketplace)
apcst: https://agenticprimitives.dev/ns/constraint#     (NEW — intent-marketplace)
apres: https://agenticprimitives.dev/ns/resolution#     (NEW — intent-resolver)
apagr: https://agenticprimitives.dev/ns/agreement#      (NEW — agreements)
apdel: https://agenticprimitives.dev/ns/delegation#     (NEW — delegation pkg)
appay: https://agenticprimitives.dev/ns/payment#        (NEW — payments)
apful: https://agenticprimitives.dev/ns/fulfillment#    (NEW — fulfillment)
apatt: https://agenticprimitives.dev/ns/attestation#    (NEW — attestations)
apvc:  https://agenticprimitives.dev/ns/credential#     (NEW — verifiable-credentials)
```

Each namespace is owned by its package; the IRI prefix is reserved in `packages/ontology/context.jsonld` so the JSON-LD `@context` resolves consistently.

## 3. Anoma CSP alignment (the spine's intent doctrine)

The spine's `Intent`, `ConstraintSet`, and `AssumptionSet` align explicitly with [Anoma's intent-centric architecture](https://anoma.net/) — intents as **constraint satisfaction problems** over future state-spaces. The TTL drafts below encode this:

- `apint:Intent` → an actor's signed declarative statement over a desired end-state
- `apcst:ConstraintSet` → a CSP shape: hard constraints (must-satisfy filters) + soft constraints (scorer preferences) over typed variables with discriminated `ConstraintDomain` (enum / range / set / predicate)
- `apcst:AssumptionSet` → the Resolver-asserted set of named assumptions per [ERC-7683's resolver-assumption pattern](https://www.erc7683.org/) — what solvers MUST validate before committing
- `apres:ResolvedOrder` → the normalized, executable form a Resolver produces from an Intent (the bridge from CSP-shaped Intent to Solver-fillable Order)

These align with — and don't duplicate — UFO-C (`ufo-c:Intention`), ValueFlows (`vf:Intent`, `vf:Commitment`), PROV-O (`prov:Plan`, `prov:Activity`, `prov:Entity`), and SKOS (controlled vocabulary for `intentType` + `object`). The mapping appendix (§10) names the equivalence relationships.

## 4. `intent-marketplace` — TTL drafts

### 4.1 `packages/ontology/tbox/intents.ttl` (T-box — centralized per hybrid model)

```turtle
# T-box — intent vocabulary for the @agenticprimitives/intent-marketplace pkg.
# Anoma CSP alignment + ERC-7683 + UFO-C/ValueFlows. Spec 225 §11.5 boundary.

@prefix ap:     <https://agenticprimitives.dev/ns/core#> .
@prefix apint:  <https://agenticprimitives.dev/ns/intent#> .
@prefix apcst:  <https://agenticprimitives.dev/ns/constraint#> .
@prefix apres:  <https://agenticprimitives.dev/ns/resolution#> .
@prefix rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:   <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl:    <http://www.w3.org/2002/07/owl#> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .
@prefix prov:   <http://www.w3.org/ns/prov#> .
@prefix skos:   <http://www.w3.org/2004/02/skos/core#> .
@prefix vf:     <https://w3id.org/valueflows#> .
@prefix ufo-c:  <http://purl.org/nemo/ufo-c#> .

apint: a owl:Ontology ;
    rdfs:label "Agentic Primitives — intent ontology" ;
    owl:versionInfo "0.1.0" ;
    rdfs:comment "T-box for intent-marketplace. Anoma CSP-aligned." .

# ─── Intent + lifecycle classes ────────────────────────────────────────

apint:Desire a owl:Class ;
    rdfs:subClassOf ufo-c:Intention ;
    rdfs:label "Desire" ;
    rdfs:comment "An actor's latent want — internal BDI state. NOT addressable; NOT a commitment. Becomes actionable only when committed to an Intent. Layer 1 of the spine." .

apint:Intent a owl:Class ;
    rdfs:subClassOf ufo-c:Intention , vf:Intent ;
    rdfs:label "Intent" ;
    rdfs:comment "An actor's signed declarative statement of a desired end-state — direction + object (SKOS) + topic + constraints + expectedOutcome. NOT a plan; not a transaction; not a task. CSP-shaped per Anoma alignment. Layer 2 of the spine." .

apint:ReceiveIntent a owl:Class ;
    rdfs:subClassOf apint:Intent ;
    rdfs:label "ReceiveIntent" ;
    rdfs:comment "Intent with direction='receive': actor wants to be the recipient of the object." .

apint:GiveIntent a owl:Class ;
    rdfs:subClassOf apint:Intent ;
    rdfs:label "GiveIntent" ;
    rdfs:comment "Intent with direction='give': actor wants to be the provider of the object." .

apint:MatchInitiation a owl:Class ;
    rdfs:subClassOf prov:Activity ;
    rdfs:label "MatchInitiation" ;
    rdfs:comment "A broker's act of initiating a match between two compatible Intents. Distinct from IntentMatch (the accepted relation). Smart-agent SS-03 invariant." .

apint:IntentMatch a owl:Class ;
    rdfs:subClassOf prov:Activity ;
    rdfs:label "IntentMatch" ;
    rdfs:comment "An accepted compatibility relation between two Intents. Layer 7 of the spine. Smart-agent SS-02 invariant: both parties signal acceptance before promotion." .

apint:Commitment a owl:Class ;
    rdfs:subClassOf vf:Commitment ;
    rdfs:label "Commitment" ;
    rdfs:comment "A dual-signed envelope produced from an IntentMatch; the input to the Agreement layer (spec 241). Layer 7→8 bridge." .

# ─── Intent properties ────────────────────────────────────────────────

apint:direction a owl:DatatypeProperty ;
    rdfs:domain apint:Intent ;
    rdfs:range xsd:string ;
    rdfs:comment "'receive' or 'give'. Single-class on Intent (Smart-agent SS-01 invariant). Matching rule: direction MUST be opposite + object MUST be equal." .

apint:object a owl:ObjectProperty ;
    rdfs:domain apint:Intent ;
    rdfs:range skos:Concept ;
    rdfs:comment "The SKOS concept (e.g. apint:NeedCoaching) describing WHAT is wanted/offered. Matching rule: must be exactly equal between matched pair." .

apint:topic a owl:DatatypeProperty ;
    rdfs:domain apint:Intent ;
    rdfs:range xsd:string ;
    rdfs:comment "Free-text topic refinement; matched by topicSimilarity score (not equality)." .

apint:expressedBy a owl:ObjectProperty ;
    rdfs:domain apint:Intent ;
    rdfs:range ap:Agent ;
    rdfs:comment "The Agent SA address that signed the Intent." .

apint:addressedTo a owl:ObjectProperty ;
    rdfs:domain apint:Intent ;
    rdfs:range ap:Agent ;
    rdfs:comment "The intended recipients/audience of the Intent (broker, counterparty class, etc.)." .

apint:hasConstraintSet a owl:ObjectProperty ;
    rdfs:domain apint:Intent ;
    rdfs:range apcst:ConstraintSet ;
    rdfs:comment "Anoma-CSP-shaped constraints. First-class typed structure, NOT freeform payload." .

apint:hasAssumptionSet a owl:ObjectProperty ;
    rdfs:domain apint:Intent ;
    rdfs:range apcst:AssumptionSet ;
    rdfs:comment "Resolver-asserted assumptions (ERC-7683 pattern). Solvers MUST validate before bidding." .

apint:expectedOutcome a owl:ObjectProperty ;
    rdfs:domain apint:Intent ;
    rdfs:range prov:Entity ;
    rdfs:comment "What success looks like — referenced when constructing OutcomeCredential at Layer 13." .

apint:visibility a owl:DatatypeProperty ;
    rdfs:domain apint:Intent ;
    rdfs:range xsd:string ;
    rdfs:comment "Five-tier visibility: Public | PublicCoarse | PrivateCommitment | PrivateZK | OffchainOnly. Per privacy doc §4 Layer 2." .

apint:status a owl:DatatypeProperty ;
    rdfs:domain apint:Intent ;
    rdfs:range xsd:string ;
    rdfs:comment "Intent state-machine status (per spec 239 §5)." .

# ─── Curated SKOS intent-type vocabulary (C-Box separately in cbox/) ──
# See packages/intent-marketplace/src/shapes/intent-types.ttl
```

### 4.2 `packages/intent-marketplace/src/shapes/constraints.shacl.ttl` (C-box)

```turtle
# C-box — SHACL shapes for ConstraintSet, AssumptionSet, Constraint, NamedAssumption.
# Enforces Anoma CSP shape + D-38/D-43 first-class structure + per-field DisclosurePolicy.

@prefix apcst:  <https://agenticprimitives.dev/ns/constraint#> .
@prefix apint:  <https://agenticprimitives.dev/ns/intent#> .
@prefix sh:     <http://www.w3.org/ns/shacl#> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .

# ─── ConstraintSet class + shape ──────────────────────────────────────

apcst:ConstraintSet a sh:NodeShape ;
    sh:targetClass apcst:ConstraintSet ;
    sh:property [
        sh:path apcst:hasHardConstraint ;
        sh:node apcst:Constraint ;
        sh:minCount 0 ;
        sh:description "Hard constraints — enforceable invariants. Matcher MUST reject if violated."
    ] ;
    sh:property [
        sh:path apcst:hasSoftConstraint ;
        sh:node apcst:Constraint ;
        sh:minCount 0 ;
        sh:description "Soft constraints — scorer preferences. Contribute to composite score."
    ] ;
    sh:property [
        sh:path apcst:fieldDisclosure ;
        sh:datatype xsd:string ;
        sh:description "Per-field VisibilityTier mapping (D-42). JSON-encoded { fieldPath → tier }."
    ] .

# ─── Constraint shape (CSP variable + domain) ─────────────────────────

apcst:Constraint a sh:NodeShape ;
    sh:targetClass apcst:Constraint ;
    sh:property [
        sh:path apcst:variable ;
        sh:datatype xsd:string ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:description "The variable name being constrained (e.g. 'geo', 'requiredCredential')."
    ] ;
    sh:property [
        sh:path apcst:domain ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:or (
            [ sh:node apcst:EnumDomain ]
            [ sh:node apcst:RangeDomain ]
            [ sh:node apcst:SetDomain ]
            [ sh:node apcst:PredicateDomain ]
        ) ;
        sh:description "Discriminated domain — CSP-shaped."
    ] ;
    sh:property [
        sh:path apcst:source ;
        sh:datatype xsd:string ;
        sh:in ( "user-asserted" "llm-inferred" "policy-imposed" ) ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:description "Provenance — D-43. Inferred values redactable before publication."
    ] ;
    sh:property [
        sh:path apcst:rationale ;
        sh:datatype xsd:string ;
        sh:maxCount 1 ;
        sh:description "Human-readable explanation (esp. for llm-inferred / policy-imposed)."
    ] .

# ─── Domain shapes (CSP-style) ────────────────────────────────────────

apcst:EnumDomain a sh:NodeShape ;
    sh:targetClass apcst:EnumDomain ;
    sh:property [ sh:path apcst:enumValues ; sh:datatype xsd:string ; sh:minCount 1 ] .

apcst:RangeDomain a sh:NodeShape ;
    sh:targetClass apcst:RangeDomain ;
    sh:property [ sh:path apcst:minValue ; sh:minCount 1 ; sh:maxCount 1 ] ;
    sh:property [ sh:path apcst:maxValue ; sh:minCount 1 ; sh:maxCount 1 ] ;
    sh:property [ sh:path apcst:unit     ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .

apcst:SetDomain a sh:NodeShape ;
    sh:targetClass apcst:SetDomain ;
    sh:property [ sh:path apcst:allowedSet ; sh:datatype xsd:string ; sh:minCount 1 ] ;
    sh:property [ sh:path apcst:deniedSet  ; sh:datatype xsd:string ] .

apcst:PredicateDomain a sh:NodeShape ;
    sh:targetClass apcst:PredicateDomain ;
    sh:property [
        sh:path apcst:expression ;
        sh:datatype xsd:string ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:description "SHACL or JSONPath predicate body."
    ] .

# ─── AssumptionSet shape (ERC-7683 resolver-assumption parallel) ──────

apcst:AssumptionSet a sh:NodeShape ;
    sh:targetClass apcst:AssumptionSet ;
    sh:property [
        sh:path apcst:resolverId ;
        sh:datatype xsd:string ;
        sh:minCount 1 ; sh:maxCount 1
    ] ;
    sh:property [
        sh:path apcst:hasNamedAssumption ;
        sh:node apcst:NamedAssumption ;
        sh:minCount 0
    ] ;
    sh:property [
        sh:path apcst:risk ;
        sh:datatype xsd:string ;
        sh:minCount 0
    ] ;
    sh:property [
        sh:path apcst:hasValidationRequirement ;
        sh:minCount 0
    ] .

apcst:NamedAssumption a sh:NodeShape ;
    sh:targetClass apcst:NamedAssumption ;
    sh:property [
        sh:path apcst:name ;
        sh:datatype xsd:string ;
        sh:minCount 1 ; sh:maxCount 1
    ] ;
    sh:property [
        sh:path apcst:trustLevel ;
        sh:datatype xsd:string ;
        sh:in ( "asserted" "verified" "oracle" "zkp" ) ;
        sh:minCount 1 ; sh:maxCount 1
    ] ;
    sh:property [
        sh:path apcst:evidenceRef ;
        sh:datatype xsd:anyURI
    ] .

# ─── Intent shape — binds Intent to ConstraintSet + AssumptionSet ────

apint:IntentShape a sh:NodeShape ;
    sh:targetClass apint:Intent ;
    sh:property [
        sh:path apint:hasConstraintSet ;
        sh:node apcst:ConstraintSet ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:description "Every Intent has exactly one ConstraintSet (D-38)."
    ] ;
    sh:property [
        sh:path apint:hasAssumptionSet ;
        sh:node apcst:AssumptionSet ;
        sh:maxCount 1 ;
        sh:description "Zero-or-one AssumptionSet (zero in Direct Lane W1)."
    ] ;
    sh:property [
        sh:path apint:direction ;
        sh:datatype xsd:string ;
        sh:in ( "receive" "give" ) ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:description "Single-class invariant (Smart-agent SS-01)."
    ] ;
    sh:property [
        sh:path apint:object ;
        sh:nodeKind sh:IRI ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:description "Object as SKOS concept; matched by equality."
    ] ;
    sh:property [
        sh:path apint:visibility ;
        sh:datatype xsd:string ;
        sh:in ( "Public" "PublicCoarse" "PrivateCommitment" "PrivateZK" "OffchainOnly" ) ;
        sh:minCount 1 ; sh:maxCount 1
    ] .
```

## 5. `intent-resolver` — TTL skeleton

### 5.1 `packages/ontology/tbox/resolution.ttl` (T-box skeleton — centralized)

```turtle
@prefix apint:  <https://agenticprimitives.dev/ns/intent#> .
@prefix apres:  <https://agenticprimitives.dev/ns/resolution#> .
@prefix apcst:  <https://agenticprimitives.dev/ns/constraint#> .
@prefix owl:    <http://www.w3.org/2002/07/owl#> .
@prefix prov:   <http://www.w3.org/ns/prov#> .

apres: a owl:Ontology ;
    owl:versionInfo "0.1.0-skeleton" ;
    rdfs:comment "Skeleton — full vocabulary lands W2 when resolver implementations ship." .

apres:Resolver a owl:Class ;
    rdfs:comment "ERC-7683-pattern Resolver. Translates opaque Intent → ResolvedOrder." .

apres:ResolvedOrder a owl:Class ;
    rdfs:subClassOf prov:Entity ;
    rdfs:comment "Normalized executable form of an Intent. Layer 4 output." .

apres:resolvedFrom a owl:ObjectProperty ;
    rdfs:domain apres:ResolvedOrder ;
    rdfs:range apint:Intent .

apres:canonicalConstraints a owl:ObjectProperty ;
    rdfs:domain apres:ResolvedOrder ;
    rdfs:range apcst:ConstraintSet .

apres:expandedAssumptions a owl:ObjectProperty ;
    rdfs:domain apres:ResolvedOrder ;
    rdfs:range apcst:AssumptionSet .
```

## 6. `agreements` — TTL drafts

### 6.1 `packages/ontology/tbox/agreement.ttl` (T-box — centralized)

```turtle
@prefix apagr:  <https://agenticprimitives.dev/ns/agreement#> .
@prefix apvc:   <https://agenticprimitives.dev/ns/credential#> .
@prefix apint:  <https://agenticprimitives.dev/ns/intent#> .
@prefix vf:     <https://w3id.org/valueflows#> .

apagr:AgreementCommitment a owl:Class ;
    rdfs:subClassOf vf:Commitment ;
    rdfs:comment "On-chain commitment-only row in AgreementRegistry.sol. Body in vaults; only commitment hash + issuer + schema + status + epoch on chain (D-46 + spec 241)." .

apagr:AgreementCredential a owl:Class ;
    rdfs:subClassOf apvc:VerifiableCredential ;
    rdfs:comment "DOLCE+DnS Situation — the off-chain VC describing a two-party agreement. Issued by Global Church (or any issuer). Held in each party's PV. Per PD-22." .

apagr:hasIssuer a owl:ObjectProperty ;
    rdfs:range ap:Agent .

apagr:hasParty a owl:ObjectProperty ;
    rdfs:range ap:Agent ;
    rdfs:comment "Cardinality 2 — the two parties." .

apagr:agreementCommitmentHash a owl:DatatypeProperty ;
    rdfs:range xsd:hexBinary .

apagr:status a owl:DatatypeProperty ;
    rdfs:range xsd:string ;
    rdfs:comment "ACTIVE | COMPLETED | DISPUTED | REVOKED (per spec 241 §5.4.1)." .
```

## 7. `payments` — TTL drafts

### 7.1 `packages/ontology/tbox/payment.ttl` (T-box — centralized)

```turtle
@prefix appay:  <https://agenticprimitives.dev/ns/payment#> .
@prefix apvc:   <https://agenticprimitives.dev/ns/credential#> .
@prefix apint:  <https://agenticprimitives.dev/ns/intent#> .

appay:PaymentMandate a owl:Class ;
    rdfs:comment "Signed, scoped, context-bound payment authority. AP2 + x402 + ERC-4337 paymaster aligned (spec 243)." .

appay:PaymentReceipt a owl:Class ;
    rdfs:subClassOf apvc:VerifiableCredential ;
    rdfs:comment "Immutable VC issued by rail executor on successful redemption. Asserted to AttestationRegistry; no revoke." .

appay:MandateConstraints a owl:Class ;
    rdfs:comment "AP2-style aggregate scope: maxAggregateAmount, frequency, categories. Orthogonal to amountPolicy (per redemption)." .

appay:ContextBinding a owl:Class ;
    rdfs:comment "Hard substrate invariant: payment signatures bind to intentId / taskId / agreementCommitment / resource (PMT-3)." .

appay:contextBindingIntentId a owl:ObjectProperty ;
    rdfs:domain appay:PaymentMandate ;
    rdfs:range apint:Intent .

appay:rail a owl:DatatypeProperty ;
    rdfs:range xsd:string ;
    rdfs:comment "'x402' | 'wallet' | 'sponsored-userop' | 'escrow' | 'invoice' | 'confidential-*' (W2)" .
```

## 8. `fulfillment` — TTL drafts

### 8.1 `packages/ontology/tbox/fulfillment.ttl` (T-box — centralized)

```turtle
@prefix apful:  <https://agenticprimitives.dev/ns/fulfillment#> .
@prefix apagr:  <https://agenticprimitives.dev/ns/agreement#> .
@prefix prov:   <http://www.w3.org/ns/prov#> .

apful:FulfillmentCase a owl:Class ;
    rdfs:subClassOf prov:Activity ;
    rdfs:comment "Operational container tying an Agreement to its execution. Layer 10. Lifecycle: drafted → ... → archived (spec 244 §4.2)." .

apful:Task a owl:Class ;
    rdfs:subClassOf prov:Activity ;
    rdfs:comment "Executable unit of work. A2A state machine (spec 244 §5.2; spec 245)." .

apful:Message a owl:Class ;
    rdfs:comment "Communication. Bodies in JV. NEVER in public registry (D-46.1)." .

apful:Artifact a owl:Class ;
    rdfs:subClassOf prov:Entity ;
    rdfs:comment "Produced deliverable. Hash-anchored; body in vault. Promotable to EvidenceCredential." .

apful:HandoffPolicy a owl:Class ;
    rdfs:comment "First-class handoff authority. allowedTargets + preservePrivacyTier + maxHopCount (spec 244 §7)." .

apful:hasParentAgreement a owl:ObjectProperty ;
    rdfs:domain apful:FulfillmentCase ;
    rdfs:range apagr:AgreementCommitment .

apful:taskState a owl:DatatypeProperty ;
    rdfs:domain apful:Task ;
    rdfs:range xsd:string ;
    rdfs:comment "A2A canonical states: submitted | working | completed | failed | canceled | input-required | rejected | auth-required." .

# IntentTraceSpan lives here too (Decision 7 in ADR-0024).
apful:IntentTraceSpan a owl:Class ;
    rdfs:subClassOf prov:Activity ;
    rdfs:comment "Typed trace span emitted on layer-cross transitions. parent/child tree forms case audit." .
```

### 8.2 `packages/fulfillment/src/shapes/fulfillment.shacl.ttl` (C-box)

```turtle
@prefix apful:  <https://agenticprimitives.dev/ns/fulfillment#> .
@prefix sh:     <http://www.w3.org/ns/shacl#> .

apful:TaskShape a sh:NodeShape ;
    sh:targetClass apful:Task ;
    sh:property [
        sh:path apful:taskState ;
        sh:in ( "submitted" "working" "completed" "failed" "canceled" "input-required" "rejected" "auth-required" ) ;
        sh:minCount 1 ; sh:maxCount 1
    ] ;
    sh:property [
        sh:path apful:assignee ;
        sh:nodeKind sh:IRI ;
        sh:minCount 1 ; sh:maxCount 1
    ] ;
    sh:property [
        sh:path apful:permissionGrantRef ;
        sh:nodeKind sh:IRI ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:description "Every Task has an authorizing delegation (FLF-INV-02)."
    ] .

apful:MessageShape a sh:NodeShape ;
    sh:targetClass apful:Message ;
    sh:property [
        sh:path apful:sender ;
        sh:nodeKind sh:IRI ;
        sh:minCount 1 ; sh:maxCount 1
    ] ;
    sh:property [
        sh:path apful:bodyRef ;
        sh:nodeKind sh:IRI ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:description "Body MUST be vault-resident (FLF-INV-04 + D-46.1)."
    ] .

apful:ArtifactShape a sh:NodeShape ;
    sh:targetClass apful:Artifact ;
    sh:property [
        sh:path apful:bodyHash ;
        sh:datatype xsd:hexBinary ;
        sh:minCount 1 ; sh:maxCount 1
    ] ;
    sh:property [
        sh:path apful:disclosurePolicy ;
        sh:datatype xsd:string ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:description "Per-field DisclosurePolicy (D-42)."
    ] .
```

## 9. `attestations` — TTL drafts (credential types)

```turtle
@prefix apatt:  <https://agenticprimitives.dev/ns/attestation#> .
@prefix apvc:   <https://agenticprimitives.dev/ns/credential#> .

# Credential type taxonomy (substrate-wide)
apatt:AssociationCredential a owl:Class ;
    rdfs:subClassOf apvc:VerifiableCredential ;
    rdfs:comment "Holder asserts membership/association with an issuer. Holder-only revoke." .

apatt:EvidenceCredential a owl:Class ;
    rdfs:subClassOf apvc:VerifiableCredential ;
    rdfs:comment "Holder-issued evidence credential bound to an Artifact. Layer 12." .

apatt:OutcomeCredential a owl:Class ;
    rdfs:subClassOf apvc:VerifiableCredential ;
    rdfs:comment "Outcome credential bound to an Intent (cites Evidence). Layer 13. FLF-OUT-1: MUST cite ≥ 1 Evidence UID." .

apatt:ValidationCredential a owl:Class ;
    rdfs:subClassOf apvc:VerifiableCredential ;
    rdfs:comment "Validator's attestation of an Outcome. Layer 14. Validator-type discriminated (human/agent/oracle/TEE/zkML/re-execution). ERC-8004 Validation Registry pattern." .

apatt:TrustUpdate a owl:Class ;
    rdfs:subClassOf apvc:VerifiableCredential ;
    rdfs:comment "Reputation mutation. Layer 15. Hard substrate invariant: cites ≥ 1 ValidationCredential UID. ERC-8004 Reputation Registry pattern. No TrustUpdate without Validation citation." .

apatt:basedOnIntent a owl:ObjectProperty ;
    rdfs:domain apatt:OutcomeCredential ;
    rdfs:range apint:Intent .

apatt:citesValidation a owl:ObjectProperty ;
    rdfs:domain apatt:TrustUpdate ;
    rdfs:range apatt:ValidationCredential ;
    rdfs:comment "MANDATORY (D-40). At least one citation required." .
```

## 10. Ontology package changes (REVISED for hybrid model)

Under the hybrid model the ontology package gains substantially more than a namespace registry — it gains seven new T-box files and the spine-standards mapping file. All declarative; no runtime logic. The package stays within ADR-0018's "monorepo-wide formal ontology" scope, broadened explicitly by spec 225 §11.5 (proposed).

**Files added to `packages/ontology/`:**

```
tbox/intents.ttl             — Intent + IntentMatch + Commitment + Desire (§4.1)
tbox/constraints.ttl         — ConstraintSet + AssumptionSet + Constraint domains (§4.2)
tbox/resolution.ttl          — Resolver + ResolvedOrder (skeleton; §5.1)
tbox/agreement.ttl           — AgreementCommitment + AgreementCredential (§6.1)
tbox/payment.ttl             — PaymentMandate + PaymentReceipt + ContextBinding + MandateConstraints (§7.1)
tbox/fulfillment.ttl         — FulfillmentCase + Task + Message + Artifact + HandoffPolicy + IntentTraceSpan (§8.1)
tbox/attestation.ttl         — Association/Evidence/Outcome/Validation/TrustUpdate credential types (§9)
mappings/spine-standards.ttl — owl:equivalentClass crosswalks to ERC-7521/7683/8004 + A2A + Anoma + x402 (§11)
context.jsonld               — namespace prefix additions (apint/apcst/apres/apagr/appay/apful/apatt/apvc)
src/index.ts                 — IRI constants extension (NS / CLASS / PREDICATE for spine concepts)
```

**Files added to OWNING packages (SHACL only):**

```
packages/intent-marketplace/src/shapes/intents.shacl.ttl
packages/intent-marketplace/src/shapes/constraints.shacl.ttl
packages/intent-resolver/src/shapes/resolution.shacl.ttl       (W2 implementation; W1 is skeleton only)
packages/agreements/src/shapes/agreement.shacl.ttl
packages/payments/src/shapes/payment.shacl.ttl
packages/fulfillment/src/shapes/fulfillment.shacl.ttl
packages/mcp-runtime/src/shapes/a2a-task.shacl.ttl
packages/attestations/src/shapes/credentials.shacl.ttl
```

Each owning package's SHACL shapes import the T-box classes from `@agenticprimitives/ontology` (via JSON-LD `@context` resolution) and add the runtime invariants specific to that package's flows. The on-chain `ShapeRegistry.defineShape(...)` hash is computed from the canonical SHACL bytes per package and registered at deploy time (per the existing PD-12 round-trip convention).

## 11. External-standard mappings (spec 225 §9 extensions)

The mappings file gets enriched with crosswalks for each spine concept to industry standards. Proposed `packages/ontology/mappings/spine-standards.ttl`:

```turtle
@prefix apint:  <https://agenticprimitives.dev/ns/intent#> .
@prefix apful:  <https://agenticprimitives.dev/ns/fulfillment#> .
@prefix apagr:  <https://agenticprimitives.dev/ns/agreement#> .
@prefix appay:  <https://agenticprimitives.dev/ns/payment#> .
@prefix erc7521: <https://eips.ethereum.org/EIPS/eip-7521#> .
@prefix erc7683: <https://www.erc7683.org/#> .
@prefix erc8004: <https://eips.ethereum.org/EIPS/eip-8004#> .
@prefix a2a:    <https://google.github.io/A2A/specification/#> .
@prefix anoma:  <https://anoma.net/spec#> .
@prefix x402:   <https://www.x402.org/spec#> .
@prefix vf:     <https://w3id.org/valueflows#> .
@prefix ufo-c:  <http://purl.org/nemo/ufo-c#> .

# ─── Intent crosswalks ────────────────────────────────────────────────
apint:Intent owl:equivalentClass anoma:Intent ;
             owl:equivalentClass erc7521:UserIntent ;
             owl:equivalentClass erc7683:Order ;
             rdfs:subClassOf vf:Intent , ufo-c:Intention .

# ─── Fulfillment crosswalks (A2A alignment) ──────────────────────────
apful:Task owl:equivalentClass a2a:Task .
apful:Message owl:equivalentClass a2a:Message .
apful:Artifact owl:equivalentClass a2a:Artifact .

# ─── Payment crosswalks ──────────────────────────────────────────────
appay:PaymentMandate rdfs:subClassOf x402:PaymentRequirement .

# ─── Validation + reputation crosswalks (ERC-8004) ───────────────────
apatt:ValidationCredential owl:equivalentClass erc8004:ValidationRecord .
apatt:TrustUpdate owl:equivalentClass erc8004:ReputationRecord .
```

This crosswalk is the substrate's external-standard bridge — it lets a downstream consumer reason that "an apint:Intent is an erc7521:UserIntent" without reading our spec text.

## 12. Migration plan (REVISED for hybrid model)

The T-box content lands in the ontology package FIRST so owning-package SHACL shapes have IRIs to reference. The owning-package SHACL shapes follow when each package's W1 implementation begins.

**Phase 1 — T-box centralization (gated by spec 225 §11.5 + ontology CLAUDE.md drift-trigger revision; see §13):**

| Artifact | Lands at | Owning spec |
|---|---|---|
| `packages/ontology/tbox/intents.ttl` + `constraints.ttl` + `resolution.ttl` (skeleton) + `agreement.ttl` + `payment.ttl` + `fulfillment.ttl` + `attestation.ttl` | `@agenticprimitives/ontology` | spec 225 §11.5 (scope expansion) |
| `packages/ontology/mappings/spine-standards.ttl` | `@agenticprimitives/ontology` | spec 225 §9 |
| `packages/ontology/context.jsonld` namespace addition | `@agenticprimitives/ontology` | spec 225 §11.5 |
| `packages/ontology/src/index.ts` IRI constant additions (NS / CLASS / PREDICATE) | `@agenticprimitives/ontology` | spec 225 §11.5 |

**Phase 2 — SHACL per owning package (gated by each package's W1 implementation):**

| Owning package | SHACL files land at | Owning spec |
|---|---|---|
| `intent-marketplace` | `src/shapes/intents.shacl.ttl` + `constraints.shacl.ttl` | spec 239 |
| `intent-resolver` (skeleton) | `src/shapes/resolution.shacl.ttl` (stub only W1) | spec 239 §4.5 |
| `agreements` | `src/shapes/agreement.shacl.ttl` | spec 241 |
| `payments` | `src/shapes/payment.shacl.ttl` | spec 243 |
| `fulfillment` | `src/shapes/fulfillment.shacl.ttl` | spec 244 |
| `mcp-runtime` (a2a sub-module) | `src/shapes/a2a-task.shacl.ttl` | spec 245 |
| `attestations` | `src/shapes/credentials.shacl.ttl` | spec 242 |

The on-chain peer ([ADR-0009](./decisions/0009-on-chain-ontology-shacl-naming.md)) gets the SHACL shapes registered to `ShapeRegistry.defineShape(...)` at deployment time — that's where the off-chain `keccak256(SHACL bytes)` matches the on-chain `shapeHash`. Lockstep is enforced by the existing PD-12 round-trip convention.

## 13. Required upstream changes (gating Phase 1)

The hybrid model requires three explicit upstream changes before T-box content lands in `@agenticprimitives/ontology`:

### 13.1 Spec 225 §11.5 — scope expansion

Add a new section to spec 225 §11 (currently `## 11. Scope bounding & phased plan`):

> **§11.5 Substrate spine vocabulary (added 2026-06-02b per ADR-0024 + spine-ontology-extensions.md).**
> The monorepo-wide formal ontology (ADR-0018) includes T-box class definitions, properties, and external-standard crosswalks for the v2 15-layer coordination spine: intent / constraint / resolution / agreement / payment / fulfillment / attestation. The corresponding SHACL shapes (runtime invariants) live in each owning package per PD-19. Cross-standard mappings live in `packages/ontology/mappings/spine-standards.ttl`. This expands the original §11 scope (identity / credential / custody / delegation / audit / naming / org) to include the substrate's coordination vocabulary.

### 13.2 `packages/ontology/CLAUDE.md` drift trigger revision

Update the existing drift trigger:

**Before:**
> "Add marketplace/intents/geo vocabulary" — **STOP.** Out of the spec 225 §11 scope bound (identity/credential/custody/delegation/audit/naming/org).

**After:**
> "Add **runtime SHACL shapes** for marketplace/intents/fulfillment/payments" — **STOP** (those live in their owning packages per PD-19; see spec 225 §11.5).
>
> "Add **T-box class definitions** for spine substrate concepts (`apint:` / `apcst:` / `apres:` / `apagr:` / `appay:` / `apful:` / `apatt:` / `apvc:`)" — explicitly **in scope** per spec 225 §11.5 (broadened 2026-06-02b after the v2 coordination substrate landed).
>
> "Add vocabulary for verticals / branding / white-label content (faith / health / education domain terms)" — **STOP.** Out of scope; lives in apps per ADR-0021.
>
> "Add geo vocabulary" — **STOP.** Geo is per-vertical; apps own it.

### 13.3 ADR-0018 — explicit acknowledgment

ADR-0018 ("monorepo-wide formal ontology") doesn't require structural changes — its "monorepo-wide" claim already encompasses the spine. But the ADR should gain a paragraph acknowledging that the v2 coordination substrate's vocabulary IS part of the monorepo-wide ontology root, with a pointer to spec 225 §11.5 + this doc. ~10 lines.

## 14. Validation checklist

Before any TTL file lands:

- [ ] IRI prefix matches §2 namespace plan
- [ ] Residency matches §1 table (T-box → ontology; SHACL → owning package)
- [ ] Anoma / ERC-7683 / A2A / W3C VC crosswalks documented where applicable
- [ ] SHACL shapes enforce hard invariants (per spec)
- [ ] On-chain SHACL hash registered to `ShapeRegistry` matches off-chain TTL canonicalization
- [ ] `pnpm check:no-domain-in-packages` passes (no vertical vocabulary in any TTL)
- [ ] `pnpm check:forbidden-terms` passes
- [ ] §13.1 spec 225 §11.5 addendum landed BEFORE T-box files land in ontology package
- [ ] §13.2 ontology CLAUDE.md drift trigger revised BEFORE T-box files land in ontology package

## 15. Open questions

**L-29.** Should `apint:Intent` be RDF-typed in TWO concurrent ways — `apint:Intent rdfs:subClassOf ufo-c:Intention , vf:Intent` — or pick one as canonical and use `owl:equivalentClass` for the other? Current draft uses subclass-of-both for ontology composability with both upper ontologies. Revisit if downstream reasoners disagree.

**L-30.** Are there any **runtime** validation cases where a SHACL shape spans across owning packages (e.g., a constraint that requires consulting both intent-marketplace and payments at validation time)? If yes, where does that cross-package shape live? Current model says: each package validates its own; cross-package invariants are enforced at the contract boundary (e.g., `isAssertableCommitment` in spec 241 §6). Revisit if a genuine cross-package SHACL need emerges.

---

## Closing

Spine vocabularies extend the substrate's formal foundation **using the hybrid model**: T-box class definitions live centrally in `@agenticprimitives/ontology` (per ADR-0018 monorepo-wide formal ontology); SHACL shapes (runtime invariants) live in each owning package (per PD-19). This requires explicit upstream changes to spec 225 §11.5 + the ontology package CLAUDE.md drift trigger (per §13 above) before T-box files land in the ontology package.

Anoma CSP alignment + ERC-7683 resolver pattern + A2A task model + W3C VC envelope are the four anchor standards the spine speaks fluently, encoded as `owl:equivalentClass` / `rdfs:subClassOf` relations in `packages/ontology/mappings/spine-standards.ttl`.

**Architectural call (revised after challenge 2026-06-02b):** the v2 coordination substrate's vocabulary IS monorepo-wide formal ontology and belongs in the ontology root. The original drift trigger was correct at its time of writing (substrate scope was identity/credential/custody/delegation/audit/naming/org); the v2 spine expands the substrate substantially and the trigger expands with it.

Implementation lands when packages get scaffolded. Until then, this doc is the contract.
