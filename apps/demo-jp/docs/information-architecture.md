# demo-jp Information Architecture (Planning Draft)

**Status:** draft — D-1..D-5, D-7, D-9..D-14 **locked 2026-06-02**; D-6 **deferred** to [packages.md](packages.md); D-8 **reversed** (JP DOES see drafts before Global Church). **Agentic Trust feature** added 2026-06-02 — new sections §1.5, §3a, §4a, §5.7, §9b, §10b; decisions **D-15..D-22, D-26**. **Intent Marketplace feature** added 2026-06-02 (intent → match → commitment → agreement; pre-consent at intent, full consent at commitment; delegation-mediated JP access) — new sections **§3b, §4d, §5.8, §9c, §16, §17**; new decisions **D-27..D-36**.
**Companion docs:** [packages.md](packages.md) — packages + contracts split for demo-jp; [spec 236 — JP Adopt-a-People-Group](../../../specs/236-jp-adopt-a-people-group.md); **spec 239 — Intent Marketplace**, **spec 241 — Agreement Registry**, **spec 242 — Verifiable Credentials + Attestations**, **spec 243 — Payments**, **spec 244 — Fulfillment** (the W1 spine specs); [coordination-substrate.md](../../../docs/architecture/coordination-substrate.md) — overarching 15-layer architecture; [privacy-and-self-sovereign-identity.md](../../../docs/architecture/privacy-and-self-sovereign-identity.md) — privacy + SSI architecture; [ADR-0023 — Attestation registry](../../../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md); [ADR-0024 — Intent coordination substrate](../../../docs/architecture/decisions/0024-intent-coordination-substrate.md); [ADR-0019 — Relying Site = Scoped Delegation](../../../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md); [ADR-0021 — Generic Packages vs White-Label Apps](../../../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md).
**What this is:** the cast, the storage layout, the trust model, the agreement lifecycle, **and the Agentic Trust credential + assertion model** for demo-jp — to be locked into specs before any non-trivial code lands.
**What this is NOT:** the ZK/BBS+ design (deferred to spec 241 §5+ and spec 242 §5+), real-world custody for Global Church or JP (these are demo personas), or the implementation plan (waves below are sketches).

---

## 0. The cast

Six persona archetypes exist in the demo-jp browser at full setup. A single human user can switch between any of them; localStorage holds all state-pools simultaneously.

| Persona | What they hold | What they do | Dashboard |
|---|---|---|---|
| **Pete** | EOA keypair; custodies the Global Church SA | Signs userOps from Global Church → issuing agreements, attesting commitments | "Issuer / Global Church" |
| **Jill** | EOA keypair; custodies the JP SA | Signs userOps from JP → publishing matches, **issuing Association Credentials**, surfacing receipts | "Broker / Joshua Project" |
| **Facilitator** *(individual)* | Their own passkey-direct SA (or wallet) | Publishes coverage, accepts adopter introductions | "Facilitator" (existing) |
| **Adopter** *(individual)* | Their own passkey-direct SA (or wallet) | Declares adoption, receives facilitator intros | "Adopter" (existing) |
| **Facilitator Organization** *(NEW)* | Org SA + custodian credential; **vault holds JP Association Credential after onboarding** | Onboards with JP → receives Association Credential → optionally publishes the JP-Association as a public on-chain trust signal | "Facilitator Org" (new) |
| **Adopter Organization** *(NEW)* | Org SA + custodian credential; **vault holds JP Association Credential after onboarding** | Same shape, role=Adopter | "Adopter Org" (new) |

Two seeded on-chain Organization Smart Agents:

| Org SA | Role | Custodian | Profile name (proposed) |
|---|---|---|---|
| **Global Church** | **Issuer** of Agreement Credentials | Pete (EOA) | `global-church.impact` |
| **Joshua Project (JP)** | **Broker** for adopter ↔ facilitator matches; **Issuer of Association Credentials** for Adopter Orgs + Facilitator Orgs | Jill (EOA) | `joshua-project.impact` |

Both are mode-0 AgentAccounts with a single EOA custodian (`custodians = [eoaAddr]`, `trustees = []`, no passkey). Salt is deterministic per persona so the same SA address reproduces across reloads (until a hard demo reset).

**Adopter Org and Facilitator Org are NOT seeded** — they're user-onboarded at runtime, like individual Adopter / Facilitator personas already are today. Their custodian is the user's own credential (passkey-direct SA or wallet); they're full first-class Org SAs, not demo-runtime puppets. See §4a for the onboarding flow.

---

## 1. Custodian EOAs — Pete and Jill

### 1.1 Why EOA, not passkey, not the central-auth ROOT credential

For the existing demo apps (`demo-org`, `demo-web-pro`), every org SA created at runtime is custodied by the central-auth ROOT passkey ([memory `project_demo_org_durable_org_custody`](../../../README.md)). That's because those orgs are *minted by the user* and need to be controlled by the user's durable credential.

Global Church and JP are different: they're **seeded persona orgs**, controlled by the *demo runtime* itself, not by the human visitor's central-auth identity. The demo needs a deterministic way to act *as* Global Church (to issue) and *as* JP (to broker) without forcing every visitor to be a custodian of either. EOA-with-stored-private-key is the simplest fit.

**Security disclaimer (must be surfaced in the UI):** Pete and Jill's private keys live in `localStorage`. They are JS-accessible. **This is acceptable for the demo only.** Real Global Church and real JP would use multi-sig + trustees, never a JS-held EOA.

### 1.2 Generation

```ts
// One-time, on first demo-jp load:
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const pk = generatePrivateKey();                       // 32 bytes from crypto.getRandomValues
const account = privateKeyToAccount(pk);               // { address, signMessage, ... }
const stored: StoredEoa = {
  privateKey: pk,
  address: account.address,
  role: 'global-church-custodian' | 'jp-custodian',
  createdAt: Date.now(),
};
localStorage.setItem(EOA_KEY(role), JSON.stringify(stored));
```

**[D-2]** — `generatePrivateKey()` (uniformly random per-browser) vs. a seeded-deterministic derivation (e.g., HKDF over a fixed demo-secret + role). Random is simpler; seeded would let two devices/profiles "agree" on the same Pete. **Recommendation: random + persisted.** Per-browser identity is fine for a demo, and seeded derivation introduces a fixed secret the demo carries forever.

### 1.3 Storage shape

```
key: agenticprimitives:demo-jp:eoa:pete
value: {
  privateKey: '0x...',           // 32 bytes
  address: '0x...',              // derived
  role: 'global-church-custodian',
  createdAt: 1717000000
}

key: agenticprimitives:demo-jp:eoa:jill
value: { ...same shape, role: 'jp-custodian' }
```

### 1.4 Lifecycle

| Event | Behavior |
|---|---|
| First demo-jp load with no stored EOA | Generate both Pete and Jill on app boot; deploy the org SAs lazily on first use (see §3). |
| Reload | Read from localStorage; reuse without re-generation. |
| "Reset demo" button | Clear both EOA entries + both org-state entries. On next load, new Pete/Jill, new org SAs, new addresses. |
| Cross-browser/device | Each device has its own Pete/Jill. **[D-3]** — out of scope for demo; document as known limitation. |
| Recovery | None. Lose localStorage → lose Pete/Jill → lose Global Church + JP control. **[L-1]** — production would use ERC-7710 delegations from a durable custody to Pete/Jill, never a raw EOA. |

### 1.5 What gets signed by Pete / Jill

- Pete signs userOps that the **Global Church SA** executes — most importantly, the EIP-712 issuer attestation over an `agreementCommitment` (§4) and the `register(commitmentRecord)` call to the future `AgreementRegistry`.
- Jill signs userOps that the **JP SA** executes — publishing match receipts, status updates on the broker side.

Both signature paths are EOA → SA via `validateUserOp`'s ECDSA branch (which already exists in `AgentAccount.sol` for mode-0 EOA custodians).

---

## 2. Trust model

```
       Pete (EOA, localStorage)
              │
        custodian-of
              ▼
     Global Church (Org SA, on-chain)
              │
       ┌──────┴───────┬──────────────┐
   issues          attests on      writes to
   Agreement       commitments     registry
   Credential
       │                              │
       ▼                              ▼
   Adopter vault                AgreementCommitment
   Facilitator vault              Registry (chain)


       Jill (EOA, localStorage)
              │
        custodian-of
              ▼
       JP (Org SA, on-chain)
              │
       ┌──────┴───────┐
   publishes        surfaces matches
   match receipts   to adopter/facilitator
       │                  │
       ▼                  ▼
   Adopter dashboard    Facilitator dashboard
```

**Privilege separation worth pinning before code:**

| Role | Can | Cannot |
|---|---|---|
| Pete | Sign anything from Global Church | Sign on behalf of JP, adopter, or facilitator |
| Jill | Sign anything from JP | Sign on behalf of Global Church, adopter, or facilitator |
| Global Church | Issue + revoke Agreement Credentials | Match adopters with facilitators |
| JP | Match, **receive + see + forward drafts to Global Church**, surface receipts | Issue or revoke Agreement Credentials; **alter draft content** (party signatures bind it byte-for-byte) |
| Adopter / Facilitator | Sign their own party-side of an agreement; **route the draft via JP** (default) or directly to Global Church (fallback) | Issue, broker, or sign for any other persona |

This is intentional: separating issuer (Global Church) from broker (JP) means a compromise of JP's broker layer **cannot forge agreements** (it can't synthesize a party signature, only see them), and a compromise of Global Church's issuer key **cannot fabricate matches** retroactively. **D-4 locked:** keep them as two separate orgs.

**D-8 locked — REVERSED from prior recommendation: JP DOES see drafts.** Adopter + facilitator send the dual-signed agreement to JP first; JP holds it in a "pending issuance" queue and forwards to Global Church. This makes JP a workflow intermediary that can confirm "this draft is from the match I brokered" (UX confidence; not cryptographically binding). JP **cannot** alter the draft — party signatures pin the canonical agreement byte-for-byte, any byte change invalidates both signatures. JP **cannot** stop a determined party from going directly to Global Church (documented fallback path); the JP forwarding is the *default* workflow, not a chokepoint.

**Implication:** JP's vault holds the full draft (parties, terms, signatures) for the duration of the pending-issuance window. That's a real visibility surface. The W1 privacy posture (§14) is honest about it — JP can see what's flowing through. A future wave can either (a) layer end-to-end encryption between the parties' SAs and Global Church's SA with JP holding only the ciphertext, or (b) move JP's role to "match-attestation only" with the draft never touching JP's vault. **Deferred to L-8.**

---

## 3. On-chain shape (W1, no ZK yet)

### 3.1 Smart Agents

| SA | Address derivation | Init params |
|---|---|---|
| Global Church | `getAddressForAgentAccount({ mode: 0, custodians: [pete.address], trustees: [], passkey: none, salt: keccak256("demo-jp:global-church:v1") })` | EOA-only custodian |
| JP | Same shape, `custodians: [jill.address]`, `salt: keccak256("demo-jp:jp:v1")` | EOA-only custodian |

