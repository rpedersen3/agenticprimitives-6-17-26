# Spec 239 — Intent Marketplace (Direct Lane)

**Status:** draft, 2026-06-02.
**Owner:** demo-jp.
**Owns spine layers:** 2 Intent, 3 ConstraintSet + AssumptionSet, 4 Resolution, 5 Proposal/Order, 6 SolverBid/MatchCandidate, 7 IntentMatch (per [ADR-0024](../docs/architecture/decisions/0024-intent-coordination-substrate.md) Decision 2).
**Companion docs:** [apps/demo-jp/docs/information-architecture.md](../apps/demo-jp/docs/information-architecture.md) (§3b, §4d, §5.8, §5.9, §16, §17), [apps/demo-jp/docs/packages.md](../apps/demo-jp/docs/packages.md) (§4c, §10.3), [spec 236 — JP Adopt-a-People-Group](236-jp-adoption-pilot.md), [spec 241 — Agreement Registry](241-agreement-commitment-registry.md), [spec 242 — Verifiable Credentials + Attestations](242-trust-credentials-and-public-assertions.md), [spec 243 — Payments](243-payments.md), [spec 244 — Fulfillment](244-fulfillment.md).
**Architecture-of-record:** [coordination-substrate.md](../docs/architecture/coordination-substrate.md) (15-layer reference), [privacy-and-self-sovereign-identity.md](../docs/architecture/privacy-and-self-sovereign-identity.md) (privacy posture), [ADR-0024](../docs/architecture/decisions/0024-intent-coordination-substrate.md) (substrate decisions), [ADR-0023](../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) (downstream attestation surface).
**Industry references:** [ERC-7521](https://eips.ethereum.org/EIPS/eip-7521) (general intents), [ERC-7683](https://www.erc7683.org/) (cross-chain intents + resolver assumptions), [Anoma](https://anoma.net/) (intent-centric architecture), [CoW Protocol](https://www.shoal.gg/p/cow-swap-intents-mev-and-batch-auctions) (signed orders + solver competition), [UniswapX](https://docs.uniswap.org/contracts/uniswapx/overview) (signed filler-bid orders), [A2A](https://google.github.io/A2A/) (Task / Message / Artifact separation), [MCP](https://modelcontextprotocol.io/specification) (tool / resource / consent model).

> **Number assignments (locked 2026-06-02):** spec **241** = Agreement Registry. spec **242** = Verifiable Credentials + Attestations. This spec **239** = Intent Spine (Direct Lane). Spec 240 belongs to an unrelated wave (native-agentic-primitives platform strategy); 239 / 241 / 242 are the demo-jp upgrade trio.

## 1. Purpose

`demo-jp` needs a **marketplace layer above the agreement layer** — the substrate that lets an adopter publish "I need a Najdi-FPG facilitator", JP broker matches between expressed needs and expressed offerings, and the matched pair land at the bilateral-signed Commitment that the existing agreement flow expects as its input.

This spec defines the **Direct Lane** of that marketplace (smart-agent spec 001 pattern): pairwise matching of opposite-direction Intents by JP-as-broker, leading to a signed Commitment. Pool Lane (donor → fund) and Proposal Lane (proposer → RFP) are explicitly deferred (`L-13`, `L-14`).

W1 scope:

- Intent expression by Adopter / Facilitator personas (individual or Org).
- JP-as-broker, mediated by per-intent Tier-3 cross-delegations from the expresser.
- MatchInitiation creation with a snapshotted ranking basis.
- Two-sided MatchInitiation acceptance → IntentMatch.
- Bilateral-signed Commitment.
- Hand-off into the existing agreement flow (proposed §4c, §10b — see IA doc).

Out of W1: any on-chain Intent / Match registry, Pool / Proposal lanes, BBS+ selective-disclosure presentations, PrivateZK visibility tier, the downstream Plan + Case + Activity layer (smart-agent's FulfillmentPlan / FulfillmentCase / WorkItem) — these are all separately listed L-N items in the IA doc.

## 2. Reference: smart-agent patterns to port (REQUIRED)

Per CLAUDE.md ("Always check smart-agent first"), this spec ports the load-bearing patterns from `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`). The patterns ported here come from a thorough survey of that branch's intent-marketplace surface; the survey itself is captured in [apps/demo-jp/docs/information-architecture.md](../apps/demo-jp/docs/information-architecture.md) §3b–§17.

### 2.1 Patterns ported wholesale

| Pattern | smart-agent location | Why we port | Where it lands here |
|---|---|---|---|
| Intent ⊂ ufo:Intention (NOT prov:Plan) | `/docs/specs/marketplace-lifecycle-alignment.md` § 6, `/docs/ontology/tbox/intents.ttl` | Half of demo-jp's intents ("I want to facilitate", "I need a partner") are intentions without a plan. Subclassing under prov:Plan forces a fictitious plan into every record. | §4, §6.1 |
| Single Intent class + `direction` property (Receive\|Give) | `/docs/ontology/tbox/intents.ttl` | Smart-agent rejected-design #3: subclassing into `RequestIntent` / `OfferIntent` embeds user-grammar ambiguity. One class, two enum-like directions. **Matcher MUST NOT branch on `intentType`.** | §4, §6.1, §7 |
| Derived subclasses `RecipientIntent` / `ProviderIntent` (and deprecated aliases `RequirementIntent` / `ProvisionIntent`) | `/docs/ontology/tbox/intents.ttl` | Subclasses exist in the T-Box for ontology indexing convenience but matcher dispatch reads `direction`. Keep the subclasses for downstream SHACL + SPARQL queries; never use them to branch logic. | §4.1 |
| `OrchestrationPlan` (parent-intent decomposition into sub-intents) | `/docs/ontology/tbox/intents.ttl`, `/docs/specs/intent-bdi-plan.md` | A composite intent ("I need a coaching network") decomposes into sub-intents ("I need coach for skill A", "I need coach for skill B"). Each sub-intent flows the spine independently; the parent tracks fulfillment of all sub-intents. | §4.1 (defined for completeness; demo-jp W1 ships only single-intent flows — sub-intents are L-19) |
| Curated SKOS intent-type vocabulary (`intentType:NeedCoaching`, `intentType:OfferPrayer`, etc.) | `/docs/ontology/cbox/intent-types.ttl` | UI labels with IRIs, derived from `direction × object`. The vocabulary is opaque to the matcher; UI uses it for grouping + search. Sensitive types (`NeedSafePlace`, `NeedTraumaCare`) default to private visibility. | §4.1, §8.1 |
| Compatibility rule (explicit) | `/docs/specs/intent-bdi-plan.md`, `/docs/specs/generalized-intent-matchmaking.md` | `compatible(a, b) = a.direction != b.direction && a.object == b.object && topicSimilarity(a.topic, b.topic) >= threshold`. Matcher reads direction + object + topic; NEVER intentType. | §7.1 |
| MatchInitiation ≠ IntentMatch | `/docs/specs/intent-marketplace-capabilities.md` (spec 001 hand-off) | MatchInitiation = proposal (pending, may be rejected). IntentMatch = durable pair (accepted). | §5 step-machine, §6.3 |
| Ranking basis snapshot at creation time | `/packages/sdk/src/matchmaker/ranking.ts`, `/docs/specs/matchmaking-strategy.md` | Preserves the rationale for a MatchInitiation even if the trust graph changes later. Filter → Score → Surface pipeline. | §6.2, §7.5 |
| `matchScore` stored as 0..10000 decimal (basis ppm-style) | `/docs/ontology/cbox/intent-shapes.shacl.ttl` | SHACL constraint `exactly 1 decimal between 0 and 10000`. Compute produces 0..1; storage scales to 0..10000 for precision-preserving SHACL validation. | §6.2, §7 |
| Five-tier visibility model + strictest-cascade rule | `/docs/information-architecture/10-intent-marketplace-classification.md` § 3 | Public / PublicCoarse / PrivateCommitment / PrivateZK / OffchainOnly with consequences enforced by SHACL. | §8.1, §11 |
| Sensitive-type private-default behavior | `/apps/person-mcp/src/tools/intents.ts` | Intent types in the sensitive-domain group (smart-agent ships `NeedSafePlace`, `NeedTraumaCare`; demo-jp future additions inherit the pattern) default to `private` visibility in the express UI; user must explicitly elevate. | §8.1 |
| SHACL invariants (Intent shape, IntentMatch shape, Outcome shape, OrchestrationPlan shape) | `/docs/ontology/cbox/intent-shapes.shacl.ttl` | Codifies cardinality + range constraints (e.g. `Intent.direction exactly 1 in (Receive|Give)`, `IntentMatch.matchScore exactly 1 decimal in [0,10000]`). | §8.2, §11.2 |
| Three-tier delegation model (T1 user session / T2 system / T3 cross) | `/docs/information-architecture/15-delegation-design-architecture.md` | The broker's authority model. No blanket grants; per-action scopes; revocable per-grant. | §9 |
| Marketplace scope catalog (`marketplace-scopes.ts`) | `/packages/sdk/src/marketplace-scopes.ts` | Well-known scope strings map cleanly to typed-data domains. | §9.3 |
| Ranking formula (composite of proximity × outcome) | `/packages/sdk/src/matchmaker/ranking.ts` | `score = 0.6 * proximityScore + 0.4 * outcomeScore`, with `outcomeScore = (fulfilled+1)/(fulfilled+abandoned+2)` Laplace-smoothed. | §7 |
| Intent state machine + status SKOS vocabulary | `/docs/specs/intent-bdi-plan.md` § 4.1, `/docs/ontology/cbox/intent-types.ttl` | Status terms: `Drafted`, `Expressed`, `Acknowledged`, `InProgress`, `Fulfilled`, `Withdrawn`, `Abandoned`. | §5 |
| `bump_ack_count` count-based status transitions | `/apps/person-mcp/src/tools/intents.ts` | Count goes 0 → 1: `expressed → acknowledged`. Count goes 1 → 0 (last ack cleared, e.g. MatchInitiation declined): `acknowledged → expressed`. State tracks LIVE acknowledgements, not first-touch. | §5 |
| Beneficiary defaulting rules at express time | `/apps/web/src/lib/actions/intents.action.ts` | Give-intent: beneficiary defaults to giver/self. Personal receive-intent: beneficiary defaults to person agent. **Org-expressed receive-intent: `payload.beneficiaryAgent` is REQUIRED** (org can't be its own beneficiary by default). | §11.1 |
| Outcome metric vocabulary | `/docs/ontology/tbox/intents.ttl`, `/docs/ontology/cbox/intent-types.ttl` | `metric.kind ∈ {count, boolean, date, narrative}`; `status ∈ {Pending, Partial, Achieved, NotAchieved}`. | §4.1, §5 |
| Owner-routed canonical state ("MCP-owned canonical") | `/apps/person-mcp/src/tools/intents.ts`, `/apps/org-mcp/src/tools/intents.ts` (latest comments) | Smart-agent is moving from web-side SQL canonical state toward MCP-owned canonical state. demo-jp ships localStorage as the canonical vault store; the architectural intent ("owner routes the body") ports. | §8.4 |
| Coarse / Summary / Null projections | `/docs/information-architecture/10-intent-marketplace-classification.md` § 7 | The broker gets a view appropriate to its scope; same intent yields different bytes to different readers. | §8.3 |
| Owner-routed vault + "no-duplication" (P4) | `/docs/information-architecture/10-intent-marketplace-classification.md` § 1 | Broker pool only ever holds the projection its delegation scopes — no shadow copies of the full body. | §8.4 |
| Index-page three-section layout (inbox / outbox / hub) | `/apps/web/src/app/h/[hubId]/(hub)/intents/page.tsx` | UX pattern: "Addressed to you" / "You expressed" / "Open in hub/network". Filterable by direction, scope, intent type, priority, geo, search. | §11.3 |

### 2.2 Patterns deliberately NOT ported (with reasoning)

| smart-agent pattern | Why we diverge here |
|---|---|
| On-chain `MatchInitiationRegistry` (spec 001) | W1 stays off-chain (IA D-28). Smart-agent ships on-chain anchors for public-tier MatchInitiations; we defer to L-15 because demo-jp doesn't need cross-device discovery in W1 and the on-chain registry is a separate audit surface. |
| Pool Lane (spec 002 `PoolPledge`, `Pool`, `Fund`) | demo-jp W1 doesn't model pooled disbursement. (`L-13`.) |
| Proposal Lane (spec 003 `GrantProposal`, `Round`, RFP) | demo-jp W1 doesn't model open RFPs / grant rounds. (`L-14`.) |
| `liveAcknowledgementCount` as a T-Box ontology property | Smart-agent rejected-design #4. Implementation-only; we hold it in app state, NOT in the SHACL shapes. |
| GraphDB mirror infrastructure | demo-jp uses localStorage as the vault store; JP's broker pool is itself a localStorage extension. The "owner-routed body + broker-pool mirror" architecture is preserved structurally; the underlying storage is simpler. |
| Single unified `@smart-agent/sdk` package | We split per capability (`intent-marketplace`, `agreements`, `verifiable-credentials`, `attestations`) — see [packages.md](../apps/demo-jp/docs/packages.md). |
| MCP/server-side broker | demo-jp's broker is in-process (Jill, custodying JP). Production deployment of an HCS/MCP broker is post-W1. |

### 2.3 Cognitive layer alignment

The spec carries forward the ontology stack smart-agent landed:

```
UFO-C Cognitive layer
  Desire (latent) → Intention (committed) → Goal (propositional content)

ValueFlows Marketplace layer
  RecipientIntent / ProviderIntent (direction-tagged) → IntentMatch (accepted pair)

UFO-C Social-Contract layer  ← THE COMMITMENT LANDS HERE
  ExchangeAgreement (vf:Agreement, ⩭ ufo:SocialRelator)
  FulfillmentCommitment (vf:Commitment, ⩭ ufo:SocialCommitment)
  ClaimRight (vf:Claim, ⩭ ufo:SocialClaim)
```

W1 implements the cognitive + marketplace layers in `intent-marketplace`. The social-contract layer is the boundary with the Agreement Registry spec (the Commitment + Agreement Credential live there).

The operational (FulfillmentPlan / FulfillmentCase / WorkItem) and execution (FulfillmentActivity / EconomicEvent / Outcome) layers are explicitly out of scope (`L-18`).

## 3. The journey

A user (call them **Sam**, controlling an Adopter Org SA) opens demo-jp and:

1. Onboards as an Adopter Org with JP per IA §4a. JP issues a `JpAssociationCredential`; Sam's vault holds it. Optionally Sam makes the Association public on-chain.
2. Sam expresses an Intent: *"I'm looking to partner with a facilitator covering the Najdi people group, for a six-month adopt-and-pray window, individual-scale capacity, MOU acceptance on file."* Sam picks visibility `public-coarse` (JP and any credentialed reader can see; full body stays in Sam's vault).
3. As part of expressing the intent, Sam signs a Tier-3 cross-delegation to JP (`jp:broker_intent`, pinned to this intent's id) with caveats: 30-day window, JP-only, intent-id-bound. This is the *pre-consent* boundary — Sam has authorized JP to broker matches against this specific intent for that window, but Sam has not yet signed any specific deal.
4. JP indexes the intent into its broker pool, runs the matching across visible offerings, ranks candidates, and creates a MatchInitiation against the best candidate (call them **Maria**, controlling a Facilitator Org SA who's also published an Intent with `direction: Give`, `object: facilitator-capacity`, `peopleGroupId: fpg-najdi-sa`).
5. JP pushes the MatchInitiation into both Sam's and Maria's MatchInbox (a vault key in each party's vault). Both see the proposal with a coarse view of the counterparty (org name, country, capacity bucket, ranking basis snapshot — not the full body).
6. Sam reviews and clicks accept. Maria reviews and clicks accept. JP records both acceptances and mints a durable IntentMatch row in its own vault.
7. Sam and Maria draft a Commitment from the IntentMatch terms. Both sign the canonical agreement (including the `publicDisclosureStance` per party per IA §9). JP attaches a passive `MatchAttestation` — "this Commitment came out of MatchInitiation X" — without signing the Commitment itself.
8. The dual-signed Commitment is the input to §4c step 5a (the agreement lifecycle): Sam + Maria hand it to JP, JP forwards to Global Church, Global Church issues the AgreementCredential, optionally Sam + Maria publish a Joint Agreement Assertion per IA §10b.2.

## 4. Architecture

### 4.1 The ontology classes (T-Box)

```
# === BDI cognitive layer (informs intents) ===
saint:Belief                                 # what an agent holds true (prov:Entity + dul:Description)
saint:Desire                                 # latent motivational state (dul:Desire)
saint:Goal                                   # propositional content of an intention (ufo:Goal)

# === The marketplace primitive ===
saint:Intent
  rdfs:subClassOf  ufo:Intention             # NOT prov:Plan (smart-agent's rejected-design #1)
  saint:direction  (saint:Receive | saint:Give)
  saint:object     skos:Concept              # what's flowing (e.g. resourceType:Worker)
  saint:topic      xsd:string                # human label, e.g. "facilitate the Najdi FPG"
  saint:intentType skos:Concept              # UI label only; matcher MUST NOT branch on this
  saint:expressedBy sa:Agent
  saint:addressedTo sa:Agent                 # cardinality ≥ 1 (multi-address allowed)
  saint:expressedAt xsd:dateTime
  saint:visibility sageo:Visibility          # 1 of 5 tiers
  saint:payload    rdf:JSON                  # vertical-specific (JP-payload lives in app, not package)
  saint:expectedOutcome saint:Outcome
  saint:intentStatus IntentState             # SKOS concept ∈ {Drafted, Expressed, Acknowledged, InProgress, Fulfilled, Withdrawn, Abandoned}

# Derived subclasses (exist for ontology indexing + SPARQL convenience; matcher dispatch reads .direction)
saint:RecipientIntent  rdfs:subClassOf saint:Intent  # direction = Receive
saint:ProviderIntent   rdfs:subClassOf saint:Intent  # direction = Give
saint:RequirementIntent  owl:equivalentClass saint:RecipientIntent  # DEPRECATED alias
saint:ProvisionIntent    owl:equivalentClass saint:ProviderIntent   # DEPRECATED alias

# === Decomposition (for composite intents) ===
saint:OrchestrationPlan                      # decomposes one parent intent into sub-intents
  saint:planFor      saint:Intent            # the parent intent
  saint:hasSubIntent saint:Intent            # cardinality ≥ 2; the sub-intents to fulfill
  # demo-jp W1 ships single-intent flows only; OrchestrationPlan is L-19 (not implemented but the
  # T-Box class is kept stable so future composite intents don't break the model)

# === Match layer ===
saint:MatchInitiation
  saint:viewedIntent     saint:Intent        # the "anchor" intent (the broker started here)
  saint:candidateIntent  saint:Intent        # the proposed counterparty intent (opposite direction)
  saint:basis            saint:RankingBasis  # snapshot at creation; immutable thereafter (SS-01)
  saint:initiatedBy      sa:Agent            # the broker (JP for demo-jp)
  saint:initiationState  (proposed | declined | accepted | expired)
  saint:matchScore       xsd:decimal         # 0..10000 (basis ppm-style); see §6.2

saint:IntentMatch
  saint:originatingMatchInitiation saint:MatchInitiation
  saint:parties [sa:Agent, sa:Agent]
  saint:acceptedAt xsd:dateTime
  # durable; only exists after both-sides-accepted

# === Outcome (for fulfillment + future trust updates) ===
saint:Outcome
  saint:metric { kind: (count | boolean | date | narrative), target?, observed? }
  saint:status (Pending | Partial | Achieved | NotAchieved)

# === Commitment — boundary with Agreement Registry spec ===
saint:Commitment
  saint:originatingIntentMatch saint:IntentMatch
  saint:canonicalAgreement     saint:AgentCollaborationAgreement
  saint:partySignatures        [Signature, Signature]
  # the spec for the agreement subject + ExchangeAgreement / FulfillmentCommitment / ClaimRight
  # split lives in the Agreement Registry spec; intent-marketplace ships only the Commitment envelope
  # that points at its originating IntentMatch.
```

### 4.1.a The curated SKOS intent-type vocabulary (C-Box)

`intentType` is a SKOS leaf concept from a curated vocabulary, NOT a schema-level subclass. Smart-agent's vocabulary (port verbatim — `/docs/ontology/cbox/intent-types.ttl`):

| Intent type | direction | object | demo-jp uses it? |
|---|---|---|---|
| `intentType:NeedInformation` | Receive | resourceType:Data | optional |
| `intentType:NeedHelp` | Receive | resourceType:Worker | optional |
| `intentType:NeedCoaching` | Receive | resourceType:Worker | optional |
| `intentType:NeedFunding` | Receive | resourceType:Money | NO (no funding in demo-jp W1) |
| `intentType:NeedScripture` | Receive | resourceType:Scripture | optional |
| `intentType:NeedVenue` | Receive | resourceType:Venue | optional |
| `intentType:NeedSafePlace` | Receive | resourceType:Venue (sensitive — see below) | NO in demo-jp |
| `intentType:NeedTraumaCare` | Receive | resourceType:Worker (sensitive) | NO in demo-jp |
| `intentType:NeedTreasurer` | Receive | resourceType:Worker | NO |
| `intentType:NeedConnector` | Receive | resourceType:Connector | optional |
| `intentType:WantToContribute` | Give | resourceType:Worker | optional |
| `intentType:OfferSkill` | Give | resourceType:Skill | optional |
| `intentType:OfferPrayer` | Give | resourceType:Prayer | **YES (load-bearing for demo-jp)** |
| `intentType:OfferIntroduction` | Give | resourceType:Connector | optional |
| `intentType:OfferInformation` | Give | resourceType:Data | optional |
| `intentType:OfferFunding` | Give | resourceType:Money | NO |
| `intentType:OfferVenue` | Give | resourceType:Venue | optional |
| `intentType:OfferTeaching` | Give | resourceType:Curriculum | optional |

**JP-vertical additions** (defined in `apps/demo-jp/src/lib/intent-payload.ts`, NOT in the package):

| Intent type | direction | object | Purpose |
|---|---|---|---|
| `intentType:NeedFacilitatorForFpg` | Receive | resourceType:Worker (facilitator-capacity) | Adopter wants a facilitator for a specific people group |
| `intentType:OfferFacilitatorCapacity` | Give | resourceType:Worker (facilitator-capacity) | Facilitator publishes capacity to receive adopters |

**Sensitive-type private-default rule:** intent types tagged as `sensitive` in the SKOS vocabulary (smart-agent ships `NeedSafePlace`, `NeedTraumaCare`) MUST default to `visibility: private-commitment` at the express UI. The user can elevate to coarse/public explicitly; the default refuses to surface a sensitive request publicly. demo-jp does NOT ship sensitive intent types in W1, but the package surface MUST respect the rule so future additions inherit it.

### 4.2 Why these four classes, not three or five

| Boundary | Why explicit |
|---|---|
| `Intent` vs `MatchInitiation` | Intent is unilateral (expresser's desire); MatchInitiation is the broker's bilateral proposal. Different signers, different lifetimes. |
| `MatchInitiation` vs `IntentMatch` | Proposal-vs-accepted (smart-agent invariant). MatchInitiation has the rationale audit trail (`basis`); IntentMatch is the durable pair. Collapsing loses both. |
| `IntentMatch` vs `Commitment` | IntentMatch says "these two parties have agreed to draft together"; Commitment is the signed deal. The party signatures live on the Commitment, not the Match. |
| `Commitment` vs `AgreementCredential` | Commitment is parties-only; AgreementCredential adds the issuer attestation (Global Church). Spec boundary: intent-marketplace ships Commitment; the Agreement Registry spec ships AgreementCredential issuance. |

### 4.3 What's on-chain in W1 (nothing from this spec)

Per IA D-28, the Intent and Match layers are vault-only in W1. There are **zero new contracts** introduced by this spec. The Commitment hands off to the Agreement Registry spec, which is where the first on-chain row appears.

This is deliberate. Smart-agent spec 001 ships an on-chain `MatchInitiationRegistry`; we defer it (`L-15`) because demo-jp W1 doesn't need cross-device discovery and adding the contract surface (with its own visibility-cascade and access-control invariants) without a real product need is scope creep.

### 4.4 ConstraintSet + AssumptionSet — CSP-grounded, first-class structured types (D-38)

The `payload` field on `Intent` carries vertical content (per-FPG ids, MOU receipt format, capacity matrices, etc.). The **solver-critical requirements** — the parts the matchmaker MUST validate before scoring — live in typed `ConstraintSet` + `AssumptionSet` objects, NOT buried in `payload`. This is a deliberate departure from smart-agent + a deliberate alignment with [Anoma's CSP-style intent model](https://anoma.net/) and [ERC-7683's resolver-assumption pattern](https://www.erc7683.org/).

**`ConstraintSet` (CSP-shaped):**

```ts
interface ConstraintSet {
  // Hard constraints — enforceable invariants; matcher MUST reject if violated
  hardConstraints: Constraint[];
  // Soft constraints — scorer preferences; contribute to composite score
  softConstraints: Constraint[];
  // Per-field DisclosurePolicy (D-42); applies to each constraint field
  fieldDisclosure: Record<string /* field path */, VisibilityTier>;
}

interface Constraint {
  variable: string;                // e.g. 'geo', 'requiredCredential', 'capacity', 'beneficiaryAgent'
  domain: ConstraintDomain;        // discriminated union: enum / range / set / predicate
  source: 'user-asserted' | 'llm-inferred' | 'policy-imposed';  // D-43 provenance
  rationale?: string;              // human-readable explanation (for inferred / policy-imposed)
  fieldDisclosure?: VisibilityTier; // optional per-field override
}

type ConstraintDomain =
  | { kind: 'enum'; values: string[] }
  | { kind: 'range'; min: bigint | number; max: bigint | number; unit: string }
  | { kind: 'set'; allowedSet: string[]; deniedSet?: string[] }
  | { kind: 'predicate'; expression: string /* SHACL or JSONPath */ };
```

**`AssumptionSet`** carries the resolver-assumption parallel from ERC-7683 — what the Resolver (Layer 4) claims is true so solvers can validate before bidding:

```ts
interface AssumptionSet {
  resolverId: string;                    // Resolver identity / version
  namedAssumptions: NamedAssumption[];
  risks: string[];                       // Identified risks the resolver flagged
  requiredValidations: ValidationRequirement[]; // What MUST be checked before commit
}

interface NamedAssumption {
  name: string;                          // e.g. 'price-source-is-CoW-AMM', 'counterparty-is-KYCd'
  description: string;
  trustLevel: 'asserted' | 'verified' | 'oracle' | 'zkp';
  evidenceRef?: string;                  // VC URI / attestation UID
}
```

**Why CSP-shaped + Anoma-aligned.** Anoma treats intents as **constraint satisfaction problems** over future state-spaces. Solvers / matchmakers find solutions in the feasible region. Encoding hard vs. soft constraints as typed objects (not freeform JSON) lets:
- The matchmaker enforce hard constraints as filters (compatibility rule per §7.1)
- The scorer evaluate soft constraints into the composite score (§7.2)
- The Resolver (Layer 4) normalize / expand / propose canonicalizations
- SHACL validate every constraint per its `domain.kind`
- Downstream consumers (audit, dispute, replay) reason about what was bound

**Why source provenance matters.** LLMs will infer constraints from natural-language intent expressions. Inferred values MUST be distinguishable from user-asserted ones — for redaction before publication (privacy), for review before commitment (consent), and for blame attribution (audit). Per D-39 + D-43.

**SHACL.** `ConstraintSet` + `AssumptionSet` get their own SHACL shapes in `packages/intent-marketplace/src/shapes/constraints.shacl.ttl` per PD-19. The ontology-layer planning lives in spec 225; this spec depends on those shapes existing.

### 4.5 The Resolver layer (`@agenticprimitives/intent-resolver` — skeleton W1)

**Architectural separation (PD-25 REVISED 2026-06-02b).** The Resolver layer (Layer 4 of the spine) lives in its own package, `@agenticprimitives/intent-resolver`. Rationale: the Resolver translates an opaque expressed `Intent` into an executable canonical form (normalized constraints, expanded credential requirements, named resolver assumptions, allowed counterparty policies, evidence requirements). This is a distinct capability from intent expression + matchmaking and deserves clean separation per Anoma / ERC-7683 separation-of-concerns.

**W1 skeleton.** The package ships in W1 as types + TODO stubs:

```ts
// @agenticprimitives/intent-resolver
export interface IIntentResolver {
  /** Translates an expressed Intent into a normalized ResolvedOrder */
  resolve(intent: Intent): Promise<ResolvedOrder | null>;
}

export interface ResolvedOrder {
  resolvedFromIntentId: string;
  canonicalConstraints: ConstraintSet;       // normalized + expanded
  expandedAssumptions: AssumptionSet;        // resolver-asserted
  validationRequirements: ValidationRequirement[];
  // ERC-7683 GaslessCrossChainOrder shape (for future on-chain interop)
  erc7683Order?: GaslessCrossChainOrder;
}

// W1: a single trivial PassThroughResolver implementation that
// returns the intent's existing ConstraintSet/AssumptionSet unchanged.
// W2+: per-domain resolvers (faith, marketplace, payments, etc.)
//      can register against this interface.
```

W2 implementation adds: per-domain resolvers (e.g. `JpAdoptionResolver`, `CoachingResolver`), constraint normalization (e.g. "Coloradans" → `geo: 'US-CO'`), credential-requirement expansion (e.g. `requiredFaithCredential` → `[JpAssociationCredential, FaithLeadershipCredential, ...]`), and ERC-7683 `GaslessCrossChainOrder` emission for cross-chain solver-network interop.

### 4.5a ResolutionReceipt — first-class W1 typed object (DOC-1 enforcement)

Even though the resolver **engine** is deferred to W2, the `ResolutionReceipt` **type** is locked in W1 as a first-class typed object. This is the load-bearing AI-auditability surface: when AI is involved in interpreting / normalizing / expanding an Intent, the substrate's [north-star principle DOC-1](../docs/architecture/coordination-substrate.md#27-the-substrate-is-an-intent-to-fulfillment-protocol-not-just-a-marketplace) ("no invisible authority transfer from conversation to execution") requires that the AI's reasoning artifacts be typed + signed + inspectable.

`ResolutionReceipt` captures the provenance of every resolution: model + version + prompt-hash + tool-call-hashes + confidence + policy checks + whether the user explicitly confirmed. It carries NO authority — it carries **proof of resolution provenance**. Authority lives in the canonical Intent + ConstraintSet that the receipt points at.

```ts
interface ResolutionReceipt {
  // Identity
  id: string;                              // e.g. "res_01J..."
  type: "ResolutionReceipt";
  version: "1.0";

  // Inputs (what was resolved)
  inputRefs: {
    naturalLanguagePromptHash?: Hex32;     // hash of the raw user prompt (NL)
    sourceIntentRef?: string;              // if resolving an existing draft Intent
    sourceA2aMessageHash?: Hex32;          // if resolving an A2A inbound message
    contextRefs: string[];                 // memory / history refs (MCP resource IRIs)
  };

  // Resolver provenance (WHO + HOW)
  resolver: {
    agentId: SAAddress;                    // SA of the resolver agent
    agentClass: 'concierge' | 'resolver' | 'orchestrator' | 'hybrid';
    version: string;                       // resolver package + version (semver)
    model?: {                              // when LLM-assisted
      name: string;                        // e.g. "gpt-4.1" / "claude-opus-4-7" / "local-llama-3.3"
      version: string;
      provider: string;
    };
    policyVersion: string;                 // hash of the resolver policy at resolution time
    toolCalls?: ToolCallTrace[];           // MCP tool invocations during resolution
  };

  // Outputs (what was produced)
  outputIntentRef: string;                 // the canonical Intent the resolution targets
  constraintSetRef: string;                // the resulting ConstraintSet
  assumptionSetRef?: string;               // the resulting AssumptionSet (if assumptions named)

  // Resolution character (confidence, completeness)
  confidence: number;                      // 0..1; substrate threshold for proceed-without-confirmation
  unresolvedAmbiguities?: string[];        // fields the resolver could not infer
  missingInformation?: string[];           // fields the user MUST provide (substrate refuses without)

  // Authority gate (most important field — DOC-1 enforcement)
  requiresUserConfirmation: boolean;       // TRUE if any inferred field exceeds confidence threshold OR is sensitive (D-39 source: llm-inferred AND privacy-sensitive)
  userConfirmedAt?: ISODate;               // populated when user explicitly confirms
  userConfirmationSignature?: EIP712Signature; // SA signature of the canonical Intent+ConstraintSet at confirmation time

  // Policy + safety checks
  policyChecks: PolicyCheckResult[];       // e.g. [{ name: 'budget-present', passed: true }, { name: 'expiry-present', passed: false }]
  riskFlags: string[];                     // e.g. ['external-payment-needed', 'pii-disclosure-required']

  // Audit
  createdAt: ISODate;
  signature: EIP712Signature;              // SA-signed by resolver
}

interface ToolCallTrace {
  toolName: string;                        // MCP tool IRI
  inputHash: Hex32;
  outputHash: Hex32;
  durationMs: number;
}

interface PolicyCheckResult {
  name: string;
  passed: boolean;
  rationale?: string;
}
```

**Substrate invariants on ResolutionReceipt (RR-INV-01 .. RR-INV-05):**

| ID | Invariant | Why |
|---|---|---|
| **RR-INV-01** | If `requiresUserConfirmation = true`, downstream layers (matchmaker, agreement, payment) MUST refuse to consume the Intent until `userConfirmedAt` + `userConfirmationSignature` are populated | DOC-1 enforcement — no invisible authority transfer |
| **RR-INV-02** | The `userConfirmationSignature` MUST cover the canonical Intent + ConstraintSet bytes (not the receipt itself) — so the user is signing the typed authority objects, not the AI's reasoning trace | Signature binds to authority, not to provenance |
| **RR-INV-03** | Inferred constraints (source = 'llm-inferred' per D-39) AND `confidence < threshold` AND privacy-tier > Public MUST trigger `requiresUserConfirmation = true` | Sensitive inferences are blocked from auto-promotion |
| **RR-INV-04** | The receipt is asserted into `AttestationRegistry` as `ResolutionReceiptCredential` (a credential type per [ADR-0023](../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md)) once produced; revocable by the resolver SA only | Audit trail for AI involvement |
| **RR-INV-05** | The substrate's W1 implementation provides a stub PassThrough resolver that always sets `confidence = 1.0`, `requiresUserConfirmation = false`, and treats user-typed Intent as the canonical output | W1 doesn't have an LLM resolver yet; the receipt records that fact |

**Authority gate diagram:**

```
NL input or A2A message
       ↓
 [Resolver runs] ────────→ produces ResolutionReceipt + draft Intent + ConstraintSet
       ↓
 requiresUserConfirmation = TRUE ?
   ├── YES: ── BLOCK ── wait for userConfirmationSignature over the typed bytes
   │             ↓
   │       user signs canonical Intent+ConstraintSet
   │             ↓
   │       userConfirmedAt + userConfirmationSignature populated
   │             ↓
   └── NO: ──── PROCEED ─────────────────────────────────────────────────────→  matchmaker / agreement / payment layers consume the Intent
```

**Why this matters even in W1.** The user-confirmation gate is the architectural difference between a coordination substrate and an "AI agent that does things on your behalf." The substrate refuses to let the second turn into the first by accident.

### 4.6 SolverBid typed interface (Layer 6)

For the Direct Lane in W1, there's no competitive bidding (the matchmaker produces one match per Compatible pair). The `SolverBid` typed shape is defined here for forward compatibility with W2+ Pool Lane + Proposal Lane (smart-agent's L-13 + L-14):

```ts
interface SolverBid {
  bidId: Hex32;
  resolvedFromIntentId: string;
  solverAgent: SAAddress;             // Could be a person, org, or agent SA
  proposedCounterparty?: SAAddress;   // For direct matching
  proposedSolution: ResolvedOrder;    // What the solver proposes to do
  matchScore: number;                  // 0..10000 (smart-agent decimal range)
  reason: string;                      // Human-readable scoring rationale
  predictedOutcome: PredictedOutcome;  // What success looks like (intentExpects fulfillment)
  costEstimate: CostEstimate;          // Time, value, complexity
  trustCertificate?: AttestationRef;   // EvidenceCredential of solver's track record
  validUntil: number;                  // Unix epoch
  signature: EIP712Signature;          // SA-signed (ERC-1271)
}
```

**Composability with the matchmaker.** In Direct Lane W1, the matchmaker emits a single internal "bid" with `solverAgent = JP-broker SA`. In Pool / Proposal Lanes (W2+), external solvers can register and emit `SolverBid` envelopes; the broker (or the intent author) selects from competing bids by composite score + trustCertificate + costEstimate.

## 5. Intent state machine

```
                  withdraw
       drafted ─────────────────────→ withdrawn
          │
          │ express
          ↓
       expressed ←─────────────┐
          │                    │ (declined; no MatchInitiation accepted)
          │ JP creates a       │
          │ MatchInitiation    │
          ↓                    │
       acknowledged ───────────┘
          │
          │ both parties accept the MatchInitiation
          │ → IntentMatch minted; Commitment drafted; bilateral signed
          ↓
       in-progress
          │
          ├─────→ fulfilled    (Outcome achieved)
          ├─────→ abandoned    (non-malicious; feeds outcomeScore)
          └─────→ withdrawn    (unilateral; mid-flight)
```

State transitions:

| From | To | Trigger | Side effects |
|---|---|---|---|
| `drafted` | `expressed` | Expresser publishes (UI Express button) | Cross-delegation to JP (`jp:broker_intent`) issued; intent indexed into JP's broker pool |
| `drafted` | `withdrawn` | Expresser deletes draft | None |
| `expressed` | `acknowledged` | JP creates a MatchInitiation against this intent | `liveAcknowledgementCount += 1`; Tier-2 `intent:bump_ack_count` delegation consumed |
| `expressed` | `withdrawn` | Expresser unilateral withdraw | JP delegation revoked; broker pool entry dropped at next refresh |
| `acknowledged` | `in-progress` | Both parties accept the MatchInitiation, mint IntentMatch, sign Commitment | IntentMatch row in JP vault; passive MatchAttestation by JP |
| `acknowledged` | `expressed` | MatchInitiation declined by either party | None on this intent; the MatchInitiation row stays in JP vault for the rationale audit trail; future ranking improves |
| `in-progress` | `fulfilled` | Outcome achieved (L-18 enriches; W1 is a manual flag) | Outcomes ledger updated; future ranking improves |
| `in-progress` | `abandoned` | Either party declares abandon | Outcomes ledger updated; future ranking degrades |
| `in-progress` | `withdrawn` | Unilateral withdrawal | Treated as `abandoned` for ranking purposes |

TTL handling: an `expressed` intent that hits its visibility-tier TTL (per IA D-31: 90d / 60d / 30d / manual) transitions to `withdrawn` automatically. The vault entry stays for historical reference; JP's broker pool drops the entry.

## 6. Vault shapes

The full TypeScript types live in [apps/demo-jp/docs/information-architecture.md](../apps/demo-jp/docs/information-architecture.md) §5.8 (per-persona intent vault) and §5.9 (JP broker vault). This section pins the cross-stack invariants.

### 6.1 Intent envelope (canonical)

```ts
type Intent = {
  intentId: Hex;               // = keccak256(abi.encode(expresserSA, expressedAt, salt))
  direction: 'Receive' | 'Give';
  object: string;              // SKOS concept URI (e.g. "skos:Worker", "skos:Mentorship")
  topic: string;               // free-text label
  intentType?: string;         // derived UI label = function(direction, object); not a schema field
  expresserSA: Address;
  addressedTo: Address | 'jp';
  expressedAt: number;
  state: IntentState;
  visibility: VisibilityTier;  // §8.1
  ttlExpiresAt?: number;       // derived from visibility tier
  payload: AppPayload;         // app-vertical content; SHACL-validated against the app's shape
  expectedOutcome?: OutcomeDescriptor;
  preConsent: {
    jpBrokerageDelegationId: Hex;          // back-ref into the Tier-3 cross-delegation
    matchCriteria: MatchCriteria;          // structured constraints JP must satisfy
    autoConsentOnMatch: false;             // W1 always false; manual review at each match
  };
};
```

`Intent.payload` is the **vocabulary firewall**: the generic envelope (everything above `payload`) stays in the package; the app-vertical content (JP's FPG ids, capacity buckets, MOU receipts) lives in the app's payload definition.

### 6.2 RankingBasis snapshot (audit-trail invariant)

```ts
type RankingBasisSnapshot = {
  proximityHops: number;
  proximityScore: number;     // 0..1 = 1 / (1 + proximityHops)
  priorOutcomes: number;      // |fulfilled| + |abandoned| in counterparty history
  outcomeScore: number;       // 0..1 = (fulfilled + 1) / (fulfilled + abandoned + 2)  (Laplace)
  composite: number;          // 0..1 = 0.6 * proximityScore + 0.4 * outcomeScore
  matchScore: number;         // 0..10000 = round(composite * 10000); the on-shape stored form
  isColdStart: boolean;       // priorOutcomes == 0
  computedAt: number;
};
```

Two representations of the same score:

- **`composite`** — the compute-side floating-point form (0..1). Used by the SDK ranking helper. Convenient for thresholding.
- **`matchScore`** — the stored form (0..10000 integer-decimal). Smart-agent's SHACL shape constrains `IntentMatch.matchScore` to "exactly 1 decimal in [0, 10000]" (`/docs/ontology/cbox/intent-shapes.shacl.ttl`). Ported verbatim: this is the form persisted in the basis snapshot, the form the SHACL shape validates, and the form on-shape-published if/when matches go on-chain (L-15).

Conversion: `matchScore = round(composite * 10000)`. The conversion is locked at snapshot time; `matchScore` (the audit-trail form) and `composite` (the threshold-comparison form) MUST agree after the cast.

**Invariant SS-01:** `MatchInitiation.basis` is set at MatchInitiation creation time and **never mutated** thereafter. SHACL-shape-enforced.

This is the smart-agent rationale-preservation pattern. Without it, a counterparty whose trust graph degrades after the proposal but before the acceptance gets evaluated under different rules than the proposal was created under — confusing for verifiers and bad for product trust.

### 6.3 MatchInitiation vs IntentMatch separation

```ts
type MatchInitiation = {
  matchInitiationId: Hex;
  viewedIntentId: Hex;
  candidateIntentId: Hex;
  basis: RankingBasisSnapshot;   // SS-01: immutable after creation
  state: 'proposed' | 'one-side-accepted' | 'both-accepted' | 'declined' | 'expired';
  initiatedBy: Address;          // the broker SA (JP for demo-jp)
  createdAt: number;
  decisions: {                   // append-only decision log
    party: Address;
    decision: 'accept' | 'decline';
    at: number;
  }[];
};

type IntentMatch = {
  intentMatchId: Hex;            // = keccak256(originatingMatchInitiationId, parties[], acceptedAt)
  originatingMatchInitiationId: Hex;
  parties: [Address, Address];
  acceptedAt: number;
};
```

**Invariant SS-02:** A MatchInitiation in state `both-accepted` **MUST** have a corresponding IntentMatch row. SHACL shape `MatchInitiationAcceptedHasIntentMatch` enforces.

**Invariant SS-03:** `MatchInitiation.viewedIntent.direction != MatchInitiation.candidateIntent.direction`. Receive↔Give pairing only. SHACL shape `MatchInitiationOppositeDirections` enforces — direct port from smart-agent `/docs/ontology/tbox/shacl/visibility.ttl`.

## 7. Matching algorithm

### 7.1 The compatibility rule (filter before scoring)

Smart-agent's canonical compatibility predicate, ported verbatim:

```ts
function isCompatible(a: Intent, b: Intent): boolean {
  return (
    a.direction !== b.direction           // Receive ↔ Give (SS-03)
    && a.object  === b.object             // same SKOS resource type
    && topicSimilarity(a.topic, b.topic) >= TOPIC_SIMILARITY_THRESHOLD
  );
}
```

**The matcher MUST NOT branch on `intentType`.** This is smart-agent's load-bearing constraint (`/docs/specs/intent-bdi-plan.md` § 4) and the reason `intentType` is a UI label only, not a schema dispatch primitive. Two intents with the same `direction` + `object` + topic-similarity ARE compatible regardless of their UI label.

`topicSimilarity` is a SKOS-aware string similarity (synonyms, hypernyms, edit-distance). W1 ships a simple normalized Jaro-Winkler over canonical topic strings; richer similarity (SPARQL-driven, SKOS hierarchy traversal) is post-W1.

`TOPIC_SIMILARITY_THRESHOLD` defaults to `0.7` (smart-agent's default).

### 7.2 Composite score

For each candidate pair surviving the compatibility filter:

```
composite = 0.6 * proximityScore + 0.4 * outcomeScore
matchScore = round(composite * 10000)        // stored form per §6.2
```

**proximityScore** = `1 / (1 + proximityHops)`, where `proximityHops` is the shortest path in the trust graph between the two expresser SAs. (W1: trust graph is the existing `agent-relationships` edge set + the existing JP-Association edges; deeper trust-graph extensions are post-W1.)

**outcomeScore** = `(fulfilled + 1) / (fulfilled + abandoned + 2)`, Laplace-smoothed. `fulfilled` and `abandoned` are counts from the counterparty's outcomes ledger.

**isColdStart** = `priorOutcomes == 0`. UI surfaces this so users know low-history matches carry more proposal-time uncertainty.

### 7.3 Additional pre-filters

Beyond the compatibility rule:

1. **Visibility intersection**: per §8.1 cascade; the candidate's visibility must be one JP can read under the candidate's delegation.
2. **Match criteria intersection**: `viewedIntent.preConsent.matchCriteria` and `candidateIntent.preConsent.matchCriteria` must be mutually satisfiable. (App-payload-specific; JP-side helper.)
3. **TTL window**: both intents must be within their `ttlExpiresAt` window.
4. **Sensitive-type credentialed-reader gate**: if either intent's `intentType` is tagged `sensitive` in the SKOS vocabulary, JP MUST hold an additional credentialed assertion (smart-agent uses AnonCreds; demo-jp defers to L-17) before surfacing the match. demo-jp W1 ships no sensitive intent types so this gate is dormant but present in code.

### 7.4 Threshold

JP creates a MatchInitiation only when `composite >= COMPOSITE_MIN_THRESHOLD`. W1 hardcodes `COMPOSITE_MIN_THRESHOLD = 0.35` (smart-agent's default). Tuning is post-W1 (PD-18).

### 7.5 Cold-start handling

For first-time expressers (no outcomes history), `isColdStart = true`. JP surfaces with the cold-start badge and the user is shown the rationale ("This candidate has no prior outcomes — proceed with extra review"). Smart-agent's pattern; ports the UX as well as the structure.

### 7.6 Re-ranking

When the trust graph changes (an existing match's outcome is recorded), JP MUST NOT re-rank or revoke existing `proposed` MatchInitiations. Per SS-01, the snapshot is the authoritative rationale at proposal time. Re-ranking applies only to NEW MatchInitiations created after the graph change.

### 7.7 Broker-push vs caller-pull modes

Smart-agent supports two matchmaker modes:

1. **Caller-pull (smart-agent matchmaking-strategy.md):** the user opens the matching screen; the matcher computes cards inline against current state; cards are NOT persisted as broker-pool entries until the user accepts one.
2. **Broker-push (smart-agent spec 001 MatchInitiation):** the broker proactively creates MatchInitiation rows in its own state and notifies both parties.

demo-jp W1 ships **broker-push only**: JP creates MatchInitiation rows in its broker pool when its periodic matching loop finds candidates above threshold, then pushes notifications. This is the simpler demo UX (matches surface in the user's MatchInbox without the user pulling). Caller-pull is post-W1; the package surface accommodates both modes since the underlying data shape is the same.

## 8. Visibility + projections

### 8.1 Five-tier model (ported)

| Tier | Marker | What can be in JP's broker pool | What's public |
|---|---|---|---|
| `Public` | `sageo:VisPublic` | Full intent body | Full intent body |
| `PublicCoarse` | `sageo:VisPublicCoarse` | Coarse projection (object, direction, topic, capacity-bucket, geo-bucket, expectedOutcome metrics) | Coarse projection only |
| `PrivateCommitment` | `sageo:VisPrivateCommitment` | Whatever the Tier-3 cross-delegation scopes (default: coarse) | Nothing |
| `PrivateZK` | `sageo:VisPrivateZk` | Reserved; not implemented (L-16) | n/a |
| `OffchainOnly` | `sageo:VisOffchainOnly` | Nothing (not even a notification) | Nothing |

### 8.2 Cascade rule

**Cascade-A:** A derived artifact (MatchInitiation, IntentMatch, Commitment) inherits the **STRICTEST** visibility of its source intents.

```
public        + public        → public
public        + public-coarse → public-coarse
public        + private       → private-commitment
private       + anything      → private-commitment
strict-conf.  + anything      → off-chain-only (terminal; D-22)
```

Cascaded visibility is computed at the time the derived artifact is created and frozen there.

### 8.3 Projection model

JP serves DIFFERENT projections of the same intent to different consumers:

| Projection | Consumer | Fields | Use |
|---|---|---|---|
| `Full` | Expresser themselves | All | Owner's own UI |
| `Coarse` | JP-or-credentialed-reader under default delegation | direction, object, topic, geo-bucket, capacity-bucket, expectedOutcome public metrics | Discovery; coarse search; capacity widgets |
| `Summary` | JP's match-engine (server-side only, never exposed) | direction, object, geoRoot, matchCriteria | Match scoring |
| `Null` | Non-credentialed reader OR `OffchainOnly` intent | ∅ | Intent doesn't appear in search results |

The SDK provides `projectFor(intent, viewerRole, visibility)` to keep projection logic in one audited place (PD-20).

### 8.4 No-duplication principle (P4)

JP's broker pool stores ONLY the projection JP is authorized to see. If JP holds only the `Coarse` grant, the broker-pool entry is the coarse projection bytes — not the full intent body. Smart-agent's invariant P4 ("MCP→GraphDB pipe is forbidden") ports as: broker pool gets what its delegation scopes, no shadow copies.

## 9. Access controls (delegations)

### 9.1 Three tiers (ported)

| Tier | Caller path | Purpose | Caveats |
|---|---|---|---|
| **Tier 1** — User session | Web app → user's session signer → user's SA → JP SA | Whatever the user can do themselves | User's userOp signature; standard session controls |
| **Tier 2** — System delegation | Artifact-creator's SA → counterparty's SA | Bookkeeping side-effects (e.g. `intent:bump_ack_count`) | Time-bounded; method-pinned via `AllowedMethodsEnforcer` |
| **Tier 3** — Cross delegation | Specific reader (JP) → data owner's SA | Per-instance read or broker access | Issued fresh by the data owner; pinned to a specific artifact id via `CalldataHashEnforcer`; time-windowed; revocable |

### 9.2 JP holds NO blanket grants

Per IA D-33, JP has no Tier-2 or Tier-3 delegations at onboarding time. Every Tier-3 access is per-action:

- `jp:read_org_profile` — issued at the Org onboarding step (long-lived; revocable; profile-facet read only).
- `jp:broker_intent` — issued at each intent express; pinned to that intent's id; window-bounded.
- `intent:bump_ack_count` — Tier-2 issued bundled with the intent; pre-authorizes JP to increment `liveAcknowledgementCount` without fresh expresser signature.
- `match_initiation:notify` — Tier-3 issued bundled with the intent; pre-authorizes JP to write into the expresser's MatchInbox vault key for matches against this intent.

### 9.3 Scope catalog (W1 — Direct Lane)

```
intent:express                  T1  (no delegation; expresser's own session)
intent:bump_ack_count           T2  (issued by expresser at intent express; consumed by JP)
jp:broker_intent                T3  (issued by expresser at intent express; pins to intent id)
jp:read_intent_full             T3  (opt-in; allows JP to upgrade from Coarse to Full projection)
jp:read_org_profile             T3  (issued by Org at JP onboarding)
match_initiation:create         T1  (no delegation; JP's own session as broker)
match_initiation:notify         T3  (issued by expresser at intent express; per intent)
match_initiation:accept         T1  (no delegation; party's own session)
intent_match:create             T1  (no delegation; triggers when both accept)
commitment:sign                 T1  (no delegation; party's own session)
match_attestation:witness       T2  (issued by parties to JP at IntentMatch creation)
agreement:issue                 T1  (no delegation; Global Church / Pete's session — boundary with Agreement Registry spec)
```

Each row maps to a single named delegation type (typed-data domain + caveat set) in `@agenticprimitives/intent-marketplace/src/scopes.ts`.

### 9.4 Revocation

Per IA D-34, revocation is per-grant. Revoking `jp:read_intent_full` does NOT revoke `jp:broker_intent` (different scopes). The UI MUST surface each grant as an independently revocable row.

`DelegationManager` already supports per-delegation revocation; no new contract surface.

### 9.5 What the connected user can see vs. JP vs. public

Per IA §17.3. Summary:

| Question | Where the answer lives |
|---|---|
| What I see | My vault (intents, matches, commitments, agreements I'm party to) + public-tier artifacts from anyone |
| What JP sees about ME | Only what I've delegated; JP dashboard surfaces my active grants |
| What's publicly visible about me | Public-tier intents; my Trust Assertions (if any); my Org SA name; my agent-profile |
| What JP has access to that I don't | JP's broker pool is JP's private workspace; JP composes matches without surfacing candidates to me before I've accepted |
| Can JP forward my private info | No. No `jp:forward_intent` scope in W1. JP is a recipient, not a distributor. |

## 10. Package surface — `@agenticprimitives/intent-marketplace`

Lives at `packages/intent-marketplace/`. **W1 is off-chain-only**: no ABI mirror, no contract client, no on-chain registry. Surface:

```
packages/intent-marketplace/
  src/
    index.ts                       — public exports
    intent.ts                      — Intent type (single class, direction property); state machine
    match-initiation.ts            — MatchInitiation type; state machine
    intent-match.ts                — IntentMatch durable type
    commitment.ts                  — Commitment typed-data (boundary with agreement spec)
    visibility.ts                  — five-tier enum; cascade computation; SHACL invariants
    ranking.ts                     — composite score; basis snapshot type; Laplace-smoothed outcome
    scopes.ts                      — Marketplace scope catalog (§9.3); typed-data per scope
    delegation-templates.ts        — Tier-3 cross-delegation builders pinned via CalldataHashEnforcer
    schema-shapes.ts               — SHACL Description shapes; registers via ontology.ShapeRegistry
    projections.ts                 — Full / Coarse / Summary / Null projection types + projectFor()
    vault-store.ts                 — vault load/store helpers
  test/
    unit/
      intent.test.ts               — state-machine transitions; rejected drafted→fulfilled etc.
      ranking.test.ts              — composite formula against known basis vectors
      visibility.test.ts           — cascade rule conformance
      delegation-templates.test.ts — caveat set correctness; CalldataHashEnforcer pinning
      projections.test.ts          — Full / Coarse / Summary / Null projection bytes correctness
    integration/
      direct-lane.test.ts          — end-to-end Intent → MatchInitiation → IntentMatch → Commitment
                                     using viem + a mock JP broker
  capability.manifest.json
  CLAUDE.md, AUDIT.md, README.md
  package.json
```

Allowed imports (one-directional graph slot, per packages.md §7):

```
@agenticprimitives/types
@agenticprimitives/agent-account     (type-only — Address + ERC-1271 verify type)
@agenticprimitives/delegation        (type-only — Tier-3 cross-delegation builder shapes)
@agenticprimitives/verifiable-credentials (type-only — credential identifiers for credentialRequired)
viem
```

Forbidden:

- `@agenticprimitives/attestations` (sibling; intent layer is upstream of assertion layer)
- `@agenticprimitives/agreements` (sibling; intent flow hands off to it but doesn't depend on it)
- anything JP-specific (`facilitator`, `adopter`, `FPG`, `MOU`, etc. — caught by `check:no-domain-in-packages` + `check:forbidden-terms`)

## 11. Implementation requirements

### 11.1 Express-intent semantics — beneficiary defaulting (ported from smart-agent)

Smart-agent's `expressIntent` server action (`/apps/web/src/lib/actions/intents.action.ts`) enforces specific beneficiary-defaulting rules that demo-jp ports:

```ts
function defaultBeneficiary(
  intent: { direction: 'Receive' | 'Give'; expresserKind: 'person' | 'org'; payload: AppPayload },
  expresserSA: Address,
): Address {
  if (intent.direction === 'Give') {
    // Give-intent: the giver is the beneficiary of the give (the giver
    // "gets to give"); payload.beneficiaryAgent overrides if set.
    return intent.payload.beneficiaryAgent ?? expresserSA;
  }
  // Receive-intent:
  if (intent.expresserKind === 'person') {
    // Personal receive-intent: defaults to the expresser themselves.
    return intent.payload.beneficiaryAgent ?? expresserSA;
  }
  // Org-expressed receive-intent: beneficiary MUST be explicit.
  if (!intent.payload.beneficiaryAgent) {
    throw new Error(
      'Org-expressed Receive intent requires payload.beneficiaryAgent (orgs do not default to self-beneficiary).',
    );
  }
  return intent.payload.beneficiaryAgent;
}
```

**Why the asymmetry:** an org is rarely the beneficiary of a receive-intent it expresses on behalf of others (e.g., a Facilitator Org expressing "we need a prayer partner FOR people group X" — the beneficiary is the people group's members, not the org itself). Forcing the explicit field surfaces the question; defaulting would let the org silently take the beneficiary slot.

**Invariant SS-13:** Org-expressed Receive intents without `payload.beneficiaryAgent` are rejected at express time. SDK helper + SHACL shape both enforce.

### 11.2 Cross-stack typehash equality

`Intent`, `MatchInitiation`, `IntentMatch`, `Commitment` envelopes carry EIP-712 domain separators. The TypeScript hashes MUST match the SHACL-shape-derived hash for each Description.

Wired into `pnpm check:eip712-typehash-equality` (same pattern as `packages/delegation/test/integration/cross-stack-typehashes.test.ts`).

### 11.3 SHACL shape registration

**Drift note (2026-06-02):** the on-chain `ShapeRegistry` (`packages/contracts/src/ontology/ShapeRegistry.sol`) is **governance-gated** (`defineShape` is `onlyGovernor`) and stores **structured `PropertyConstraint[]`**, not opaque SHACL bytes. The identifier is `bytes32 classId` (keccak of the IRI); each shape also carries a `shapeURI` string and a `shapeHash` byte32 commitment. This affects how `registerIntentSpineShapes(...)` operates.

At package deploy time:

1. The helper translates each Description SHACL into the on-chain shape: `classId = keccak256(shapeIRI)`, `props = lowerShaclToPropertyConstraints(shaclAst)`, `shapeURI = "https://agenticprimitives.org/ontology/intent#IntentDescription"`, `shapeHash = keccak256(canonical(shaclBytes))`.
2. The helper **prepares the calldata** for `ShapeRegistry.defineShape(classId, props, shapeURI, shapeHash)` and the **governor** (whoever holds that role in the target deployment) signs the tx.
3. demo-jp's deploy script bundles a single `defineShape` per spine shape, runs once at first deploy of the registry on a new chain.

Shapes to register on first deploy:

- `IntentDescription` (classId = keccak256(`saint:Intent`))
- `MatchInitiationDescription` (carries SS-03 OppositeDirections constraint — encoded as a custom `PropertyConstraint` over `viewedIntent.direction` vs `candidateIntent.direction`)
- `IntentMatchDescription` (carries SS-02 BothAcceptedHasIntentMatch constraint)
- `CommitmentDescription`
- `VisibilityCascadeShape` (the strictest-wins invariant)

Off-chain, the SHACL bytes are kept alongside the package (`packages/intent-marketplace/src/shapes/*.ttl`) so verifiers can reconstitute the canonical bytes and recompute `keccak256(SHACL) == on-chain shapeHash`. PD-19 still holds: substrate Descriptions live in the package; JP-vertical Descriptions live in the app.

### 11.4 Audit-fail-hard

Per the audit pattern locked in PR #84 (`composeFailHardSinks`):

- `intent.expressed` — emit when an intent transitions drafted → expressed.
- `match_initiation.created` — emit when JP creates a MatchInitiation; payload includes basis snapshot.
- `match_initiation.accepted` / `match_initiation.declined` — emit at each party decision.
- `intent_match.minted` — emit when both-accepted → IntentMatch.
- `commitment.signed` — emit when both party signatures are bound.
- `match_attestation.witnessed` — emit when JP attaches the passive attestation.

Caller's sink composition (`composeSinks` fail-soft vs. `composeFailHardSinks` fail-hard) governs propagation, per the pattern.

### 11.5 No silent fallbacks (ADR-0013)

Each read/auth path has exactly one mechanism. Specifically:

- **Intent visibility resolution**: ONE mechanism. The cascade is computed; if the result is "viewer can't see", the projection is `Null` and the call returns empty. No fallback to "well, maybe try the coarse view anyway".
- **Delegation validation**: ONE mechanism. Each Tier-3 read goes through `DelegationManager.verifyAuthorization(...)`. No "try the cached delegation first, fall back to chain read".

### 11.6 Generic packages, no JP vocabulary

`pnpm check:no-domain-in-packages` MUST pass after the package lands. The vocabulary firewall (per ADR-0021 + packages.md §6) keeps `facilitator`, `adopter`, `FPG`, `MOU`, `Joshua Project` out of `packages/intent-marketplace/`. JP-vertical types live in `apps/demo-jp/src/lib/intent-payload.ts`.

### 11.7 Intent index page — three-section layout (UX pattern ported)

Smart-agent's `/apps/web/src/app/h/[hubId]/(hub)/intents/page.tsx` ships a three-section layout that demo-jp's `apps/demo-jp/src/dashboards/IntentDashboard.tsx` ports:

```
┌───────────────────────────────────────────────────────────┐
│  Intent dashboard                                          │
│                                                            │
│  Filter: [direction] [scope] [intentType] [priority] [geo]│
│  Search: [_____________________________]                   │
│                                                            │
│  ───────────────────────────────────────────────────────  │
│  Addressed to you                                          │
│    Intents others expressed AS ADDRESSED TO this persona,  │
│    PLUS MatchInbox entries (proposed pairings to review)  │
│  ───────────────────────────────────────────────────────  │
│  You expressed                                             │
│    Intents this persona owns (state-machine breakdown:    │
│    expressed / acknowledged / in-progress / fulfilled)    │
│  ───────────────────────────────────────────────────────  │
│  Open in hub / network                                     │
│    Public-tier intents from anyone in the network          │
│    (visibility: public OR public-coarse)                   │
└───────────────────────────────────────────────────────────┘
```

The three sections reflect the BDI loop's three observation positions: what others address to me (PERCEIVE inbox), what I've published (the working set my DELIBERATE step refers to), and what's in the environment (PERCEIVE broad). Filterable cross-section so a user looking for "facilitator-capacity offers in the Najdi people group" can find them in one place regardless of which inbox surfaces them.

## 12. Tests + invariants

| Test | Pass criterion |
|---|---|
| **SS-01: basis-snapshot immutability** | A MatchInitiation's `basis` field cannot be mutated after creation. Attempt via SDK → throw; attempt via SHACL → shape violation. |
| **SS-02: accepted has IntentMatch** | A MatchInitiation in `both-accepted` state has a corresponding IntentMatch row in the same broker vault. SHACL shape `MatchInitiationAcceptedHasIntentMatch`. |
| **SS-03: opposite directions** | A MatchInitiation MUST have `viewedIntent.direction != candidateIntent.direction`. SHACL shape `MatchInitiationOppositeDirections` (ported from smart-agent verbatim). |
| **SS-04: visibility cascade** | Every derived artifact's visibility equals the strictest of its sources. SHACL shape `VisibilityCascadeShape`. |
| **SS-05: no broad delegations** | JP's vault MUST NOT hold any Tier-3 cross-delegation with caveats lacking a `CalldataHashEnforcer` pinning a specific artifact id. Test: scan JP vault; assert each delegation's caveats include the enforcer. |
| **SS-06: revocation surfaces** | Revoking `jp:read_intent_full` MUST NOT revoke `jp:broker_intent`. Test: issue both; revoke one; assert other still valid. |
| **SS-07: ranking determinism** | Given a fixed trust-graph state + outcomes ledger, `computeRanking(...)` produces a deterministic basis. Test: stable inputs → stable composite. |
| **SS-08: cold-start surfacing** | An intent with `priorOutcomes == 0` produces `isColdStart: true`. |
| **SS-09: TTL transitions** | An `expressed` intent past its `ttlExpiresAt` transitions to `withdrawn` on next vault load; broker pool entry dropped. |
| **SS-10: projection correctness** | `projectFor(intent, viewerRole, visibility)` returns the projection bytes appropriate to the inputs. Test the 4 projection types against the 5 visibility tiers (20 cases). |
| **SS-11: cross-stack typehash equality** | TypeScript Intent / MatchInitiation / Commitment hashes match the SHACL-canonical bytes. Run as part of `check:eip712-typehash-equality`. |
| **SS-12: vocabulary firewall** | `pnpm check:no-domain-in-packages` and `pnpm check:forbidden-terms` pass against `packages/intent-marketplace/`. |
| **SS-13: org-receive-intent beneficiary required** | Per §11.1 ported rule. Test: try to express an Org receive-intent with `payload.beneficiaryAgent` undefined → SDK throws; SHACL shape rejects. |
| **SS-14: matcher reads direction, not intentType** | Smart-agent's load-bearing constraint. Test: two intents with same `intentType` but different `direction` MUST be rejected as incompatible (direction wins); two intents with different `intentType` but same `direction` + `object` + topic-similarity MUST be considered compatible. |
| **SS-15: matchScore range** | Per SHACL shape: `matchScore` MUST be an integer in [0, 10000] for every persisted MatchInitiation. Test: round-trip through `composite → matchScore → SHACL validation`. |
| **SS-16: sensitive-type private default** | An intent with `intentType` in the sensitive group defaults to `visibility: private-commitment` at express time, regardless of UI preselect. Test: express a sensitive type with no visibility override; assert visibility = private-commitment. (demo-jp ships no sensitive types in W1; the test runs against the package's behavior with a synthetic sensitive type.) |

End-to-end direct-lane test:

1. Two personas (Alice/Adopter, Bob/Facilitator) onboard with JP per IA §4a.
2. Alice expresses an Intent (`direction: Receive`, `object: facilitator-capacity`, `peopleGroupId: fpg-najdi-sa`, `visibility: public-coarse`); JP's broker pool sees the coarse projection.
3. Bob expresses an Intent (`direction: Give`, `object: facilitator-capacity`, `peopleGroupId: fpg-najdi-sa`, `visibility: public-coarse`); JP's broker pool sees the coarse projection.
4. JP runs match: composite score exceeds threshold; MatchInitiation created with basis snapshot.
5. JP notifies both via MatchInbox; both see the candidate's coarse projection.
6. Both accept; IntentMatch minted.
7. Both sign the Commitment; JP attaches a passive MatchAttestation.
8. The Commitment is the dual-signed input to the Agreement Registry spec's lifecycle.

Assertions at each step verify the audit emission shape, the visibility projection bytes, the SHACL invariants, and the cross-stack typehash equality.

## 13. Out of scope

| Item | Why | Where it lands |
|---|---|---|
| On-chain `IntentRegistry` / `MatchInitiationRegistry` | W1 vault-only per D-28; smart-agent ships these in spec 001, deferred here | L-15 |
| Pool Lane (`PoolPledge`, `Pool`, `Fund`) | Different marketplace dynamic | L-13 |
| Proposal Lane (`GrantProposal`, `Round`) | Different marketplace dynamic | L-14 |
| `PrivateZK` visibility tier implementation | ZK overlay deferred | L-16 |
| BBS+ selective-disclosure presentation of intents | Future credentials wave | L-5 |
| `FulfillmentPlan` / `FulfillmentCase` / `WorkItem` (downstream of Commitment) | Operational layer; demo-jp doesn't model work tracking in W1 | L-18 |
| Multi-broker matchmaking (more than one broker SA aware of the same intent) | Smart-agent's "Connector mode"; not needed for demo-jp single-JP-broker pattern | Post-W1 |
| Cross-app intent portability (an intent expressed in app X surfaces to broker Y in app Z) | Out of demo-jp scope | Post-W1 |
| Ranking-formula tuning (weights configurable via SDK option) | PD-18 hard-coded for W1 | Post-W1 |
| `OrchestrationPlan` decomposition (composite intents that decompose into sub-intents) | The T-Box class is kept in §4.1 for stability; SDK ships single-intent flows only in W1 | L-19 |
| Caller-pull matchmaker mode (per §7.7) | W1 ships broker-push only | Post-W1 |
| AnonCreds / credentialed-reader gate for sensitive intent types | smart-agent ships this; demo-jp ships no sensitive types in W1 so the gate is dormant | L-17 (when sensitive types are added) |
| SKOS-hierarchy-aware `topicSimilarity` | W1 ships normalized Jaro-Winkler over canonical strings | Post-W1 |
| Sub-intent fulfillment aggregation (parent intent fulfills when all sub-intents do) | Tied to OrchestrationPlan | L-19 |

## 14. Open questions

None in this spec — IA D-27..D-36 + PD-16..PD-21 cover the decision space; all locked. Future tuning lives in the L-N catalog.

## 15. Implementation notes

### 15.1 Smart-agent files to consult during implementation

Comprehensive reference catalog (port the patterns, not the code):

**Ontology / vocabulary (T-Box + C-Box + SHACL):**

| Implementation step | Smart-agent reference |
|---|---|
| Intent class hierarchy + properties | `/docs/ontology/tbox/intents.ttl` |
| Curated SKOS intent-type vocabulary | `/docs/ontology/cbox/intent-types.ttl` |
| SHACL Intent / IntentMatch / Outcome / OrchestrationPlan shape constraints | `/docs/ontology/cbox/intent-shapes.shacl.ttl` |
| Visibility cascade + SHACL invariants | `/docs/ontology/tbox/shacl/visibility.ttl` |
| Marketplace lifecycle alignment (Intent ⊂ ufo:Intention correction) | `/docs/specs/marketplace-lifecycle-alignment.md` |
| Cross-stack ontology audit | `/docs/ontology/INTENT_MARKETPLACE_AUDIT.md` |
| Work-domain ontology context | `/docs/information-architecture/ontology/17-intent-marketplace-work-domain-ontology.md` |

**Behavior + design docs:**

| Implementation step | Smart-agent reference |
|---|---|
| BDI loop + intent state machine + DB schema | `/docs/specs/intent-bdi-plan.md` |
| Generalized matchmaker pattern (universal across domains) | `/docs/specs/generalized-intent-matchmaking.md` |
| Filter → Score → Surface pipeline | `/docs/specs/matchmaking-strategy.md` |
| Hub agent + BDI behavior catalog | `/docs/specs/agentic-hub-and-bdi.md` |
| Persistence rules + visibility tiers + delegation gates | `/docs/information-architecture/10-intent-marketplace-classification.md` |
| Three-tier delegation model | `/docs/information-architecture/15-delegation-design-architecture.md` |

**Runtime / implementation references:**

| Implementation step | Smart-agent reference |
|---|---|
| Ranking formula implementation | `/packages/sdk/src/matchmaker/ranking.ts` |
| MatchInitiation type | `/packages/sdk/src/matchInitiations/types.ts` |
| Scope catalog | `/packages/sdk/src/marketplace-scopes.ts` |
| Express-intent server action + beneficiary defaulting rules | `/apps/web/src/lib/actions/intents.action.ts` |
| Person-side MCP tools (express, withdraw, bump_ack_count) | `/apps/person-mcp/src/tools/intents.ts` |
| Org-side MCP tools | `/apps/org-mcp/src/tools/intents.ts` |
| DB schema slice (intents, outcomes, orchestration_plans, beliefs) | `/apps/web/drizzle/0012_intents_bdi.sql` |

**UI / UX references:**

| Implementation step | Smart-agent reference |
|---|---|
| Three-section intent index layout | `/apps/web/src/app/h/[hubId]/(hub)/intents/page.tsx` |
| Express-intent form (3-step wizard: direction → type → details) | `/apps/web/src/components/intents/ExpressIntentForm.tsx` |

### 15.2 Renumbering note (resolved)

Renumber complete 2026-06-02: the IA + packages docs now reference **spec 241** (Agreement Registry) and **spec 242** (Verifiable Credentials + Attestations). 237 + 238 are unrelated existing waves; the demo-jp upgrade trio is 239 / 241 / 242.

### 15.3 Implementation wave dependency

This spec ships before app-layer code. The implementation order (per packages.md §11):

1. Spec 239 lands (this doc).
2. SHACL shapes land in `packages/ontology/src/shapes/` (or wherever shape definitions live in the ontology package).
3. `packages/intent-marketplace/` lands — types, state machines, ranking, projections, delegation templates.
4. Cross-stack typehash equality tests pass.
5. `apps/demo-jp/src/lib/intent-payload.ts` lands with the JP-vertical payload definition (FPG ids, capacity buckets, MOU receipt format, etc.).
6. `apps/demo-jp/src/lib/intent-flow.ts` orchestrates IA §4d steps end-to-end.
7. Persona dashboards (Adopter / Facilitator / Org / JP-Broker) render the intent + match + commitment surfaces.

Each step gated by the prior. The hand-off into the Agreement Registry spec happens at step (8) of IA §4d → §4c step 5a.