Both deploy via `/session/direct-deploy` (already exists; PR #91 + #96 made it rpIdHash-clean for the passkey path; mode-0 EOA path needs no rpIdHash). **[D-5]** — confirm salt convention. Stable salt = stable address across resets, which the user may want for "JP always lives at the same place". Alternative: include `getSessionSalt()` to get a fresh address per demo run, like the existing Acts. **Recommendation: stable for these two — they're persona orgs, not user data.**

### 3.2 Naming

| Name | Pointer | Set by |
|---|---|---|
| `global-church.impact` | Global Church SA address | one-shot subregistry register at deploy |
| `joshua-project.impact` | JP SA address | same |

Same `register + setPrimary` executeBatch the existing org-creation flow uses (`apps/demo-sso-next/src/connect-client.ts::buildClaimCallData`).

### 3.3 Agreement Registry (new contract; W1)

```solidity
// packages/contracts/src/agreement/AgreementRegistry.sol (proposed)
struct CommitmentRecord {
    bytes32 agreementCommitment;     // H(agreementHash, partySetCommitment, issuerCommitment, schemaHash, salt)
    bytes32 schemaHash;              // identifies the agreement template
    address issuer;                  // Option A from prior conversation: issuer public (Global Church SA)
    bytes32 statusCommitment;        // current state commitment
    uint64  createdEpochBucket;      // floor(timestamp / EPOCH_SECONDS), not exact timestamp
}

mapping(bytes32 => CommitmentRecord) public commitments;
mapping(bytes32 => bool)             public nullifiers;

event CommitmentRegistered(bytes32 indexed commitment, address indexed issuer, bytes32 schemaHash, uint64 epochBucket);
event StatusUpdated(bytes32 indexed commitment, bytes32 newStatusCommitment, bytes32 nullifier);

function register(CommitmentRecord calldata r) external;     // gated to issuer via ERC-1271
function updateStatus(bytes32 commitment, bytes32 newStatusCommitment, bytes32 nullifier, bytes calldata sig) external;
```

Notes:
- **No `adopter` field. No `facilitator` field.** This is the architectural shift from the existing `agent-relationships` edge model.
- `issuer` is public in W1 (Option A). The issuer-group-root variant (Option B) is **[L-2]** for a later wave.
- `createdEpochBucket` instead of `block.timestamp` to dampen timing correlation; per the privacy warning in the design conversation.

**Where this contract lives package-wise: [D-6]**
- (a) New package `packages/agreements` (clean separation, package boundary).
- (b) Extend `packages/ontology` (it already holds `OntologyTermRegistry` + `ShapeRegistry`; agreement schemas could be ontology shapes).
- (c) Inside `packages/contracts` as a standalone contract; no new TS package (start small).
- **Recommendation: (c) for W1; revisit (a)/(b) before going wide.**

### 3.4 Naming-vs-registry separation

`AgentNameRegistry` (existing) stores public name → SA edges. `AgreementRegistry` (new) stores commitment-only records. They are **deliberately separate contracts** so the privacy properties of the latter aren't bound to the former's public-relationship semantics. (See [ADR-0010 — Smart Agent Canonical Identifier](../../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md).)

---

## 3a. Agentic Trust — the credential + assertion model

A new capability surface, orthogonal to the agreement registry. Two tiers:

| Tier | What | Where it lives | Who can read |
|---|---|---|---|
| **Trust Credential** | A W3C-VC-shaped artifact issued by an authoritative agent (JP for Associations, Global Church for Agreements) and held by the subject | Subject's vault (off-chain) | Whoever the holder shows it to |
| **Trust Assertion** (optional) | A public on-chain claim by the holder: "I hold credential of type T issued by issuer I" + a proof reference (hash) | `AttestationRegistry` contract (on-chain) | Anyone |

The two tiers are deliberately separable: a credential can exist (vault-held) without ever being publicly asserted. Publicly asserting is the holder's **revelatory** choice — once made, the holder's link to the credential type is public; the credential's full content stays in vault until requested.

### 3a.1 Credentials we'll issue

| Credential type | Issuer | Subject | Held by | Purpose |
|---|---|---|---|---|
| `JpAssociationCredential` | JP (Jill via JP SA) | Facilitator Org SA or Adopter Org SA | The Org's vault | Attests the Org is JP-associated as a Facilitator or Adopter |
| `AgreementCredential` | Global Church (Pete via GC SA) | Both party SAs | Each party's vault | Attests a specific agreement was validly issued (already designed in §4) |
| *(future)* `EndorsementCredential` etc. | TBD | TBD | TBD | **L-10** — out of scope for W1 |

### 3a.2 The DOLCE+DnS Situation pattern

The relationship being attested is reified as a **Situation** satisfying a **Description**. The Situation IS the credential subject. The Description gets registered as a SHACL shape in `packages/ontology`'s `ShapeRegistry`.

For a JP-Associated Facilitator Org:

```
Description: JpFacilitatorAssociationDescription          (SHACL shape; ontology-registered)
  defines roles:    JpRelator, Member
  defines concept:  AssociationKind (Facilitator | Adopter)
  defines params:   validFrom, validUntil
  requires:         JpRelator == JP SA;
                    Member is a deployed Org SA;
                    Member.profile.organizationName != null

Situation (specific instance, becomes credentialSubject):
  type:             JpFacilitatorAssociationSituation
  satisfies:        JpFacilitatorAssociationDescription
  hasParticipant:   { role: JpRelator, agent: JP SA }
                    { role: Member,    agent: Org X SA }
  hasParameters:    { associationKind: 'Facilitator', validFrom: 2026-06-01, validUntil: null }
  hasSetting:       2026-06-01T..
```

The VC envelope wraps the Situation, JP signs (Jill via JP SA's userOp emitting an EIP-712 attestation), and the result lives in the Org's vault.

### 3a.3 The public assertion shape

When the Org chooses to publicly assert:

```
AttestationRegistry.assert({
  subject:          Org X SA               // the asserter (= credential subject)
  credentialType:   keccak256("JpFacilitatorAssociationCredential:v1")
  issuer:           JP SA                  // public; Option A
  credentialHash:   keccak256(canonical(VC))  // proof reference; the VC stays in vault
  schemaHash:       keccak256(canonical(SHACL shape))  // ties to ontology
  validFrom, validUntil
  signature:        Org X's userOp signature over the assertion
});
```

The on-chain row says "Org X claims to hold a JP-issued credential of type T, hash H, valid T1..T2." A verifier then:

1. Reads the assertion (public).
2. Fetches the underlying VC from Org X's vault (off-chain request, or pre-shared with the verifier).
3. Computes `keccak256(canonical(VC))` and checks it equals `credentialHash`.
4. Verifies the JP signature on the VC against JP SA's ERC-1271.

If steps 3+4 pass, the assertion is honest and JP-backed.

### 3a.4 Why two tiers, not just one

- **Holder controls public disclosure.** Some orgs may want the public signal (marketing, trust badge on their site); others may prefer to share the credential only with specific verifiers. Both should work.
- **Revocation surfaces are deliberately split (D-18 locked).** The **issuer** can revoke the credential off-chain (via a credential-status list update — the VC becomes invalid the moment JP publishes the revocation, regardless of on-chain assertions). The **issuer cannot touch the holder's on-chain assertion** — only the holder can self-revoke their own public claim. **Verifier responsibility:** a verifier MUST check BOTH the on-chain assertion AND the off-chain credential status before trusting the signal. A stale assertion (on-chain row present, but credential since revoked by issuer) is honest from the holder's perspective ("I once held this credential, and I haven't retracted my claim") but no longer trustworthy — that's the verifier's gate to enforce.
- **Audit trail is appropriate to the channel.** Off-chain VC presentation is bilateral; on-chain assertion is broadcast. Mixing the two confuses both.

### 3a.5 Same pattern for agreements

The W1 Agreement Registry (§3.3) is commitment-only — parties are not on-chain. The same Trust Assertion mechanism lets a party *opt in* to publicly link themselves to a commitment:

```
AttestationRegistry.assertParty({
  subject:        Party SA (the asserter)
  credentialType: keccak256("AgreementCredential:v1")
  issuer:         Global Church SA
  credentialHash: keccak256(canonical(AgreementCredential))   // the VC the party holds
  agreementCommitment: <commitment from AgreementRegistry>
  role:           keccak256("adopter") | keccak256("facilitator")
  signature:      party's userOp signature
});
```

This **partially un-blinds** the original commitment for the asserter only — the asserter is now publicly linked to the commitment; the counterparty stays private until they also assert. That's the asserter's choice. (§10b expands.)

---

## 3b. Intent Spine — the upstream layers (Belief → Desire → Intent → Match → Commitment)

**Ported from smart-agent** (branch `003-intent-marketplace-proposal`, refs below). Spine model captures everything **upstream of the agreement layer** — how parties surface a need or offering (Intent), how JP brokers them together (Match), and how a matched pair signs the bilateral promise (Commitment) that then becomes the dual-signed input to §4 step 5a / Global Church issuance.

### 3b.1 The BDI loop (universal across domains)

```
Belief (what an agent holds true)
  ↓ informs
Intent (expressed, addressed desire)             ← THE MARKETPLACE LAYER
  ↓ acknowledged by counterparty / broker
Match (a JP-attested pairing of two intents)
  ↓ parties review + agree on terms
Commitment (bilateral promise, signed by both)
  ↓ issuer recognizes
Agreement Credential (existing §4 design, GC-issued)
  ↓ optional
Public Joint Assertion (existing §10b.2, bilateral consent)
  ↓ work happens
Outcome → Validation → Trust update
  ↓ feeds beliefs for the next cycle
```

Smart-agent reference: `/home/barb/smart-agent/docs/specs/intent-bdi-plan.md` § 1.

### 3b.2 Intent is one class with a `direction` property

Smart-agent's load-bearing correction (and the canonical rejected-design to avoid): **DO NOT** subclass Intent into `RequestIntent` / `OfferIntent` / `CollaborationIntent` / etc. User grammar lies — "I need to contribute" sounds receive-shaped but is structurally give-shaped. One class, two enum-like values:

```turtle
saint:Intent
  rdfs:subClassOf ufo:Intention ;             # cognitive layer, NOT prov:Plan
  saint:direction   (saint:Receive | saint:Give) ;
  saint:object      skos:Concept ;            # what's flowing (Worker, Money, Information, Time, etc.)
  saint:topic       xsd:string ;              # human label, e.g. "facilitate the Najdi FPG"
  saint:intentType  skos:Concept ;            # UI taxonomy; derived from direction × object
  saint:expressedBy sa:Agent ;
  saint:addressedTo sa:Agent ;                # who the intent is asked of
  saint:visibility  sageo:Visibility ;        # one of five tiers, §16
  ... .
```

UI labels (FacilitatorOffering, AdopterNeed, etc.) are taxonomic projections of `direction × object`, NOT schema subclasses. See smart-agent `/docs/ontology/tbox/intents.ttl` for the canonical T-Box.

**Why not prov:Plan?** Smart-agent's marketplace-lifecycle-alignment doc § 6 — "I want to contribute" is an intention without any plan; subclassing Intent under prov:Plan forces a fictitious plan into every record. Intent ⊂ ufo:Intention. The plan that fulfills it (`FulfillmentPlan`) is a separate downstream class — out of scope for W1.

### 3b.3 Demo-jp uses the Direct Lane (smart-agent spec 001)

Smart-agent runs three parallel marketplace lanes sharing one ranking formula:

| Lane | Hand-off artifact | Smart-agent spec | demo-jp W1? |
|---|---|---|---|
| **Direct** | `MatchInitiation` → `IntentMatch` (accepted) | spec 001 | **Yes** — adopter ↔ facilitator pairing is exactly this shape. |
| **Pool** | `PoolPledge` (donor → pool) | spec 002 | **No (L-13)** — JP is not running a pooled-disbursement marketplace in W1. |
| **Proposal** | `GrantProposal` (proposer → fund / RFP) | spec 003 | **No (L-14)** — no RFP / grant-round dynamics in W1. |

**D-27 locked: W1 = Direct Lane only.** Pool and Proposal lanes are deferred (`L-13`, `L-14`).

### 3b.4 MatchInitiation ≠ IntentMatch (a smart-agent invariant)

A `MatchInitiation` is a *proposal* (pending; may be rejected). An `IntentMatch` is the *durable pair* (accepted by both sides). Smart-agent ships both classes deliberately — collapsing them loses the proposal-vs-accepted distinction and the rationale audit trail.

```
MatchInitiation                                  IntentMatch
  pending review                                   accepted by both
  rationale: ranking basis snapshot                fulfillmentReady = true
  state: proposed | declined | accepted            (the row only exists in 'accepted' form)
       │
       └── on accept → spawns IntentMatch + Commitment workflow
```

The ranking basis is **snapshotted at MatchInitiation creation time** so the rationale survives later trust-graph changes. Critical pattern, ported directly.

### 3b.5 Pre-consent at Intent → Full consent at Commitment

The **pre-consent** boundary the user asked about lives in the Intent. The **full consent** boundary lives in the Commitment.

| Stage | What the party has bound themselves to |
|---|---|
| Intent expressed | "I'm publishing my need/offering. I've pre-authorized any party meeting my published constraints to surface as a Match. I've NOT signed any specific deal yet." |
| MatchInitiation created (JP brokers) | "JP found a candidate counterparty. I'm being asked to review the specific pairing." |
| Both sides accept the MatchInitiation | "I've accepted this specific counterparty. We're going to draft a Commitment." |
| Commitment signed by both | "We've signed the bilateral promise. This is the dual-signed input to §4 step 5a — Global Church now issues the credential." |

**No on-chain artifact is produced until the Commitment is signed and the agreement flow runs.** The intent + match layers are off-chain or visibility-gated (see §16). The agreement layer (existing §4) is where the registries we already designed start mattering. **D-28 locked: intent + match layers are off-chain / vault-only in W1; the agreement-and-onward path uses the existing on-chain commitment registry + trust assertion registry from §3a, §10b.**

### 3b.6 What JP does at each stage

| Stage | JP's authority | Source |
|---|---|---|
| Intent expressed | Read the intent (if visibility permits OR JP holds a cross-delegation grant from the expresser — §17) | smart-agent Tier-1/3 delegation model |
| MatchInitiation creation | JP runs the ranking formula across visible intents and writes the MatchInitiation. JP attaches the **ranking-basis snapshot** so a verifier can later check the rationale. | smart-agent `/packages/sdk/src/matchmaker/ranking.ts` |
| Notify both parties | JP pushes the MatchInitiation to both parties' inboxes (in the demo: directly into both vaults) | smart-agent direct-lane spec 001 |
| Both accept | JP records the acceptance; an IntentMatch is created; JP's brokerage is done for the pair | spec 001 hand-off |
| Commitment drafted + signed | JP is NOT a signer. The Commitment is between the two parties. JP may *witness* the Commitment (a one-time `MatchAttestation` situating the Commitment in JP's brokerage history). | smart-agent spec 002/003 attestation pattern |

The match-attestation is **passive** — it's JP saying "this Commitment came out of MatchInitiation X" — it's NOT a fresh consent or a forge-protection step (the parties' own signatures cover those). It's brokerage receipt.

**D-29 locked: JP attaches a passive MatchAttestation to the Commitment but is not a signer.** This is the workflow signal that ties the Commitment back to its originating MatchInitiation; the parties' bilateral signatures are what bind the agreement.

---

## 4. The agreement lifecycle, by who-touches-what

### 4a. Org→JP Association onboarding (precedes the agreement lifecycle)

Adopter Orgs and Facilitator Orgs are user-onboarded at runtime. The onboarding flow is the first place the Agentic Trust feature (§3a) lands.

```
   ┌─ STEP 0. User onboards as an Org (Facilitator Org or Adopter Org) ───┐
   │ Existing infrastructure:                                             │
   │   - User picks "Onboard as Facilitator Organization" (or Adopter)    │
   │   - Org SA deployed (mode 0 with user's EOA OR passkey-direct), name │
   │     registered (e.g. frontier-path-network.impact), profile facets   │
   │     populated (org name, country, homepage)                          │
   │ Vault write: facilitator-org-vault OR adopter-org-vault (NEW; §5.7)  │
   │ On-chain:    Org SA deployed; name registered                        │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP 1. Org submits an Association Request to JP ───────────────────┐
   │ Org collects the JP-vertical payload that the Association Credential │
   │ will attest (FPG coverage for Facilitators, declared adoption for    │
   │ Adopters, capacity matrices, MOU acceptance receipt, etc.).          │
   │                                                                     │
   │ Org signs an AssociationRequest typed-data message and posts it to   │
   │ JP. Demo: in-process (both are personas in this browser).            │
   │ Production: ERC-1271 signed message between Org SA and JP SA.        │
   │                                                                     │
   │ Vault write: Org vault: pendingAssociationRequest = { requestId,    │
   │   payload, signedAt }                                                │
   │              JP vault: associationRequests += { requestId,           │
   │                payload, fromOrgSA, receivedAt }                      │
   │ On-chain:    none                                                    │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP 2. JP reviews + approves ──────────────────────────────────────┐
   │ Demo: auto-approve. Production: a JP staff workflow (out of scope).  │
   │ Either way, the result is a JP-side decision = approved.             │
   │                                                                     │
   │ Vault write: JP vault: associationRequests[i].decidedAt = now,       │
   │                          decidedAs = 'approved'                     │
   │ On-chain:    none                                                    │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP 3. JP issues the JpAssociationCredential ──────────────────────┐
   │ Jill signs a userOp from JP SA that produces an EIP-712 attestation  │
   │ over the canonical VC (envelope + Situation per §9b).                │
   │ The signed VC is handed to the Org (in-process for the demo;         │
   │ production: encrypted to the Org's SA via its sealed-mailbox facet). │
   │                                                                     │
   │ Vault write: Org vault: trustCredentials += { JpAssociationCredential│
   │   (full VC), receivedAt, issuerSA: JP, situationHash, schemaHash }   │
   │              JP vault: issuedAssociationCredentials += { credentialId│
   │   subject: Org SA, situationHash, issuedAt, kind: 'Facilitator'      │
   │   or 'Adopter' }                                                     │
   │ On-chain:    none yet (credential lives in vault per §3a Tier 1)     │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP 4. (Optional) Org publishes the Association as a public signal │
   │ The Org chooses to make its JP-Association public. Org's custodian   │
   │ signs a userOp that calls                                            │
   │ AttestationRegistry.assert(...) (§3a.3), referencing the          │
   │ credential by hash. The VC stays in vault; only the assertion       │
   │ + credentialHash + the JP-as-issuer pointer + validity window go    │
   │ on-chain.                                                            │
   │                                                                     │
   │ Vault write: Org vault: publicAssertions += { assertionId, credId,  │
   │   txHash, assertedAt }                                               │
   │ On-chain:    AttestationRegistry: AssertionRegistered event       │
   │              (subject = Org SA, credentialType, issuer = JP, ...)    │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP 5. Lifecycle from here ────────────────────────────────────────┐
   │ The Org is now a JP-associated Facilitator (or Adopter). It can:    │
   │   - participate in matches (existing match logic, but now also       │
   │     matches against ORG personas, not only individuals)              │
   │   - act as one party to an Agreement (the standard agreement flow    │
   │     in §4 below works unchanged — the Org SA replaces an individual  │
   │     SA on whichever side of the agreement it's playing)              │
   │ Status updates on the Association (revocation, expiry, role change) │
   │ follow the same nullifier pattern as §7 — see §7a.                  │
   └──────────────────────────────────────────────────────────────────────┘
```

**D-15** — does an Org need to onboard with JP *before* participating in a match, or can it match first and onboard later? Argument for "before": JP's broker function is only meaningful when both sides are JP-associated; otherwise it's a free-for-all directory. Argument for "later": lower friction; the Association becomes a *quality signal* not a prerequisite. **Recommendation: required-before-match for Org personas; optional for individual personas (existing UX unchanged).**

**D-16** — credential issuance: in-process function call (demo simplicity) vs. a sealed-mailbox facet between Org SA and JP SA (production-shape)? **Recommendation: in-process for W1; sealed-mailbox is L-11.**

**D-17** — the Org's vault stores the full VC, including all signatures. If the Org's custody is compromised, an attacker can present the VC to anyone. Is that acceptable for the demo? **Recommendation: yes for W1, with a UI warning in "Adopter/Facilitator Org" mode.** Credential-revocation flow (next sub-section) is how a real attack would be remediated.

### 4b. Public assertion lifecycle

The on-chain assertion has its own lifecycle independent of the underlying credential:

```
   asserted → (optional) renewed → revoked (by holder)
```

**Holder-only revocation.** Only the asserter can take down their own on-chain assertion. The issuer (JP for Associations, Global Church for Agreements) **cannot** touch the assertion. This is a deliberate holder-sovereignty choice (D-18 locked).

**What the issuer CAN do:** revoke the underlying credential off-chain by updating their credential-status list. The verifier check ("is this credential still valid?") is what catches stale assertions — see §3a.4. The on-chain assertion stays present; it just stops being trustworthy once the verifier resolves the credential's current status.

**Counter-party revocation on JOINT agreement assertions (NEW D-26).** A joint agreement assertion has two parties named on-chain. Either party can self-revoke their participation, which takes the row down entirely — the assertion is bilateral, so one party retracting consent invalidates the joint claim. The remaining party can re-assert later only if they re-obtain bilateral consent (per D-22). **D-26 locked: either party can unilaterally take down a joint agreement assertion.** This is symmetric to D-18 (holder sovereignty) and consistent with the bilateral-consent rule (consent is required to PUBLISH; consent is NOT required to retract).

**D-18 — locked 2026-06-02 (REVERSED from earlier draft).** Previously recommended issuer unilateral revoke "with a reason hash." Locked answer: **no issuer revocation of on-chain assertions.** Issuer controls credential status off-chain; holder controls their on-chain claim. Verifiers reconcile.

### 4d. Intent → Match → Commitment lifecycle (NEW 2026-06-02; precedes 4c)

This is the **direct-lane** workflow ported from smart-agent spec 001. It runs upstream of §4c (the agreement lifecycle). The Commitment that emerges at the end of §4d is the dual-signed input that §4c step 5a expects.

```
   ┌─ STEP I-1. Express Intent ──────────────────────────────────────────┐
   │ A persona (Adopter Org, Facilitator Org, or an individual          │
   │ Adopter/Facilitator) drafts an Intent and publishes it.            │
   │   - direction:        Receive | Give                               │
   │   - object:           resourceType (Worker, Prayer, etc.)          │
   │   - topic:            "facilitate the Najdi FPG" (free text)       │
   │   - addressedTo:      'jp' (the broker)                            │
   │   - visibility:       one of five tiers (§16)                      │
   │   - payload:          jp-vertical (FPG ids, capacity, MOU receipt) │
   │   - intent-time pre-consent: published constraints + visibility +  │
   │     "I authorize JP to broker matches against this intent for the  │
   │      duration <T..T'> within scopes [...]"                          │
   │                                                                     │
   │ Vault write: expresser's vault: intents += { intentId, direction,   │
   │   object, topic, payload, visibility, state: 'expressed', ... }    │
   │ Delegation issued: cross-delegation to JP (§17) for the brokerage   │
   │   scope, pinned to this intent's id via CalldataHashEnforcer.       │
   │ On-chain:    NONE in W1 (intent is vault + JP-mirror, not chain).   │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP I-2. JP receives the intent into its broker pool ─────────────┐
   │ JP reads the intent via the delegation (Tier-3 cross-delegation,    │
   │ §17). JP indexes it into its broker pool.                          │
   │                                                                     │
   │ Vault write: JP vault: brokerPool.intents += { intentId,            │
   │   expresserSA, projection: <coarse|full per tier>, indexedAt }      │
   │ On-chain:    NONE                                                   │
   │                                                                     │
   │ Visibility cascade (§16): JP's local view of the intent is the      │
   │ STRICTEST projection consistent with the intent's tier AND JP's     │
   │ scope under the delegation. A 'public-coarse' intent gives JP only  │
   │ the coarse projection (no donor name, no full body); a 'private-    │
   │ commitment' intent gives JP the projection the delegation scopes.   │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP I-3. JP runs the matching ranking + creates MatchInitiation ──┐
   │ JP computes the composite rank for each Receive↔Give candidate pair:│
   │   score = 0.6 * proximityScore + 0.4 * outcomeScore                 │
   │   proximityScore = 1 / (1 + hops)  (trust-graph distance)           │
   │   outcomeScore   = (fulfilled + 1) / (fulfilled + abandoned + 2)    │
   │     (Laplace-smoothed; from history)                                │
   │                                                                     │
   │ For each candidate pair above a configurable threshold, JP creates a│
   │ MatchInitiation and SNAPSHOTS the ranking basis into the row.       │
   │ The snapshot is critical: it preserves the rationale even if the    │
   │ trust graph changes later.                                          │
   │                                                                     │
   │ Vault write: JP vault: matchInitiations += { matchInitiationId,     │
   │   viewedIntentId, candidateIntentId, basis: { proximityHops,        │
   │   proximityScore, priorOutcomes, outcomeScore, composite,           │
   │   isColdStart }, state: 'proposed', createdAt }                     │
   │ On-chain:    NONE in W1 (matches are vault-only; see L-15).         │
   │                                                                     │
   │ Smart-agent invariant ported: viewedIntent.direction MUST !=        │
   │ candidateIntent.direction (Receive ↔ Give pairing). SHACL shape     │
   │ MatchInitiationOppositeDirections enforces it.                     │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP I-4. JP notifies both parties of the MatchInitiation ─────────┐
   │ JP pushes the proposal into each party's vault (in the demo:        │
   │ direct write into the party's vault keyed under                    │
   │ :match-inbox:<saAddress>; production: sealed mailbox via A2A).      │
   │                                                                     │
   │ Vault write: both parties' vaults: matchInbox += { matchInitId,    │
   │   counterpartyProjection: <visibility-aware view>, basis,           │
   │   state: 'proposed' }                                              │
   │ Intent state transition: both intents' state → 'acknowledged'       │
   │ On-chain:    NONE                                                   │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP I-5. Both parties review + accept ────────────────────────────┐
   │ Each party reviews their MatchInbox entry, decides accept/decline.  │
   │ Acceptance requires the party's userOp signature against the       │
   │ MatchInitiation's id + counterparty projection.                    │
   │                                                                     │
   │ One side declining → state: 'declined', flow ends, ranking history  │
   │ is recorded in JP's outcomes ledger so future ranks improve.       │
   │ Both sides accepting → state: 'accepted' → IntentMatch durable     │
   │ object is created.                                                  │
   │                                                                     │
   │ Vault write: each party's vault: matchInbox[i].state = 'accepted';  │
   │              JP vault: intentMatches += { matchId, parties: [...]   │
   │   originatingMatchInitId, acceptedAt }                              │
   │ On-chain:    NONE                                                   │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP I-6. Parties draft + sign the Commitment ─────────────────────┐
   │ The IntentMatch becomes the basis for a Commitment draft. Parties  │
   │ now bilaterally sign the actual deal:                              │
   │   - canonical agreement document (per §9, including the bilateral   │
   │     publicDisclosureStance per party — §9 D-22 path)                │
   │   - both party signatures (ERC-1271 against each SA)                │
   │                                                                     │
   │ Vault write: both parties' vaults: commitments += { commitmentId,   │
   │   intentMatchId, canonicalAgreement, partySignatures }              │
   │ Intent state transition: both intents' state → 'in-progress'        │
   │ On-chain:    NONE yet                                              │
   │                                                                     │
   │ JP attaches a passive MatchAttestation (D-29) — JP's signed         │
   │ statement: "this commitmentId came out of matchInitId X". JP is    │
   │ NOT a signer of the commitment itself.                              │
   │ Vault write: JP vault: matchAttestations += { commitmentId,         │
   │   originatingMatchInitId, witnessedAt, jpSignature }                │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP I-7. Hand off to §4c step 5a (agreement lifecycle) ───────────┐
   │ The dual-signed Commitment IS the dual-signed canonical agreement   │
   │ that §4c step 5a expects. The agreement flow proceeds unchanged:    │
   │ parties send the Commitment to JP (which JP already has via the     │
   │ MatchAttestation step) → JP forwards to Global Church → Global      │
   │ Church issues the AgreementCredential → optional Joint Agreement   │
   │ Assertion (§10b.2).                                                 │
   │                                                                     │
   │ Intent state transition: 'in-progress' → 'fulfilled' when the      │
   │ Outcome (next loop iteration) is achieved.                          │
   └──────────────────────────────────────────────────────────────────────┘
```

### 4d.a Intent state machine (ported)

```
drafted (vault-only, private)
   │ (express; visibility tier set; JP delegation issued)
   ↓
expressed
   │ (JP creates a MatchInitiation against this intent → counts as ack)
   ↓
acknowledged
   │ (both sides accept → IntentMatch created)
   ↓
in-progress (the parties are working under a Commitment)
   │
   ├─→ fulfilled  (Outcome achieved)
   ├─→ abandoned  (parties gave up; non-malicious)
   └─→ withdrawn  (expresser took the intent back unilaterally)
```

**D-30 locked: state values match smart-agent's catalog verbatim** (`drafted`, `expressed`, `acknowledged`, `in-progress`, `fulfilled`, `abandoned`, `withdrawn`). Future divergence requires a spec amendment.

### 4d.b What if no match is found?

Intent stays in `expressed` indefinitely until either (a) JP finds a candidate above threshold, (b) the intent's TTL expires (visibility-tier-specific TTLs per smart-agent IA §3), or (c) the expresser explicitly withdraws.

**D-31 locked: TTLs follow smart-agent's defaults** (public = 90 days; public-coarse = 60 days; private-commitment = 30 days; off-chain-only = no auto-expiry, manual withdraw only).

### 4d.c What if JP brokers a bad match?

The acceptance gate (step I-5) is the parties' only veto. Declining a MatchInitiation costs nothing on-chain (the proposal stayed in JP's vault); declining ALSO feeds the `abandoned` counter in JP's outcomes ledger, which lowers the ranking basis for similar future matches. Per smart-agent's smoothed Laplace formula `outcomeScore = (fulfilled+1) / (fulfilled+abandoned+2)`, repeated declines reduce future surfacing — the broker self-corrects.

---

### 4c. The agreement lifecycle (unchanged from prior draft)

```
   ┌─ STEP 1. Facilitator publishes coverage ─────────────────────────────┐
   │ Vault write: facilitator vault: coverage = { fpgs, capacity, ... }   │
   │ On-chain:    none                                                    │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP 2. Adopter declares adoption ──────────────────────────────────┐
   │ Vault write: adopter vault: adoption = { fpg, type, declaredAt }     │
   │ On-chain:    none                                                    │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP 3. JP brokers a match ─────────────────────────────────────────┐
   │ JP reads (in production: from the scoped delegations adopter +       │
   │   facilitator issued to JP at signup) the projections that satisfy   │
   │   the FPG + capacity intersection.                                   │
   │ Vault write: JP vault: matchesLog += { adopterSA, facilitatorSA }    │
   │ On-chain:    none                                                    │
   │ (In the demo today this is the existing `matchFacilitatorsForAdopter`│
   │  + the localStorage broker pool that landed in PR #97.)              │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP 4. Parties review + bilaterally sign the agreement ────────────┐
   │ Both adopter and facilitator EIP-712-sign the canonical agreement.  │
   │ Vault write: adopter vault:  agreements += { ..., adopterSig }       │
   │              facilitator vault: agreements += { ..., facilitatorSig }│
   │ On-chain:    none yet                                                │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP 5a. Parties send the dual-signed agreement to JP ──────────────┐
   │ Adopter + facilitator hand JP the canonical agreement + both         │
   │ signatures + the opening secrets needed to compute the commitments.  │
   │ JP is the default workflow step (D-8); a determined party can go     │
   │ directly to Global Church as a fallback, bypassing JP entirely.      │
   │                                                                     │
   │ Vault write: JP vault: pendingDrafts += { draftId, adopterSA,        │
   │   facilitatorSA, canonicalAgreement, signatures, openingSecrets,     │
   │   receivedAt }                                                       │
   │ On-chain:    none                                                    │
   │                                                                     │
   │ JP's role here is workflow + match-attestation in the UI ("this      │
   │ draft is from a match I brokered"). JP does NOT add a cryptographic  │
   │ stamp in W1 — the issuance signature comes solely from Global Church.│
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP 5b. JP forwards the draft to Global Church ────────────────────┐
   │ JP submits the unchanged canonical agreement + both party signatures │
   │ + opening secrets to Global Church (in the demo: in-process call,    │
   │ since both are personas in the same browser; in production: signed   │
   │ message between JP's SA and Global Church's SA).                     │
   │                                                                     │
   │ JP CANNOT alter the canonical agreement here — party signatures pin  │
   │ it byte-for-byte. JP CAN delay, withhold, or refuse to forward (the  │
   │ demo surfaces a "JP refused / pending" state); parties then have the │
   │ direct-to-Global-Church fallback.                                    │
   │                                                                     │
   │ Vault write: JP vault: pendingDrafts[i].forwardedAt = now            │
   │              Global Church vault: pendingIssuance += { draftId, ... }│
   │ On-chain:    none                                                    │
   │                                                                     │
   │ Global Church's role here: verify, NOT decide. It checks:            │
   │   - both signatures resolve via ERC-1271 against the two SAs         │
   │   - the canonical agreement conforms to `schemaHash`                 │
   │   - the parties are distinct, registered agents                     │
   │   - the commitments compute correctly                                │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP 6. Global Church issues + writes the commitment ───────────────┐
   │ Pete signs a userOp from Global Church SA that:                      │
   │   (a) calls AgreementRegistry.register(commitmentRecord)   │
   │   (b) Global Church's Pete-signed EIP-712 attestation is the         │
   │       "issuer signature" component of the AgreementCredential.       │
   │ Vault write: Global Church vault: issuanceLog +=                     │
   │   { commitment, schemaHash, statusCommitment, attestationTypedData } │
   │              JP vault: pendingDrafts[i].issuedAt = now (move from    │
   │                pendingDrafts → issuedReceipts)                       │
   │              adopter vault: agreements[i].issuerAttestation = ...    │
   │              facilitator vault: agreements[i].issuerAttestation =... │
   │ On-chain:    CommitmentRegistered event                              │
   └──────────────────────────────────────────────────────────────────────┘
                              │
   ┌─ STEP 7. Status transitions (revoke, complete, dispute, expire) ─────┐
   │ One or both parties present nullifiers + a new statusCommitment.    │
   │ Global Church OR either party (depending on the action's policy)    │
   │ submits `updateStatus(commitment, newStatusCommitment, nullifier)`. │
   │ Vault write: all relevant party vaults update their copy.            │
   │ On-chain:    StatusUpdated event + nullifier in the consumed set.    │
   └──────────────────────────────────────────────────────────────────────┘
```

**[D-7]** — Who pays gas for §6 and §7? The demo-a2a relayer already sponsors. But that's the gas-payer correlation leak from the privacy warning. For W1 we accept this leak; pin it as a known limitation. **[L-3]** — per-issuer relayer rotation in a privacy-hardening wave.

---

## 5. Vault shapes (full set)

### 5.1 Pete (Global Church custodian state)

```ts
type StoredEoa = {
  privateKey: Hex;                      // 32 bytes; localStorage-resident; DEMO ONLY
  address: Address;
  role: 'global-church-custodian' | 'jp-custodian';
  createdAt: number;
};

// localStorage key: agenticprimitives:demo-jp:eoa:pete
// localStorage key: agenticprimitives:demo-jp:eoa:jill
```

### 5.2 Global Church vault (issuer state)

```ts
type GlobalChurchVault = {
  v: 1;
  saAddress: Address;                   // computed from Pete's address at first boot
  custodianEoa: Address;                // Pete's address
  profile: {
    displayName: string;                // "Global Church"
    country?: string;
    homepage?: string;
  };
  issuanceLog: IssuanceEntry[];
};

type IssuanceEntry = {
  agreementCommitment: Hex;
  schemaHash: Hex;
  partySetCommitment: Hex;              // H(adopterCommitment, facilitatorCommitment)
  statusCommitment: Hex;
  issuedAt: number;                     // local clock; epoch-bucket published on-chain
  txHash?: Hex;                         // registry-write tx
  attestationTypedData: { domain, types, primaryType, message };
  attestationSignature: Hex;            // Pete's signature (eth_sign / EIP-712)
};

// localStorage key: agenticprimitives:demo-jp:org:global-church
```

### 5.3 JP vault (broker state)

```ts
type JpVault = {
  v: 1;
  saAddress: Address;
  custodianEoa: Address;                // Jill's address
  profile: {
    displayName: string;                // "Joshua Project"
    country?: string;
    homepage?: string;
  };
  matchesLog: MatchEntry[];
  pendingDrafts: PendingDraftEntry[];   // D-8: drafts received, awaiting forward / issuance
  issuedReceipts: IssuedReceiptEntry[]; // drafts that completed issuance (cleared from pending)
};

type MatchEntry = {
  matchId: Hex;                         // H(adopterSA, facilitatorSA, fpgId, matchedAt)
  adopterSA: Address;
  facilitatorSA: Address;
  fpgId: string;
  matchedAt: number;
  surfacedAtBoth: boolean;
};

type PendingDraftEntry = {
  draftId: Hex;                         // H(adopterSA, facilitatorSA, agreementHash)
  matchId?: Hex;                        // back-ref to MatchEntry when JP recognises the pair
  adopterSA: Address;
  facilitatorSA: Address;
  canonicalAgreement: AgreementDocument;
  signatures: { adopter: Hex; facilitator: Hex };
  openingSecrets: { saltA: Hex; saltF: Hex; agreementSalt: Hex };
  receivedAt: number;
  forwardedAt?: number;                 // null = JP hasn't forwarded yet; demo surfaces "pending"
  refusedAt?: number;                   // present iff JP explicitly refused; parties can fall back to GC
};

type IssuedReceiptEntry = {
  draftId: Hex;
  agreementCommitment: Hex;             // computed by Global Church + landed on-chain
  receivedAt: number;
  forwardedAt: number;
  issuedAt: number;
  issuerTxHash: Hex;
};

// localStorage key: agenticprimitives:demo-jp:org:jp
```

**D-8 locked (reversed):** JP holds drafts from §4 Step 5a until they're issued (or refused). `pendingDrafts[]` is the holding-cell. `issuedReceipts[]` is the audit trail of completed drafts. JP cannot alter `canonicalAgreement` or the signatures — they're handed in already-bound; JP just stores them, forwards them, and surfaces match-attestation in the UI.

### 5.4 Adopter vault (extension to existing `JpAdopterRecord`)

```ts
// existing JpAdopterRecord stays; ADD an agreements[] field:
type AdopterAgreementEntry = {
  agreementCommitment: Hex;
  schemaHash: Hex;
  counterpartyDisplayName: string;      // facilitator's projected name; from the match
  role: 'adopter';
  canonicalAgreement: AgreementDocument;
  signatures: {
    adopter: Hex;                       // ERC-1271 from adopter's SA
    facilitator: Hex;                   // ERC-1271 from facilitator's SA
    issuer: Hex;                        // EIP-712 from Global Church SA (via Pete)
  };
  openingSecrets: {
    saltA: Hex;                         // adopter's commitment salt
    agreementSalt: Hex;                 // top-level agreement salt
  };
  status: 'active' | 'completed' | 'revoked' | 'disputed' | 'expired';
  proofWitnesses?: unknown;             // [L-4] — populated when ZK lands
};
```

### 5.5 Facilitator vault (extension to existing `JpFacilitatorRecord`)

Mirrors §5.4 with `role: 'facilitator'`.

### 5.6 Per-agreement vault entry (held by every party)

The same shape as 5.4 / 5.5 lives at:

```
key: agenticprimitives:demo-jp:agreement-vault:<agreementCommitment>:<holderSA>
```

A user with multiple personas in one browser will end up holding the same agreement under multiple holder keys — that's correct; each persona has its own view of the agreement (different roles, different opening secrets, different proof witnesses later).

### 5.7 Adopter Org vault + Facilitator Org vault (NEW)

```ts
type OrgVault = {
  v: 1;
  saAddress: Address;                   // the Org SA address
  custodianRef: { kind: 'passkey' | 'wallet'; identifier: Hex | Address };
  profile: {
    organizationName: string;
    organizationCountry?: string;
    organizationHomepage?: string;
    contactEmail?: string;
  };
  kind: 'facilitator-org' | 'adopter-org';

  // Onboarding state
  pendingAssociationRequest?: {
    requestId: Hex;
    payload: AssociationRequestPayload;  // JP-vertical: FPG coverage / declared adoption / capacity / MOU receipt
    signedAt: number;
    decidedAt?: number;
    decidedAs?: 'approved' | 'declined';
  };

  // Credentials issued TO this Org (held privately)
  trustCredentials: TrustCredentialEntry[];

  // Public assertions made by this Org (the holder-side mirror of on-chain rows)
  publicAssertions: PublicAssertionEntry[];

  // JP-vertical payload — Facilitator Orgs carry coverage like §5.5; Adopter Orgs carry declared adoptions like §5.4.
  // Same schemas as the individual personas, lifted to org-level.
};

type TrustCredentialEntry = {
  credentialId: Hex;                    // H(canonical(VC))
  credentialType: Hex;                  // keccak256("JpFacilitatorAssociationCredential:v1") etc.
  issuerSA: Address;                    // JP SA for Association; Global Church SA for Agreement
  situationHash: Hex;                   // H(canonical(Situation))
  schemaHash: Hex;                      // H(canonical(SHACL shape))
  validFrom: number;
  validUntil?: number;
  vc: VerifiableCredential;             // full envelope; W3C-VC shape + EIP-712 issuer signature
  receivedAt: number;
  status: 'active' | 'revoked-by-holder' | 'revoked-by-issuer' | 'expired';
  revocationProof?: { txHash: Hex; reasonHash?: Hex };
};

type PublicAssertionEntry = {
  assertionId: Hex;                     // on-chain row id
  credentialId: Hex;                    // back-reference into trustCredentials[]
  assertedAt: number;
  txHash: Hex;
  status: 'asserted' | 'revoked-by-holder' | 'revoked-by-issuer';
};

// localStorage key: agenticprimitives:demo-jp:org-vault:<saAddress>
```

Same shape applies to both Adopter Orgs and Facilitator Orgs — the `kind` field discriminates. (A single Org could in principle be both; per **D-19** below, we hold the line that a given Org SA is one or the other for W1.)

### 5.8 Intent vault (NEW 2026-06-02) — per persona that expresses intents

Lives on every persona that can express intents: individual Adopter, individual Facilitator, Adopter Org, Facilitator Org. Ported from smart-agent `/apps/web/drizzle/0012_intents_bdi.sql`.

```ts
type IntentEntry = {
  intentId: Hex;                        // H(expresserSA, salt, createdAt) — locally unique
  direction: 'Receive' | 'Give';        // single property, no subclasses (smart-agent rejected-design #3)
  object: string;                       // SKOS concept URI (Worker, Prayer, Mentorship, etc.)
  topic: string;                        // free-text label, "facilitate the Najdi FPG"
  intentType?: string;                  // derived UI label, taxonomic projection of direction × object
  expresserSA: Address;                 // = this persona
  addressedTo: Address | 'jp';          // 'jp' = JP-broker-mediated; specific SA = directly addressed
  expressedAt: number;
  state: 'drafted' | 'expressed' | 'acknowledged' | 'in-progress' | 'fulfilled' | 'abandoned' | 'withdrawn';
  visibility: VisibilityTier;           // §16; one of the five
  ttlExpiresAt?: number;                // §16 D-31 visibility-tier-specific defaults
  payload: IntentPayload;               // jp-vertical: { peopleGroupId, capacityBucket, mouHash, ... }
  expectedOutcome?: OutcomeDescriptor;  // what the expresser hopes to be true after fulfillment
  preConsent: {
    jpBrokerageDelegationId: Hex;       // back-ref into the cross-delegation issued to JP at express time (§17)
    matchCriteria: MatchCriteria;       // structured constraints JP MUST satisfy before surfacing a match
    autoConsentOnMatch: false;          // W1: never auto-consent; manual review at every match step
  };
  liveAcknowledgementCount: number;     // derived; incremented when JP creates a MatchInitiation against this intent
  // NOT in the ontology — smart-agent rejected-design #4; lives in app state only
  matchInbox: MatchInboxEntry[];        // proposals JP has surfaced to this expresser
};

type MatchInboxEntry = {
  matchInitiationId: Hex;
  counterpartyProjection: CounterpartyProjection;   // visibility-aware view JP gives this party
  basis: RankingBasisSnapshot;                       // §3b.4; rationale at proposal time
  state: 'proposed' | 'accepted' | 'declined' | 'expired';
  receivedAt: number;
  decidedAt?: number;
};

type RankingBasisSnapshot = {
  proximityHops: number;
  proximityScore: number;     // 0..1
  priorOutcomes: number;      // count of prior fulfilled+abandoned for counterparty
  outcomeScore: number;       // 0..1 (Laplace-smoothed)
  composite: number;          // 0..1 (final rank: 0.6*proximity + 0.4*outcome)
  isColdStart: boolean;       // true if priorOutcomes == 0
};

// localStorage keys:
//   agenticprimitives:demo-jp:intent-vault:<expresserSA>:<intentId>
//   agenticprimitives:demo-jp:match-inbox:<saAddress>          (mirror of MatchInbox entries for fast UI lookup)
```

### 5.9 JP broker vault extension (NEW 2026-06-02)

Extends the JP vault (§5.3) with the broker-pool side of the spine:

```ts
type JpVault = {
  // ... existing fields from §5.3 ...
  brokerPool: {
    intents: BrokerPoolIntentEntry[];
    matchInitiations: MatchInitiationEntry[];
    intentMatches: IntentMatchEntry[];
    matchAttestations: MatchAttestationEntry[];
    outcomesLedger: OutcomeLedgerEntry[];   // for ranking basis history
  };
};

type BrokerPoolIntentEntry = {
  intentId: Hex;
  expresserSA: Address;
  delegationId: Hex;                    // the cross-delegation that authorized JP to see this intent (§17)
  projection: IntentProjection;         // visibility-aware view (full / coarse / summary)
  indexedAt: number;
  ttlExpiresAt?: number;                // tracked separately by JP so JP can drop expired intents
};

type MatchInitiationEntry = {
  matchInitiationId: Hex;
  viewedIntentId: Hex;
  candidateIntentId: Hex;
  basis: RankingBasisSnapshot;          // snapshot — never updated after creation
  state: 'proposed' | 'one-side-accepted' | 'both-accepted' | 'declined' | 'expired';
  createdAt: number;
  notifiedBoth: boolean;
};

type IntentMatchEntry = {
  intentMatchId: Hex;
  originatingMatchInitiationId: Hex;
  parties: [Address, Address];          // [adopterSA, facilitatorSA] (or reverse — by direction)
  acceptedAt: number;
};

type MatchAttestationEntry = {
  commitmentId: Hex;
  originatingMatchInitiationId: Hex;
  witnessedAt: number;
  jpSignature: Hex;                     // JP's passive attestation (D-29)
};

type OutcomeLedgerEntry = {
  partyA: Address;
  partyB: Address;
  outcome: 'fulfilled' | 'abandoned';
  recordedAt: number;
  // Used by ranking formula across future matches involving these parties.
};

// localStorage key: agenticprimitives:demo-jp:org:jp  (extended)
```

## 6. Storage layout (one-page summary)

### Off-chain (localStorage)

```
agenticprimitives:demo-jp:eoa:pete                              — Pete EOA
agenticprimitives:demo-jp:eoa:jill                              — Jill EOA
agenticprimitives:demo-jp:org:global-church                     — Global Church vault (issuer)
agenticprimitives:demo-jp:org:jp                                — JP vault (broker + association-issuer)
agenticprimitives:demo-jp:facilitator-record:<addr>             — existing (per-SA, individual)
agenticprimitives:demo-jp:adopter-record:<addr>                 — existing (per-SA, individual)
agenticprimitives:demo-jp:org-vault:<saAddress>                 — NEW; per-Org (Adopter or Facilitator Org)
agenticprimitives:demo-jp:agreement-vault:<commit>:<holder>     — NEW; per-agreement
agenticprimitives:demo-jp:session                               — existing
```

### On-chain (Base Sepolia)

```
Global Church SA            (Org AgentAccount, mode 0, custodian = Pete)
JP SA                       (Org AgentAccount, mode 0, custodian = Jill)
Adopter Org SAs             (user-onboarded; user-custodied; one per onboarded org)
Facilitator Org SAs         (user-onboarded; user-custodied; one per onboarded org)
global-church.impact        — name → Global Church SA   (existing AgentNameRegistry)
joshua-project.impact       — name → JP SA              (existing AgentNameRegistry)
<org-name>.impact           — one per user-onboarded Org
AgreementRegistry — NEW contract, W1 (commitment-only; see §3.3)
AttestationRegistry      — NEW contract, W1 (public trust signals; see §3a.3 and §10b)
ShapeRegistry (existing)    — registers the SHACL shape for JpAssociationDescription
                              and AgentCollaborationAgreementShape
```

---

## 7. Seeding flow (first run)

```
User opens demo-jp for the first time
            │
            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ App boot: ensureDemoPersonas()                              │
  │   if no Pete in localStorage → generate Pete                │
  │   if no Jill in localStorage → generate Jill                │
  │   compute Global Church SA address from Pete                │
  │   compute JP SA address from Jill                           │
  │   write both org-vault stubs (saAddress, custodianEoa, name)│
  └─────────────────────────────────────────────────────────────┘
            │
            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ User sees a "Demo personas" panel (top-right or hidden in   │
  │ dev mode?):                                                 │
  │   Pete    0xABCD…1234   custodies Global Church (0xWXYZ…)   │
  │   Jill    0xDEFG…5678   custodies Joshua Project (0xKLMN…)  │
  │   [Switch persona ▾]                                        │
  └─────────────────────────────────────────────────────────────┘
            │
            ▼
  Lazy deploy: the first time Global Church needs to do
  something on-chain (issue an agreement), demo-jp calls
  /session/direct-deploy with mode=0 + custodians=[pete.address].
  Same path for JP, the first time JP touches chain.
```

**[D-9]** — "Demo personas" panel: always visible, or only when a query string flag like `?demo-panel=1` is present? **Recommendation: always visible during development; gate behind a build flag for whatever you'd call "demo mode" for external audiences.**

---

## 8. Persona-switching UX

A single browser holds state for up to 4 personas concurrently. The user picks who they are *right now* via a persona-switcher.

| Current persona | What loads | Where the dashboard lives |
|---|---|---|
| Pete | Global Church vault + issuance log | `/issuer` |
| Jill | JP vault + matches log | `/broker` |
| Facilitator (own SA) | facilitator vault | `/facilitator` (existing) |
| Adopter (own SA) | adopter vault | `/adopter` (existing) |

**[D-10]** — should switching personas blow away `session` (and force re-sign-in) or just swap the active record? **Recommendation: swap-only for Pete/Jill (they're demo personas, not central-auth identities); preserve the existing sign-in for Adopter/Facilitator.**

---

## 9. Schema for the canonical agreement document

```jsonc
{
  "type": "AgentCollaborationAgreement",
  "schema": "agentic:agreement:v1",       // schemaHash = keccak256(canonical JSON of this schema)
  "roles": {
    "adopter": "did:agent:caip-10",        // canonical agent id; private in the public commitment
    "facilitator": "did:agent:caip-10"     // same
  },
  "issuer": "did:agent:global-church.impact",   // [D-11] public (Option A) vs. issuerGroupRoot (Option B)
  "termsHash": "0x...",                    // hash of the human-readable terms doc
  "validFrom": "2026-06-01T00:00:00Z",
  "validUntil": "2027-06-01T00:00:00Z",
  "jurisdiction": "n/a (demo)",
  "capabilities": ["receive-quarterly-update", "facilitator-prayer-channel-access"],
  "vaultPolicy": "agreement-vault-v1",     // how the vault holders store this; informational
  "revocationPolicy": "either-party-with-nullifier",

  // **Public-disclosure consent — BILATERAL (NEW 2026-06-02).**
  //
  // RULE: an agreement may go public on-chain only if BOTH parties have
  // consented. Consent may be expressed at CREATION time (pre-authorization
  // baked into the credential) or AFTER creation (a fresh delegation per
  // §10b.2 D-23). The rule is symmetric — neither party can unilaterally
  // make the agreement public, regardless of which party physically submits
  // the tx.
  //
  // Each party signs the agreement with their public-disclosure stance
  // encoded. Once both signatures land, the stances bind into the canonical
  // agreement + the AgreementCredential and cannot be changed unilaterally.
  // A party can broaden their stance later (e.g., flip from
  // 'requires-fresh-consent' to 'pre-authorized' by issuing a fresh
  // delegation); they cannot narrow it without re-signing the agreement.
  "publicDisclosureStance": {
    "adopter":     "pre-authorized",      // or "requires-fresh-consent" or "strictly-confidential"
    "facilitator": "requires-fresh-consent"
  }
}
```

**Stance vocabulary:**

| Value | Meaning for the party that set it |
|---|---|
| `pre-authorized` | I consented at creation. No additional artifact from me is required to make the agreement public; my signature on the agreement IS my consent. |
| `requires-fresh-consent` | A public assertion of this agreement requires a FRESH scoped delegation from me at assertion time. My agreement-time signature does NOT count as consent to publish. |
| `strictly-confidential` | I will never consent. On-chain assertion involving me is FORBIDDEN at the registry layer — no delegation or signature suffices. (Off-chain bilateral disclosure between holders is still possible by definition; this is an on-chain rule.) |

Both party signatures cover the stance tuple, so a party cannot later claim a different stance was theirs.

**Allowed combinations and what each requires at assertion time:**

| adopter stance | facilitator stance | What's needed to publicly assert |
|---|---|---|
| `pre-authorized` | `pre-authorized` | Nothing extra — credential alone authorizes |
| `pre-authorized` | `requires-fresh-consent` | Fresh delegation from facilitator |
| `requires-fresh-consent` | `pre-authorized` | Fresh delegation from adopter |
| `requires-fresh-consent` | `requires-fresh-consent` | Fresh delegations from BOTH parties |
| `strictly-confidential` | (anything) | Refused at registry layer |
| (anything) | `strictly-confidential` | Refused at registry layer |

**[D-12]** — `schema` and `schemaHash` registration: store the schema as an ontology shape (`packages/ontology` `ShapeRegistry`), or treat it as opaque off-chain JSON with the hash being the only on-chain artifact? **Recommendation: ontology shape — gives us SHACL validation for free and matches the existing on-chain ontology infrastructure.**

---

## 10. Commitment computation (the math from the prior conversation, pinned)

```
agreementHash         = H(canonical(agreementDocument))
adopterCommitment     = H(adopterAgentSecret, adopterSA, agreementHash, "adopter", saltA)
facilitatorCommitment = H(facilitatorAgentSecret, facilitatorSA, agreementHash, "facilitator", saltF)
issuerCommitment      = H(issuerSA, agreementHash, issuerSalt)
partySetCommitment    = H(adopterCommitment, facilitatorCommitment)
agreementCommitment   = H(agreementHash, partySetCommitment, issuerCommitment, schemaHash, agreementSalt)
```

Where `H` is `keccak256` on the abi-encoded tuple (chain-native), and "agent secret" is a per-(SA, salt) derived value held in the party's vault.

**[D-13]** — `adopterAgentSecret` derivation: a fresh `crypto.getRandomValues` per agreement (clean, no reuse) vs. an HKDF over a single per-SA root secret (lets the SA "remember" itself across agreements without external storage). **Recommendation: per-agreement random + persisted.** HKDF root introduces a long-lived key the demo's localStorage now has to defend.

---

## 9b. Schema for the JpAssociationCredential (DOLCE+DnS Situation)

The credential envelope is a W3C-VC; the `credentialSubject` is a DOLCE+DnS Situation that satisfies an on-chain-registered SHACL Description.

```jsonc
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://agenticprimitives.org/context/v1"
  ],
  "type": ["VerifiableCredential", "JpAssociationCredential"],
  "issuer": "did:agent:joshua-project.impact",
  "issuanceDate": "2026-06-01T00:00:00Z",
  "credentialSubject": {
    "@type": "Situation",
    "situationType": "JpFacilitatorAssociationSituation",
    "satisfies": "did:shape:JpFacilitatorAssociationDescription:v1",
    "hasParticipant": [
      { "role": "JpRelator", "agent": "did:agent:joshua-project.impact" },
      { "role": "Member",    "agent": "did:agent:<Org>.impact"          }
    ],
    "hasParameters": {
      "associationKind": "Facilitator",        // or "Adopter"
      "validFrom":       "2026-06-01T00:00:00Z",
      "validUntil":      null
    },
    "hasSetting": "2026-06-01T00:00:00Z/.."
  },
  "credentialSchema": {
    "id": "did:shape:JpFacilitatorAssociationDescription:v1",
    "type": "ShaclShape",
    "schemaHash": "0x..."                       // keccak256 of canonical SHACL
  },
  "proof": {
    "type": "Eip712Signature2026",
    "verificationMethod": "did:agent:joshua-project.impact#erc1271",
    "created": "2026-06-01T00:00:00Z",
    "domain": { "name": "JpAssociationCredential", "version": "1", "chainId": 84532 },
    "primaryType": "JpAssociationCredential",
    "signature": "0x..."                        // EIP-712 over canonical(credential without proof)
  }
}
```

**Hashes that flow on-chain:**

```
credentialHash = keccak256(canonical(credential WITHOUT proof))
situationHash  = keccak256(canonical(credentialSubject))
schemaHash     = keccak256(canonical(SHACL Description))    // ontology-registered
```

The on-chain `AttestationRegistry` row references `credentialHash`, `schemaHash`, and `issuer` (= JP SA in this case) — it does NOT expose `credentialSubject` content beyond the schema. The full credential stays in the holder's vault.

**D-19** — does a single Org SA hold both a Facilitator AND an Adopter credential at once (a hybrid Org acting on both sides)? Argument for: real orgs sometimes do both. Argument against: complicates matching + UI. **Recommendation: W1 holds the line at one credential type per Org SA; hybrids deploy two Org SAs.**

**D-20** — credential `validUntil` semantics: hard expiry (after T, every verifier rejects) vs. soft (after T, the cred shows "needs renewal" but isn't invalid)? **Recommendation: hard expiry**, with the holder responsible for re-requesting before T.

**D-21** — JP signs the VC via Jill's EOA against JP SA's ERC-1271 verification. Should the signature be an EIP-712 typed-data over a fixed `JpAssociationCredential` domain (clean) or an `eth_sign`-wrapped hash (universal)? **Recommendation: EIP-712**, matches the rest of the stack.

---

## 10. Commitment computation (the math from the prior conversation, pinned)

```
agreementHash         = H(canonical(agreementDocument))
adopterCommitment     = H(adopterAgentSecret, adopterSA, agreementHash, "adopter", saltA)
facilitatorCommitment = H(facilitatorAgentSecret, facilitatorSA, agreementHash, "facilitator", saltF)
issuerCommitment      = H(issuerSA, agreementHash, issuerSalt)
partySetCommitment    = H(adopterCommitment, facilitatorCommitment)
agreementCommitment   = H(agreementHash, partySetCommitment, issuerCommitment, schemaHash, agreementSalt)
```

Where `H` is `keccak256` on the abi-encoded tuple (chain-native), and "agent secret" is a per-(SA, salt) derived value held in the party's vault.

**[D-13]** — locked above.

---

## 10b. Public assertion shapes (Trust Assertion Registry)

Two public-assertion variants exist for W1:

### 10b.1 Association assertion (Org → JP)

```solidity
struct AssociationAssertion {
    address subject;            // Org SA (= holder)
    bytes32 credentialType;     // keccak256("JpFacilitatorAssociationCredential:v1")
    address issuer;             // JP SA (public per D-11 = Option A)
    bytes32 credentialHash;     // keccak256(canonical(VC))
    bytes32 schemaHash;         // keccak256(canonical(SHACL Description))
    uint64  validFrom;
    uint64  validUntil;         // 0 = no expiry
    uint64  assertedAtEpochBucket;
    bytes32 statusCommitment;
}
```

Stored in `AttestationRegistry`, indexed by `assertionId = keccak256(abi.encode(subject, credentialType, issuer, credentialHash))`.

### 10b.2 Joint agreement assertion (both parties → AgreementCommitment)

**Architectural rule (locked 2026-06-02):** an agreement assertion is **joint** — it names BOTH parties on-chain and requires BOTH parties' consent. There is no "unilateral self-reveal" path. Either both parties pre-authorized at creation, or both supplied fresh delegations at assertion time (or a mix of one of each), or the assertion is refused.

```solidity
struct JointAgreementAssertion {
    // Both parties are named on-chain; the assertion is bilateral by construction.
    address adopter;
    address facilitator;

    // Identity of the credential being asserted.
    bytes32 credentialType;       // keccak256("AgreementCredential:v1")
    address issuer;               // Global Church SA
    bytes32 credentialHash;       // keccak256(canonical(AgreementCredential))
    bytes32 agreementCommitment;  // back-ref into AgreementRegistry

    // Reveal proofs — needed so a verifier can recompute the party-side
    // commitments and confirm the two parties named ARE the two parties
    // of the AgreementCommitment row.
    bytes32 adopterRevealProof;
    bytes32 facilitatorRevealProof;

    // Per-party consent artifacts. Each is EITHER empty (when that party's
    // stance is 'pre-authorized') OR a packed Delegation
    // (DelegationManager-compatible) signed by that party at assertion
    // time (when their stance is 'requires-fresh-consent'). If EITHER
    // party's stance is 'strictly-confidential', the registry refuses
    // the call before reading consent fields.
    bytes adopterConsent;
    bytes facilitatorConsent;

    uint64  assertedAtEpochBucket;
    bytes32 statusCommitment;
}
```

### 10b.2.a Verification rules at the registry contract

```
function assertJointAgreement(JointAgreementAssertion calldata a) external {
    // 0. Lookup the credential's stance tuple. Practically, the asserter
    //    submits (adopterStance, facilitatorStance) alongside; the contract
    //    verifies they match what's bound in the credential by checking
    //    BOTH parties' EIP-712 signatures over the canonical credential
    //    bytes that contain those stances.

    // 1. Refuse strictly-confidential agreements outright.
    require(adopterStance != STRICTLY_CONFIDENTIAL, "adopter is strictly confidential");
    require(facilitatorStance != STRICTLY_CONFIDENTIAL, "facilitator is strictly confidential");

    // 2. Verify the agreement-creation-time consent OR a fresh
    //    delegation, for each party independently.
    if (adopterStance == PRE_AUTHORIZED) {
        require(a.adopterConsent.length == 0, "pre-authorized: no fresh consent");
    } else {
        // requires-fresh-consent: validate a fresh delegation from adopter,
        // pinned to this exact assertion's calldata, in-window.
        DelegationManager.verifyAuthorization(
            decode(a.adopterConsent),
            /* delegator   = */ a.adopter,
            /* delegate    = */ msg.sender,        // whichever party (or relayer) submits
            /* targetCheck = */ address(this),
            /* method      = */ this.assertJointAgreement.selector,
            /* calldataPin = */ keccak256(msg.data),
            /* now         = */ block.timestamp
        );
    }
    if (facilitatorStance == PRE_AUTHORIZED) {
        require(a.facilitatorConsent.length == 0, "pre-authorized: no fresh consent");
    } else {
        DelegationManager.verifyAuthorization(decode(a.facilitatorConsent), /* ...same shape for facilitator... */);
    }

    // 3. Verify reveal proofs reconstitute the agreementCommitment
    //    held in AgreementRegistry.

    // 4. Insert into AttestationRegistry; emit JointAgreementAsserted.
}
```

### 10b.2.b The submitter is incidental

Whoever physically submits the tx is incidental. msg.sender can be either party, OR a third-party relayer (e.g., demo-a2a). What MATTERS is the consent artifacts — both parties' consent must be present in the right form per their stance. The on-chain record names BOTH parties (`adopter`, `facilitator`), so the assertion is bilateral by construction even if only one party clicks the button.

### 10b.2.c Locked decisions

**D-22 — locked 2026-06-02 (reversed from earlier draft; refined 2026-06-02).**
Public assertion of an agreement is **bilateral**. There is no unilateral self-reveal. Both parties' consent must be present — either pre-authorized at creation (signed into the credential) or fresh at assertion time (a delegation). The on-chain row names both parties.

**D-23 — locked 2026-06-02.**
Fresh consent at assertion time uses the existing `@agenticprimitives/delegation` primitive. The delegator is the consenting party; the delegate is the submitting party (or, when the submitter is a third-party relayer, an arbitrary public address — the delegation's `CalldataHashEnforcer` pins the exact assertion bytes, so even a wide-open delegate is safe). Caveats:

```
counterpartyDelegation = {
  delegator: consenting party SA,
  delegate:  submitter SA  (or address(0) for "anyone can submit this specific bytes"),
  authority: ROOT_AUTHORITY,
  caveats: [
    { enforcer: AllowedTargetsEnforcer, terms: encode(AttestationRegistry) },
    { enforcer: AllowedMethodsEnforcer, terms: encode(assertJointAgreement.selector) },
    { enforcer: TimestampEnforcer,      terms: encode(validAfter, validUntil) },
    { enforcer: CalldataHashEnforcer,   terms: encode(keccak256(exact assertion bytes)) }
  ],
  salt: <random>,
  signature: party's ERC-1271 over the EIP-712 delegation hash
}
```

The delegation is delivered to the asserter via the same channel that delivers credentials (in the demo, in-process; in production, sealed-mailbox or A2A). The registry treats the delegation as an **authorization predicate**, not as a delegation-chain-to-execute — `DelegationManager` is reused for its signature + caveat machinery, not for cross-account execution.

**D-24 — OBSOLETE (asked the wrong question).** There is no unilateral self-reveal path under the bilateral rule, so the question "can a party reveal their own side when their stance is strictly-confidential" doesn't arise — they cannot reveal anything without the counterparty's consent regardless of their own stance, and `strictly-confidential` blocks the whole assertion at the registry layer.

**D-25 (NEW)** — third-party assertions (asserter is neither party): out of scope for W1 (**L-12**). When we add them, they require both parties' fresh delegations (no shortcut via `pre-authorized` — pre-auth covers "this agreement can be asserted by either party"; a third party still needs explicit grants).

**Privacy posture refresh.** With the bilateral rule, the W1 commitment-registry's privacy claim becomes:

> A commitment row publicly reveals: a commitment hash, the issuer (Global Church), a schema hash, and an epoch bucket. It does NOT reveal either party UNLESS both parties have jointly chosen to surface the agreement via a `JointAgreementAssertion`.

That's stronger than what we had before (which would have let one party out the other indirectly). The L-N privacy hardening items still apply on top (gas-payer correlation, timing buckets, padding).

---

## 11. Decisions (locked 2026-06-02)

| # | Decision | Resolution |
|---|---|---|
| D-1 | Mode-0 OK for Global Church / JP? | **Locked: yes.** Mode-0 EOA-only custodian for both. |
| D-2 | Key gen: random vs. seeded? | **Locked: random + persisted** (`viem.generatePrivateKey()` then write to `localStorage`). |
| D-3 | Cross-device Pete/Jill? | **Locked: out of scope.** Each device has its own Pete/Jill; document as known demo limitation. |
| D-4 | Collapse Global Church + JP into one org? | **Locked: keep separate.** Privilege separation between issuer and broker preserved. |
| D-5 | Salt convention for org SA addresses? | **Locked: stable** (`keccak256("demo-jp:global-church:v1")` / `"demo-jp:jp:v1"`). Same address reproduces across reloads until "Reset demo". |
| D-6 | Where does `AgreementRegistry` live? | **Deferred** to [packages.md](packages.md). The contract + SDK location decision is part of the broader packages-and-spec discussion for demo-jp. |
| D-7 | Who pays gas for issuance + status updates? | **Locked: demo-a2a relayer.** Gas-payer correlation leak documented as W1 limitation; L-3 closes via per-issuer relayer rotation. |
| D-8 | Does JP see agreement drafts? | **Locked: REVERSED — yes, JP DOES see drafts.** Adopter + facilitator route the draft via JP by default (workflow holding-cell + match-attestation). JP cannot alter or issue. Direct-to-Global-Church fallback documented. See §2 and §4 step 5a/5b above. |
| D-9 | "Demo personas" panel visibility? | **Locked: always visible for now.** Re-evaluate before external-audience builds. |
| D-10 | Persona switch blows away session? | **Locked: swap-only for Pete/Jill.** Preserve existing sign-in flow for Adopter/Facilitator. |
| D-11 | Issuer public (Option A) or issuerGroupRoot (Option B) for W1? | **Locked: Option A** (Global Church is the public issuer). Option B (group-root) deferred to L-2. |
| D-12 | Schema registration: ontology shape or opaque off-chain hash? | **Locked: ontology shape** (`packages/ontology` `ShapeRegistry`). SHACL validation comes for free. |
| D-13 | `adopterAgentSecret`: per-agreement random or HKDF root? | **Locked: per-agreement random + persisted.** Avoids a long-lived demo-side root secret. |
| D-14 | Pete + Jill: should they hold ANY personal data, or just be control keys? | **Locked: pure control keys.** Org-level data (display name, country, issuance log, matches log, pending drafts) lives in `:org:global-church` / `:org:jp` vaults — NOT in `:eoa:pete` / `:eoa:jill`. |

### 11a. Agentic Trust decisions (added 2026-06-02)

| # | Decision | Resolution |
|---|---|---|
| **D-15** | Org→JP Association required before matching, or optional quality signal? | **Locked: required-before-match for Org personas; optional for individual personas** (existing UX unchanged). |
| **D-16** | Credential issuance: in-process function call or sealed-mailbox facet? | **Locked: in-process for W1.** Sealed-mailbox = **L-11**. |
| **D-17** | Full VC + signatures in Org vault — risk accepted for the demo? | **Locked: yes**, with a UI warning in Adopter/Facilitator Org mode. Real attacks remediated via credential revocation flow (§4b). |
| **D-18** | Can the issuer (JP) unilaterally revoke a public assertion? | **Locked: NO (reversed 2026-06-02).** Only the holder can self-revoke their own on-chain assertion. Issuer controls credential status off-chain (revocation-list update); verifier MUST reconcile both. Asymmetry surfaced explicitly in §3a.4. |
| **D-26** | Can either party unilaterally take down a joint agreement assertion? | **Locked: yes.** Either party's self-revocation drops the row. Re-assertion later requires re-obtaining bilateral consent per D-22. |

### 11b. Intent Spine decisions (added 2026-06-02)

Ported from smart-agent (branch `003-intent-marketplace-proposal`); see §3b for the digest.

| # | Decision | Resolution |
|---|---|---|
| **D-27** | Which marketplace lanes does demo-jp W1 cover? | **Locked: Direct Lane only** (smart-agent spec 001). Pool Lane = L-13, Proposal Lane = L-14. |
| **D-28** | Intent + Match layers on-chain in W1? | **Locked: NO — vault-only.** Only the Commitment-and-onward path crosses to on-chain via the existing registries. On-chain match/intent registries = L-15. |
| **D-29** | JP's role at Commitment time: signer or witness? | **Locked: passive witness only.** JP attaches a `MatchAttestation` linking the Commitment to its originating MatchInitiation. Parties' bilateral signatures bind the Commitment; JP is not a party. |
| **D-30** | Intent state-machine values? | **Locked: smart-agent's catalog verbatim** (`drafted`, `expressed`, `acknowledged`, `in-progress`, `fulfilled`, `abandoned`, `withdrawn`). |
| **D-31** | Intent TTLs by visibility tier? | **Locked: smart-agent defaults** (public 90d, public-coarse 60d, private-commitment 30d, off-chain-only manual-only). |
| **D-32** | Visibility cascade rule + SHACL invariants? | **Locked: ported wholesale from smart-agent** (`/docs/ontology/tbox/shacl/visibility.ttl`). Shapes ship into our `ontology.ShapeRegistry`. |
| **D-33** | Does JP hold any blanket Tier-2/Tier-3 grants at onboarding? | **Locked: NO.** Every grant is issued at the specific action that needs it (intent express → `jp:broker_intent` per intent; etc.). Smart-agent's "broker has no broad delegation" pattern. |
| **D-34** | Per-grant revocation? | **Locked: yes.** Revoking one scope (e.g. `jp:read_intent_full`) does NOT revoke siblings (`jp:broker_intent`). UI surfaces each grant separately. |
| **D-35** | Delegation issuance bundled with intent express or a separate workflow? | **Locked: bundled.** User sees a single "Express intent + grant JP brokerage" step. |
| **D-36** | Demo-jp dashboard surfaces "Active grants" + one-click revoke? | **Locked: yes.** Mirrors smart-agent's revocation-list UX. |
| **D-19** | Can a single Org SA hold both Facilitator AND Adopter credentials at once? | **Locked: no for W1.** One credential type per Org SA; hybrids deploy two Org SAs. |
| **D-20** | `validUntil` semantics: hard expiry or soft? | **Locked: hard expiry.** Holder responsible for re-requesting before T. |
| **D-21** | JP VC signature: EIP-712 typed-data or `eth_sign` wrap? | **Locked: EIP-712.** Matches the rest of the stack. |
| **D-22** | Agreement public assertion: who consents? | **Locked (revised 2026-06-02): BILATERAL.** Both parties must consent — pre-authorized at creation or fresh delegation at assertion time. There is no unilateral self-reveal. On-chain row names BOTH parties. |
| **D-23** | Fresh-consent mechanism: use the existing `delegation` primitive? | **Locked: yes.** Reuse `DelegationManager` + `CalldataHashEnforcer` + `TimestampEnforcer` + target/method enforcers. Delegations are authorization predicates here, not cross-account execution. |
| **D-24** | (Was: can a party reveal their own side under strictly-confidential?) | **Obsolete.** Bilateral rule (D-22) supersedes — no unilateral path exists. |
| **D-25** | Third-party assertions (asserter ∉ parties)? | **Locked: out of scope for W1**; deferred to **L-12**. When added, will require both parties' fresh delegations. |

### 11c. Wave decisions added 2026-06-02 (15-layer spine + privacy-SSI substrate)

After [ADR-0024 (intent coordination substrate)](../../../docs/architecture/decisions/0024-intent-coordination-substrate.md) and [the privacy + SSI architecture doc](../../../docs/architecture/privacy-and-self-sovereign-identity.md). These decisions extend D-1..D-36 with the 15-layer spine awareness + the privacy posture.

| ID | Question | Decision |
|---|---|---|
| **D-37** | Single on-chain row per agreement (commitment-only) vs. multi-row decomposition (ExchangeAgreement/FulfillmentCommitment/ClaimRight)? | **Locked: single row per agreement (W1).** Smart-agent's three-class split is ontology-correct but excessive for W1. The ontology preserves the distinction for future-proofing; the contract collapses it to one row. Per spec 241 §3. |
| **D-38** | `ConstraintSet` + `AssumptionSet` as first-class typed structures, or freeform `payload`? | **Locked: first-class typed structures.** Per [ADR-0024 Decision 1](../../../docs/architecture/decisions/0024-intent-coordination-substrate.md) (Layer 3 first-class) + spec 239 update. Cheap to add now; expensive to retrofit. |
| **D-39** | LLM-inferred vs. user-asserted vs. policy-imposed constraints — distinguished? | **Locked: yes.** Every constraint carries `source ∈ { 'user-asserted', 'llm-inferred', 'policy-imposed' }`. Inferred values can be redacted before publication. Per [privacy doc](../../../docs/architecture/privacy-and-self-sovereign-identity.md) D-43. |
| **D-40** | Validation required before TrustUpdate (no reputation-from-thin-air)? | **Locked: yes — hard substrate invariant.** Every `TrustUpdate` cites at least one `ValidationCredential` UID; substrate refuses untraceable reputation. Per [coordination-substrate.md](../../../docs/architecture/coordination-substrate.md) §4 Layer 15. |
| **D-41** | Progressive commitment lifecycle (drafted → clarified → expressed → acknowledged → proposed → accepted → committed → in_progress → fulfilled → validated → archived)? | **Locked: yes.** Each stage produces typed artifacts; agent overreach is bounded by the stage boundaries. Per [spec 244](../../../specs/244-fulfillment.md) §4.2. |
| **D-42** | Per-field DisclosurePolicy on credentials/intents (not per-credential blanket)? | **Locked: yes.** Each field has its own visibility tier. `verifiable-credentials` envelope + `intent-marketplace` constraint set both support field-level policies. Per [privacy doc](../../../docs/architecture/privacy-and-self-sovereign-identity.md) D-42. |
| **D-43** | Track constraint `source` (user/LLM/policy) for audit + redaction? | **Locked: yes.** Same as D-39; restated explicitly for the IA decisions list. Per [privacy doc](../../../docs/architecture/privacy-and-self-sovereign-identity.md) D-43. |
| **D-44** | Proof-type plurality within the W3C VC envelope (Eip712Signature2026 primary; BBS+, SD-JWT add-ons; AnonCreds W3+)? | **Locked: yes.** Per [privacy doc](../../../docs/architecture/privacy-and-self-sovereign-identity.md) D-44 + PD-28. Primary in W1; selective-disclosure proof types in W2. |
| **D-45** | Stealth-address support (ERC-5564) for high-privacy agreements + payments? | **Locked: reserved interface in W1; implemented W2.** Per [privacy doc](../../../docs/architecture/privacy-and-self-sovereign-identity.md) D-45 + PD-29. |
| **D-46** | Vault data residency separation (PV / OV / JV / PR with three hard rules)? | **Locked: yes.** Personal data NEVER in OV (D-46.1); JV writes are bilateral-signed (D-46.2); PR writes are explicit opt-in (D-46.3). Per [privacy doc](../../../docs/architecture/privacy-and-self-sovereign-identity.md) §3. |
| **D-47** | Two reputation modes (aggregate-anonymous default; citable-linkable opt-in per credential class)? | **Locked: yes.** Sybil resistance is credential-cost, not KYC. Per [privacy doc](../../../docs/architecture/privacy-and-self-sovereign-identity.md) D-47. |
| **D-48** | Aggregation queries treated as privacy attacks (rate limits + k-anonymity ≥ 5)? | **Locked: yes.** Per [privacy doc](../../../docs/architecture/privacy-and-self-sovereign-identity.md) D-48 + indexer admission policy. |

---

## 12. Deferred to later waves

| # | Item | When |
|---|---|---|
| L-1 | Recovery for Pete/Jill (ERC-7710 delegation from durable custody) | W4 or post-demo |
| L-2 | `issuerGroupRoot` (Option B from prior conversation) | Wave with ZK |
| L-3 | Per-issuer relayer rotation; epoch buckets in storage; padded payloads | Privacy hardening wave |
| L-4 | ZK proofs: agreement-validity, party-membership (anon + role), status-update with nullifier | After W1 lands |
| L-5 | BBS+ selective-disclosure presentations | After ZK lands |
| L-6 | HCS-N mirror of the commitment registry | After hcs-standards-advisor pass |
| L-7 | Multi-device persona portability for Pete/Jill | Post-demo |
| L-8 | Move JP to "attestation-only" (E2E encrypt drafts so JP holds only ciphertext) or remove JP from draft path entirely | Privacy hardening wave |
| L-9 | JP-issued OIDC token for matched-adopter / matched-facilitator cross-app session | Post-W1 |
| L-10 | Additional credential types (Endorsement, Reputation, etc.) | Post-W1 |
| L-11 | Sealed-mailbox facet for credential delivery between Org SAs | Post-W1 |
| L-12 | Third-party joint-agreement assertions (asserter ∉ parties) | Post-W1 |
| L-13 | Pool Lane (smart-agent spec 002 — donor pledges to a fund/pool) | Post-W1 |
| L-14 | Proposal Lane (smart-agent spec 003 — grant proposals against an RFP/Round) | Post-W1 |
| L-15 | On-chain Match/Intent registries (smart-agent `MatchInitiationRegistry`) | Post-W1; W1 keeps intents + matches vault-only |
| L-16 | `PrivateZK` visibility tier (ZK proof of intent existence without IRI reveal) | After ZK overlay (L-4) |
| L-17 | AnonCreds / selective-disclosure credentialRequired predicate for sensitive intents | Post-W1 |
| L-18 | Plan + Case layer (`FulfillmentPlan`, `FulfillmentCase`, `WorkItem`) downstream of Commitment | Post-W1 |
| L-19 | `OrchestrationPlan` composite intents (parent-with-sub-intents decomposition + sub-intent fulfillment aggregation) | Post-W1 |

---

## 13. Where this overlaps with what's already in the repo

| In this doc | Existing code | Status |
|---|---|---|
| Generated EOA + localStorage persistence | `apps/demo-web-pro/src/lib/wallet.ts` does similar for demo-pro seats | **Reuse pattern, not the file** (web-pro uses RainbowKit; demo-jp wants raw stored-key). |
| Mode-0 EOA-custodied Org SA deploy | `apps/demo-web-pro/src/lib/deploy-person.ts` already does this via `/session/direct-deploy` | **Reuse directly** for the deploy POST shape. |
| `register + setPrimary` executeBatch | `apps/demo-sso-next/src/connect-client.ts::buildClaimCallData` | **Reuse the helper**; pass the org SA + name. |
| Per-SA vault scoping | `loadJpFacilitatorRecord(addr)`, `loadJpAdopterRecord(addr)` | **Same pattern**, add `loadGlobalChurchVault()` + `loadJpVault()` (single-instance, no per-addr keying). |
| Local-broker pool scan | The scan in PR #97 (`loadAllLocalJpFacilitatorAddresses()`) | **Same pattern** for issuance log queries. |
| Org name in subregistry | `permissionlessSubregistry.register(label, owner)` | **Reuse**. |
| Bilateral EIP-712 over an agreement | `packages/delegation` typed-data shapes | **Inspiration, not direct reuse** — agreement schema is its own typed-data, not a delegation. |

---

## 14. Privacy posture for W1 (be honest about it)

W1 reduces what's public from "adopter + facilitator + issuer + status" to "commitment + schemaHash + issuer + epoch-bucket status". That's the big win.

What W1 still leaks:

- **Gas-payer correlation**: every registry write comes from one relayer EOA. **Documented as known limitation; L-3 closes.**
- **Issuer activity graph**: Global Church writes every agreement. Anyone watching can count how many it's issued. **L-2 closes (issuerGroupRoot).**
- **Timing**: epoch buckets dampen but don't kill timing correlation, especially if there's a single user per session. **L-3.**
- **No unlinkability between agreements**: each commitment is a fresh blob, but if a party uses the same SA across many agreements, on-chain reads against `agent-naming` reveal "this SA exists". **Mitigation: pairwise SAs per agreement, deferred.**

Be loud about these in the UI when in "Issuer / Pete" mode so demo viewers know what's protected and what isn't.

---

## 15. What's next

D-1..D-5, D-7, D-9..D-14 **locked 2026-06-02**. D-8 **locked-reversed** (JP DOES see drafts). D-6 **deferred** to [packages.md](packages.md). D-15..D-23, D-25, D-26 **locked 2026-06-02** (D-24 obsolete). D-27..D-31 **locked 2026-06-02** (intent spine direct-lane, off-chain in W1, state-machine ported from smart-agent).

The next planning passes, in order:

1. **[packages.md](packages.md)** — closes D-6 and the new packaging questions for the three feature surfaces (Agentic Trust + Intent Spine + Agreement Registry).
2. **spec 241 — Agreement Registry** — the on-chain commitment-registry surface plus the joint-assertion submission path that crosses into AttestationRegistry.
3. **spec 242 — Verifiable Credentials + Attestations (Agentic Trust)** — the VC envelope (§9b), the SHACL Description registration via `ontology.ShapeRegistry`, the `AttestationRegistry` contract surface, the delegation-as-permission-predicate validation path, and revocation semantics.
4. **spec 239 — Intent Marketplace (Direct Lane)** — the intent typed-data + SHACL shapes, the broker-pool model, the ranking-basis snapshot semantics, the cross-delegation grants JP uses to read intents, the MatchInitiation → IntentMatch → Commitment hand-off into spec 241. **MUST include a "Reference: smart-agent patterns to port" section per CLAUDE.md hard rule** — see §17 for the catalog.
5. **Implementation plan** — wave-by-wave plan that consumes the locked decisions + the package layout + specs 241/242/239.

These six artifacts (this doc + packages.md + specs 241 + 238 + 239 + the implementation plan) are what the demo-jp upgrade lands behind.

---

## 16. Data visibility tiers (ported from smart-agent)

Smart-agent ships a **five-tier visibility model** with strict cascade rules; each artifact derives its visibility from the strictest source. SHACL invariants enforce the consequences. Ported wholesale.

### 16.1 The five tiers

| Tier | URI | What's on-chain | What's in vault | Who can read |
|---|---|---|---|---|
| **Public** | `sageo:VisPublic` | Full artifact IRI + all fields anchored on-chain (and mirrored to JP's broker pool if intent) | Same | Anyone |
| **PublicCoarse** | `sageo:VisPublicCoarse` | IRI + aggregate-only fields (sensitive fields omitted) | Full body in owner's vault | Anyone for the coarse view; full requires delegation |
| **PrivateCommitment** | `sageo:VisPrivateCommitment` | IRI NOT on-chain | Full body in owner's vault | Only via cross-delegation grant (Tier-3, §17) |
| **PrivateZK** | `sageo:VisPrivateZk` | ZK proof of existence (W1: **reserved, not implemented** — L-16) | Full body in owner's vault | ZK-verifier-with-proof; no IRI ever exposed |
| **OffchainOnly** | `sageo:VisOffchainOnly` | Never touches chain. Not even notifications. | Full body in owner's vault | Owner only; manual out-of-band sharing |

### 16.2 The cascade rule (CRITICAL invariant)

> A derived artifact (MatchInitiation, IntentMatch, Commitment, AgreementCredential) inherits the **STRICTEST** visibility of its source artifacts.

```
public          + public         → public                   (anchors on-chain where applicable)
public          + private        → private-commitment       (no on-chain anchor; vault only)
private         + anything       → private-commitment       (no on-chain anchor)
strictly-confidential + anything → off-chain-only           (terminal; D-22 maps to this)
```

**D-32 locked: smart-agent's visibility cascade is the source of truth.** SHACL shapes enforce the consequences (see smart-agent `/docs/ontology/tbox/shacl/visibility.ttl`); we port them into our `ontology.ShapeRegistry` at the same time as the Description shapes (one shape group per spec).

### 16.3 What this means per artifact

| Artifact class | Where its visibility tier comes from | W1 default |
|---|---|---|
| Intent | Set by expresser at express time | `public-coarse` (visible to JP + matched parties; aggregate-only to public discovery) |
| MatchInitiation | Strictest of its two source intents | derived |
| IntentMatch | Same source intents | derived |
| Commitment | Strictest of the matched parties' agreement-time public-disclosure stances (§9 D-22) | derived; mapped to "private-commitment" unless both `pre-authorized` |
| Agreement Credential | Same as Commitment; vault-held in all cases | `private-commitment` (vault only) |
| Joint Agreement Assertion | Public by definition (the whole point) | `public` |
| JP Association Credential | Vault-held; not public on its own | `private-commitment` |
| Association Assertion | Public | `public` |

### 16.4 Public-coarse projections (what JP shows in discovery)

Smart-agent's three-projection model (Full / Coarse / Summary / Null) ported. JP serves DIFFERENT projections of the same intent based on who's asking:

| Projection | To whom | Fields included | Fields omitted |
|---|---|---|---|
| Full | the expresser themselves | all | none |
| Coarse | credentialed reader holding a Tier-3 grant from the expresser | direction, object, topic, geo-bucket, capacity-bucket, expectedOutcome (public-only metrics) | sensitive payload, raw counts, donor identity |
| Summary | JP's match-engine (server-side only, never exposed) | direction, object, geoRoot, credentialRequired, payload constraints | detail, expectedOutcome internals |
| Null | non-credentialed reader OR `off-chain-only` intent | ∅ | everything (intent does not appear in search) |

JP's broker-pool entry (§5.9) stores the projection appropriate to JP's authorization under the cross-delegation from the expresser — NOT the full body unless the delegation grants it.

---

## 17. Access-grant model (delegations to JP)

The hard question from your ask: **what can JP see / do in the demo-jp app, and how is each access mediated?**

Smart-agent's answer (ported): JP holds **no broad delegation**. Every access is one of three tiers, each scoped, each revocable.

### 17.1 Three tiers (port from smart-agent `/docs/information-architecture/15-delegation-design-architecture.md`)

| Tier | Caller path | What's authorized | Caveats |
|---|---|---|---|
| **Tier 1** — User session | Connected user's session in the JP web app → user's own SA → JP SA (for actions on the user's behalf) | Whatever the user can do themselves: express an intent, declare adoption, etc. | User's userOp signature; standard session controls |
| **Tier 2** — System delegation | Artifact-creator's SA → counterparty's SA, for bookkeeping side-effects | Time-bounded, narrow scopes like `intent:bump_ack_count` (increment the expresser's `liveAcknowledgementCount` when a MatchInitiation is created against their intent) | No fresh user signature; time-windowed; method-pinned via `AllowedMethodsEnforcer` |
| **Tier 3** — Cross delegation | Specific reader (JP, a steward, a matched counterparty) → data owner's SA | Per-instance grants: `jp:read_intent`, `jp:broker_intent`, `jp:read_match_inbox`, etc. | Issued fresh by the data owner; pinned to a specific artifact id via `CalldataHashEnforcer`; time-windowed |

**D-33 locked: JP holds NO Tier-2/Tier-3 grants by default at onboarding.** Each grant is issued at the specific action that needs it (intent express → fresh `jp:broker_intent` for that intent only; agreement match accept → fresh delegation per §10b.2 D-23 if needed). JP's "broker access" is the SUM of these per-action grants, not a blanket pre-authorization. Smart-agent's broker model exactly.

### 17.2 The scope catalog for demo-jp

Subset of smart-agent's `marketplace-scopes.ts` (39 scopes total in smart-agent) relevant to W1's direct lane:

| Scope | Tier | Issued by | Authorizes |
|---|---|---|---|
| `intent:express` | 1 | (no delegation; just user's own session) | Create an intent in own vault |
| `jp:broker_intent` | 3 | Expresser → JP at intent-express time | JP can pull this intent into its broker pool; coarse projection by default |
| `intent:bump_ack_count` | 2 | MatchInitiation creator (JP) → expresser, time-bounded | Increment `liveAcknowledgementCount` without expresser signing each time |
| `match_initiation:create` | 1 | (no delegation; JP's own session as broker) | JP creates MatchInitiation rows in its own vault |
| `match_initiation:notify` | 3 | Expresser → JP at intent-express time | JP pushes a notification into the expresser's `match-inbox` vault key |
| `match_initiation:accept` | 1 | (no delegation; party's own session) | Party accepts a proposed MatchInitiation |
| `intent_match:create` | 1 | (no delegation; either party's session triggers when both accepted) | Mint the durable IntentMatch row in JP's vault |
| `commitment:sign` | 1 | (no delegation; party's own session) | Party signs the Commitment |
| `match_attestation:witness` | 2 | Parties → JP at IntentMatch creation, time-bounded | JP records the passive MatchAttestation per D-29 |
| `agreement:issue` | 1 | (no delegation; Global Church / Pete's own session) | GC issues the AgreementCredential per §4c |
| `jp:read_org_profile` | 3 | Org → JP at onboarding (§4a) | JP can read the Org's basic profile facets for matching purposes |
| `jp:read_intent_full` | 3 | Expresser → JP, opt-in, per-intent | JP can see the full intent body, not just the coarse projection |

Each row maps to a single named delegation type (typed-data + caveat set), encoded in `@agenticprimitives/intent-marketplace` (W1) or in the existing `delegation` package depending on PD-16 below.

### 17.3 What the connected user sees vs. what JP sees vs. what's public

| Question | Answer |
|---|---|
| **"What can I see when I'm signed in?"** | Everything in YOUR vault for the personas you control (your own SA's intents, matches, commitments, agreements; the org SAs you custody). You also see public-tier artifacts from other parties (discovery search, public assertions, public registry rows). |
| **"What can JP see about ME?"** | Only what you've explicitly granted via a Tier-3 cross-delegation. The JP dashboard shows you a list of active grants you've issued (you can revoke any at any time). For `public` and `public-coarse` intents, JP gets the coarse projection automatically (you implicitly authorize it by setting that visibility tier). For `private-commitment` or `off-chain-only` intents, JP sees nothing unless you've issued a `jp:read_intent_full` grant. |
| **"What's publicly visible about me?"** | (a) Any intent you marked `public`. (b) Any Trust Assertion you've made (Association + Joint Agreement). (c) Your Org SA's name registration (`<your-org>.impact`). (d) Whatever your `agent-profile` exposes. Nothing else. |
| **"What does JP have access to that I don't see?"** | JP's broker pool is its private workspace. JP's view of YOUR intent is constrained by the delegation you issued; JP's view of OTHER parties' intents is constrained by THEIR delegations. JP can compose matches across its broker pool without revealing the candidate's identity to you before you've accepted the MatchInitiation. **You see the candidate's projection only after JP surfaces the proposal to you AND the candidate has consented (per the matched-pair coarse projection rule).** |
| **"Can JP forward my private info to anyone?"** | No. JP's grant is `jp:read_intent_full` (or coarser); there is no `jp:forward_intent` scope in W1. Smart-agent's broker model holds the line that the broker is a *recipient*, not a *distributor*. |
| **"What if I revoke my delegation to JP?"** | JP loses read access to that artifact. JP's broker pool entry is dropped at the next refresh (the demo enforces this on JP-vault read; production uses a "revocation list" delegation primitive — `delegation` already supports this). MatchInitiations JP had already created against the intent stay in JP's vault for the audit trail, but JP cannot use them to surface fresh matches. |

**D-34 locked: revocation is per-grant.** Revoking `jp:read_intent_full` does NOT revoke `jp:broker_intent` (the coarse-view grant) — those are separate scopes, separately revocable. UI must show this clearly.

### 17.4 Delegation issuance UX (demo-jp)

At onboarding (§4a), the Org sees a single "Grant JP brokerage access" page that issues:

1. `jp:read_org_profile` (Tier-3, long-lived, can be revoked)
2. A pre-positioned `jp:read_intent_full` (Tier-3 template; instantiated each time the Org expresses a non-public intent; user reviews + signs per intent)

At intent-express time, the user reviews the delegations being issued (one or both of the above, scoped to that specific intent via `CalldataHashEnforcer`), signs once per delegation, and the intent + its delegation set ship together to JP.

**D-35 locked: delegation issuance is *bundled with* intent express, not a separate workflow.** The user sees a single "Express intent + grant JP brokerage" step.

**D-36 locked: JP's dashboard surfaces a "Active grants from this Org" widget for the connected user**, with a one-click revoke per grant. Mirrors smart-agent's revocation-list UX.

---
