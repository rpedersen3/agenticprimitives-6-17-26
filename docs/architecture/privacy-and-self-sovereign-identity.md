# Privacy, Anonymity, and Self-Sovereign Identity

> **Thesis.** Coordination without strong privacy collapses into a surveillance pipe. Self-sovereign identity without coordination collapses into a wallet of credentials no one knows what to do with. The Agentic Primitives substrate is the place where both meet on equal footing: **every layer of the 15-layer spine has explicit privacy properties, the on-chain/vault boundary is a load-bearing architectural decision, and the substrate gives holders control over disclosure at field-level granularity while preserving the credential composability that makes verticals interoperable.**
>
> This document is the privacy + SSI architecture-of-record. It is the companion to [coordination-substrate.md](./coordination-substrate.md) and pins the decisions the substrate makes about identity granularity, credential proof types, vault residency, on-chain boundaries, and disclosure policy.

**Status:** Foundational architecture document (2026-06-02).
**Companion to:** [Coordination Substrate](./coordination-substrate.md).
**Related ADRs:** [0010](./decisions/0010-smart-agent-canonical-identifier.md) (SA address is identity), [0011](./decisions/0011-credential-recovery-and-re-association.md) (credentials rotate, identity persists), [0017](./decisions/0017-oidc-social-is-a-login-facet-not-custody.md) (social login is a facet), [0019](./decisions/0019-relying-site-authority-is-a-scoped-delegation.md) (relying-site authority is a delegation), [0021](./decisions/0021-generic-packages-vs-white-label-apps.md) (packages are generic), [0023](./decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) (attestation registry).

---

## 1. The identity granularity spectrum

Most "SSI" discussion conflates four very different identity modes. The substrate names them explicitly because different layers need different modes:

| Mode | Definition | Linkability | Use cases in the substrate |
|---|---|---|---|
| **Anonymous** | No persistent identifier; each interaction is unlinkable to any other | None across interactions | One-off public-coarse intent broadcasts; aggregate analytics; reading public registries |
| **Pseudonymous (per-context)** | Persistent identifier within one context; no cross-context linkability | Within context only | Solver identities on a marketplace; per-org membership profiles; per-relying-site facets |
| **Pseudonymous (persistent)** | Same identifier across all interactions, not tied to real-world identity | Full across interactions | Default for SA-as-canonical-identifier when no identity facet is attached |
| **Identified** | Real-world identity is verifiable | Full + real-world bound | KYC'd participants in regulated flows; org governance signers; validators with reputation at stake |

**Key architectural commitment.** The SA address is **persistent pseudonymous by default**. Real-world identity binds optionally via credential facets ([ADR-0020](./decisions/0020-faceted-agent-identity-doctrine.md)). Per-context pseudonymity is achievable via stealth-address sub-accounts. True anonymity is achievable via ZK-proof intent expression (deferred to W2+ but reserved in the substrate).

**The trap to avoid.** "Web3 identity" projects often default to persistent identification (KYC) and bolt on privacy later. The substrate defaults the other direction: **pseudonymous-by-default, identified-by-explicit-credential**, with stealth addresses for the cases that need stronger unlinkability.

## 2. Verifiable Credentials, AnonCreds, and proof-type plurality

The substrate ships W3C VCs with `Eip712Signature2026` as the primary credential proof. That's a deliberate choice with deliberate trade-offs.

### What W3C VCs + Eip712Signature2026 give us

- **EVM-native verification.** Verifier reads the VC, calls `isValidSignatureNow` on the issuer's SA per ERC-1271, gets `bool`. No bridge contracts, no custom verifiers per credential type.
- **Industry alignment.** The vast majority of VC infrastructure (DIF, W3C, Polygon ID, Veramo, EBSI) is W3C-shaped.
- **Tooling.** SD-JWT, BBS+, and DataIntegrityProof are all proof types within the W3C VC envelope — additive, not replacements.
- **AgenticConnect alignment.** The SSO substrate ([spec 224](../../specs/224-agentic-connect.md)) already issues W3C VC-shaped tokens.

### What W3C VCs + Eip712Signature2026 do NOT give us

- **Unlinkable presentations.** Every presentation of the same credential carries the same issuer signature → trivially linkable across verifiers.
- **Predicate proofs.** "Age ≥ 18" requires revealing the credential. No native ZK predicate support.
- **Selective disclosure.** The full credential is signed as one blob; revealing any field reveals the signature over all fields.

These are the gaps **AnonCreds** + **BBS+** + **SD-JWT** were designed to fill.

### The proof-type spectrum

| Proof type | Linkability | Selective disclosure | Predicate proofs | Tooling maturity | Substrate W1 status |
|---|---|---|---|---|---|
| **Eip712Signature2026** | Linkable | No | No | High (EVM native) | ✅ Primary, all credential types |
| **DataIntegrityProof + BBS+** | Unlinkable | Yes | Limited | Medium (W3C in progress) | Reserved — `verifiable-credentials` add-on (D-44) |
| **SD-JWT** | Pseudonymously linkable | Yes | Limited | Medium-high (IETF draft, growing) | Reserved — `verifiable-credentials` add-on (D-44) |
| **AnonCreds (CL-signatures)** | Unlinkable | Yes | Yes | Medium (Hyperledger Indy) | Future bridge only — interop, not native (D-44) |
| **ZK Identity (Polygon ID / Privado / ZKPassport)** | Unlinkable | Yes | Yes | Growing | App-layer integration, not substrate (D-45) |

### Decision D-44 — Proof-type plurality within the W3C VC envelope

The `@agenticprimitives/verifiable-credentials` package ships **`Eip712Signature2026` as the primary proof type** and reserves the proof-type slot in the VC envelope so add-on proof types (BBS+, SD-JWT) can land in W2+ without breaking the W1 envelope.

**Why this matters for the substrate:**
- Same VC; different proof types per use case. A `JpAssociationCredential` issued for public membership can use `Eip712Signature2026`; the same VC type issued for `NeedSafePlace` matching can use BBS+ for unlinkable presentations.
- The VC envelope + `credentialType` are the stable interface. Proof type is policy.
- Verifiers MAY support multiple proof types or specialize. The substrate publishes proof-type capability per package version.

**Why we don't ship AnonCreds natively in W1:**
- Different signature scheme (CL-signatures) requires Hyperledger Indy-style infrastructure
- Trade-off: stronger ZK unlinkability at the cost of EVM-native verification
- We CAN bridge AnonCreds via off-chain verifier contracts later, but it's a heavier architectural lift
- W1 ships W3C VC + Eip712Signature2026 + reserved slots for BBS+/SD-JWT; W2+ adds them; W3+ considers AnonCreds bridge

## 3. The on-chain ↔ vault boundary

This is the load-bearing architectural decision. Get it wrong and you have either a surveillance pipe (too much on-chain) or an opaque trust silo (too much in vaults).

### The explicit boundary

**ON CHAIN (public, immutable, censorship-resistant, indexable):**

| Category | What goes on chain | Why |
|---|---|---|
| **Identity anchors** | SA addresses (CREATE2-deterministic) | Canonical identifier; persistence across credential rotation |
| **Schema substrate** | SHACL shapes via `ShapeRegistry` (governance-gated) | Verifiers need to know what credential types EXIST |
| **Commitments** | `agreementCommitment` hashes in `AgreementRegistry`; with **epoch-bucket** timestamps | Replay protection; bilateral status anchoring; no body leakage |
| **Attestation rows** | `Attestation{uid, schemaId, credentialType, credentialHash, refUID, ...}` in `AttestationRegistry` | Public verifiability; cross-app credential composability |
| **Delegation registrations** | Optional; default-off (delegations are signed objects, not registered) | Some delegations need public revocability |
| **Payment receipts** | Optional; per payment-rail decision in `payments` | Audit trail; some rails (escrow) require it; others (x402 confidential) don't |
| **Validation registry entries** | ERC-8004-compatible validation records | Anchored audit chain |

**IN VAULTS (sovereign, holder-controlled, off-chain):**

| Category | What lives in vaults | Owner |
|---|---|---|
| **Credential bodies** | The full VC body (issuer signature + claims) | Holder's PV |
| **Agreement bodies** | Full agreement text + terms + parties + intentMatch context | Both parties' JV |
| **Intent payloads** | Beyond what's projected to public-coarse; sensitive constraints | Holder's PV |
| **Trust beliefs** | Holder's own per-other-party trust state | Holder's PV |
| **Personal data of any kind** | Names, addresses, identifiers, medical, financial | Holder's PV ONLY |
| **Communications** | Messages, transcripts, message threads | Participants' PVs/JVs |
| **Work products** | Generated files, drafts, internal artifacts | Producer's PV; finalized → JV via artifact ref |
| **Recovery materials** | Encrypted key shards for trustees | Distributed (trustees + holder) |

**OPTIONAL per visibility tier (the spine's load-bearing privacy lever):**

| Tier | On-chain footprint | Vault footprint |
|---|---|---|
| **Public** | Full intent metadata + payload | Same in vault for the holder's records |
| **PublicCoarse** | Bucketed projection (geo region, role class, topic class) | Full payload in PV |
| **PrivateCommitment** | Commitment hash only | Full payload in PV |
| **PrivateZK** | Commitment + ZK proof of validity | Full payload in PV (W2+) |
| **OffchainOnly** | Nothing | Full payload in PV |

### Decision D-46 — Vault data residency separation

The substrate enforces **four** vault types with **strict residency rules**:

**Person Vault (PV)** — exclusively the person SA's:
- Personal credentials issued TO them (the receiver's copy)
- Personal intents (any visibility tier)
- Personal agreement bodies (the holder's copy of joint agreements; the JV copy is shared)
- Personal evidence + artifacts
- Personal trust graph beliefs
- Recovery materials (encrypted)
- Personal device/key material

**Org Vault (OV)** — controlled by org governance ([spec 209](../../specs/209-multi-sig-implementation.md) multi-sig):
- Org membership roster (with role tags; member SAs only, NOT member personal data)
- Records of credentials the org has ISSUED (not the holder's copies; just issuance records)
- Org-level agreements (with other orgs)
- Org operating procedures + governance state
- Org-issued treasury delegations

**Joint Vault (JV)** — shared between two parties for a specific agreement:
- Full agreement body (not just commitment)
- Joint communications about the agreement
- Joint artifacts produced during fulfillment
- Both parties hold copies; updates require bilateral consent

**Public Registry (PR)** — on-chain or distributed:
- SHACL shapes (`ShapeRegistry`)
- Attestation rows (`AttestationRegistry`)
- Agreement commitments (`AgreementRegistry`)
- Public profile facets (on-chain names, ANS handles)
- Public-coarse projections of opt-in intents

**THE HARD RULE (D-46.1):** Personal data NEVER lives in an org vault. An org can hold a credential ABOUT a person (e.g., "Maria is member with role X") but the personal data behind that role lives in Maria's PV. Org-held credentials are ISSUANCE RECORDS (issuer's perspective); holder's copy is in PV.

**THE HARD RULE (D-46.2):** Joint Vault writes require bilateral consent. A unilateral write to JV is a substrate violation — both parties' SAs must sign each JV mutation. This is enforced by the JV implementation (encrypted shared store with bilateral-signed mutations).

**THE HARD RULE (D-46.3):** Public Registry writes are explicit opt-in. Default is OffchainOnly or PrivateCommitment. The substrate never auto-promotes a vault entry to public.

## 4. Privacy properties of each of the 15 layers

This is the layer-by-layer privacy audit. For each layer: what leaks by default, what the substrate protects, what's the holder's lever.

### Layer 1 — Desire

**Leaks:** Nothing (latent, never instantiated).
**Protection:** Boundary explicit — desire is not actionable until expressed as Intent.
**Lever:** N/A.

### Layer 2 — Intent

**Leaks (default Public):** Direction, object, topic, payload, expectedOutcome, expresser SA, timing.
**Leaks (default PublicCoarse):** Direction class, object class, topic class, expresser SA, epoch-bucket timing.
**Leaks (default PrivateCommitment):** Commitment hash + expresser SA + epoch bucket.
**Leaks (OffchainOnly):** Nothing on-chain. Vault entry exists.
**Protection:** Visibility tier choice; epoch-bucket timestamps; SA-as-pseudonym.
**Lever:** Per-intent visibility selection; sensitive-type default-private rule (D-39 sensitive types like `NeedSafePlace`, `NeedTraumaCare` are PrivateCommitment minimum).

**Aggregation attack surface:** Even pseudonymous intents leak frequency, direction-balance, and topic-mix over time. The substrate enforces per-SA rate limits at indexer layer and recommends stealth-address sub-accounts for frequency-sensitive flows.

### Layer 3 — ConstraintSet + AssumptionSet

**Leaks:** Each constraint field has its own leakage profile:
- `geo` — exact lat/lon vs. region bucket vs. country
- `requiredCredential` — credential TYPE may be public; specific credential VALUE is private
- `beneficiary` — specific person SA leaks relationship; "self" or "personal-self" doesn't
- `budget` — exact amount vs. range bucket vs. opaque
- `counterpartyPolicy` — may reveal preferences (e.g., "verified-faith-org-only")

**Protection:** **Field-level DisclosurePolicy** (D-42 new). Each constraint field gets its own tier.
**Lever:** Per-field tier selection; LLM-inferred fields tagged with provenance (D-43 new).

### Layer 4 — Resolution

**Leaks:** Inferred constraints (model may infer based on user history); normalized canonical form.
**Protection:** User reviews inferred constraints with provenance (USER-ASSERTED / LLM-INFERRED / POLICY-IMPOSED tags); inferred values can be redacted before publication.
**Lever:** Inference model runs in user's session, not server-side; user approves before resolution is committed.

### Layer 5 — Proposal / Order

**Leaks:** Solver identity; execution path; payment terms.
**Protection:** Solvers can be pseudonymous (per-context SA); proposal payload can be encrypted to intent owner's pubkey (ECIES); only the intent owner decrypts.
**Lever:** Intent owner publishes a pubkey for encrypted proposals.

### Layer 6 — SolverBid / MatchCandidate

**Leaks:** Same as Proposal + surplus/fit score.
**Protection:** Same as Proposal + score-only-after-acceptance variant (commit-reveal bidding).
**Lever:** Bid encryption policy in the intent definition.

### Layer 7 — IntentMatch

**Leaks:** That two specific intents are compatible. If public, the match itself reveals the pairing.
**Protection:** Private matches: only the two matched parties know; outside observers see neither intent nor match. Public matches: full disclosure.
**Lever:** Match visibility tier (inherits min(intent1.tier, intent2.tier) by default).

### Layer 8 — Agreement / Commitment

**Leaks (current design):** Commitment hash + both party SAs + issuer SA + schema ID + epoch bucket + status.
**What leaks beyond commitment:** The pairing of two parties is on-chain. Repeated agreements between same pair are correlatable. Schema ID reveals agreement TYPE class.
**Protection:** Epoch-bucket timestamps; commitment-only body; schema ID at SHACL-shape granularity (not per-instance discriminating).
**Lever:** Stealth-address sub-accounts for the two parties (D-45 new) for high-privacy agreements — both parties use one-time stealth addresses derived from a shared secret + agreement-specific nonce, so external observers can't link agreements to canonical SAs.

### Layer 9a — PermissionGrant

**Leaks:** Granter → grantee relationship; allowed actions; spending limits; time window.
**Protection:** Delegations are signed objects; default-off-chain (not registered unless revocability requires it).
**Lever:** Off-chain delegation distribution; on-chain revocation only when needed.

### Layer 9b — PaymentMandate

**Leaks:** Payer → payee; amount; asset; reason hash; binding context (intentId/taskId/agreementCommitment).
**Protection:** Payment-rail choice. Public rails (x402 on public chains, sponsored userOps) leak full payment graph. Confidential rails (Aztec-style, Zcash-style, ZK paymasters) leak nothing beyond participation.
**Lever:** Per-payment rail selection. Substrate enforces rail-specific minimum confidentiality per credential class (e.g., NeedSafePlace payments must use confidential rail if value > threshold).

### Layer 10 — FulfillmentCase

**Leaks (on chain):** State machine transitions only IF anchored.
**Leaks (in vaults):** Communications, working state, intermediate artifacts.
**Protection:** State machine anchored as optional commitment per transition. Vault is bilateral JV; access controlled by both parties.
**Lever:** Anchor strategy per case (anchored / commitment-only / vault-only).

### Layer 11 — Task / WorkItem

**Leaks:** Depends on execution environment.
**Protection:** Off-chain confidential compute (TEE) supports tasks that can't reveal payload; ZK proof of correct execution for tasks that need verifiability without payload disclosure.
**Lever:** Per-task execution environment (public / TEE / ZK).

### Layer 12 — Artifact / Evidence

**Leaks:** Artifact hash on chain; body in vault; selective disclosure of artifact FIELDS to specific verifiers.
**Protection:** `EvidenceCredential` carries `selectiveDisclosurePolicy` per field; verifier presents Merkle-tree proof of specific field claims.
**Lever:** Per-field disclosure when presenting evidence to a verifier.

### Layer 13 — Outcome

**Leaks:** Outcome credential pattern over time may reveal success/failure rate.
**Protection:** Outcome credentials can be issued at PublicCoarse (aggregate-only) or PrivateCommitment (hash-only) tiers.
**Lever:** Outcome-class default tier per intent type.

### Layer 14 — Validation

**Leaks:** Validator identity; subject identity; validation result.
**Protection:** Validators can be pseudonymous; subject identity inherits from the artifact being validated (so a validated PrivateCommitment outcome stays private).
**Lever:** Validator-type discriminated visibility (human validators may need real identity for accountability; oracle/TEE validators can be pseudonymous protocol entities).

### Layer 15 — TrustUpdate

**Leaks:** Subject SA; reputation delta; citation chain (intentId, outcomeId, validatorId).
**Protection:** **Two reputation modes** (D-47 new):
- **Aggregate reputation** — anonymous score; not linkable to specific intents/outcomes; defaults
- **Citable reputation** — per-credential, linkable to validated outcomes; explicit holder opt-in

**Lever:** Per-credential-class opt-in to citable mode.

**Sybil resistance.** Both modes anchor to SA address. Sybil resistance is provided by credential-cost barriers (issuance has cost), not by KYC. The substrate does NOT require identification for reputation participation.

## 5. The aggregation attack surface

The hardest privacy problem in any commitment-anchored system: **even commitments leak** through aggregation, timing correlation, and graph analysis.

| Attack | Surface | Substrate mitigation |
|---|---|---|
| **Timing correlation** | "All commitments from SA X within window Y are likely the same agreement" | Epoch-bucket timestamps; bucket size large enough to provide cover |
| **Schema clustering** | "SA X uses schema Y N times → SA X is type Z" | Schema-class governance keeps SHACL shapes broad enough that clustering is uninformative |
| **Bilateral graph reconstruction** | "If SA X and SA Y appear together N times, they're partners" | Stealth-address sub-accounts for high-privacy agreements (D-45) |
| **Aggregation query** | "Count of intents per SA per type" | Per-SA query rate limits at indexer layer; k-anonymity threshold (≥5) for any aggregate query |
| **De-anonymization via credential type** | "Only 3 SAs hold credential X → SA Y holds X → infer who Y is" | Public credential types must have ≥ k holders before any public attestation can be queried |
| **Side-channel via gas paymaster** | "Paymaster sponsorship reveals correlation between SAs" | Per-paymaster privacy budget; paymasters MAY require pseudonymity guarantees |

**Decision D-48 — Aggregation queries are privacy attacks.** Indexer-layer rate limits + k-anonymity threshold for any aggregation. The substrate does NOT expose unrestricted aggregate queries; aggregation is a privileged operation per [spec 226](../../specs/226-hcs-alignment-and-standards.md) (HCS standards) and the indexer admission policy.

## 6. SSI principles the substrate implements

The substrate implements the eight canonical SSI principles, mapped to specific architectural choices:

| Principle | Substrate implementation |
|---|---|
| **(SSI-1) Holder controls disclosure** | Visibility tier per intent; per-field DisclosurePolicy (D-42); proof-type per credential (D-44); bilateral consent for joint disclosure |
| **(SSI-2) Minimal disclosure** | Selective disclosure via SD-JWT/BBS+ (D-44 reserved); evidence per-field; public-coarse projections |
| **(SSI-3) Cryptographic proof** | EIP-712 + ERC-1271 for primary; BBS+/SD-JWT for selective; AnonCreds bridge for unlinkable (D-44) |
| **(SSI-4) Selective disclosure** | Per-field DisclosurePolicy (D-42); SD-JWT proof type (D-44); evidence Merkle proofs |
| **(SSI-5) Predicate proofs** | BBS+ + SD-JWT predicate support (D-44 W2+); explicit credentialType for ZK-friendly predicates |
| **(SSI-6) Revocability** | Holder-only on-chain revocation; issuer off-chain StatusList2021; credential rotation via custody policy ([ADR-0011](./decisions/0011-credential-recovery-and-re-association.md)) |
| **(SSI-7) Recoverability** | SA address persists across credential rotation; trustee quorum recovery; multi-credential self-recovery |
| **(SSI-8) No phone-home verification** | Issuer signature verifiable without contacting issuer (ERC-1271 is self-contained); StatusList2021 fetched from any mirror |

**Beyond the canonical eight, the substrate adds:**

**(SSI-9) Audit trail without surveillance.** The audit graph emits typed events ([ADR-0022](./decisions/0022-authority-must-be-declarative.md)). What's audited is bounded by what's anchored; what's anchored is bounded by holder's visibility-tier choice. An auditor sees the structure, not the content, unless content is explicitly published.

**(SSI-10) Coordination without identification.** The substrate's intent → match → agreement → fulfillment loop works at any of the four identity modes (anonymous through identified). A solver doesn't need to know a person's real identity to fulfill their intent. A validator doesn't need real identity to attest to an outcome.

## 7. Architectural decisions to add to the spine (D-42 .. D-48)

This document proposes the following decisions for inclusion in the IA / packages doc / spec set:

**D-42 — Visibility tier per FIELD, not per credential.** Each field in a credential / intent / constraint set has its own visibility tier. DisclosurePolicy is field-granular.
**Owner:** `verifiable-credentials` (envelope) + `intent-marketplace` (constraints).

**D-43 — LLM-inferred vs. user-asserted vs. policy-imposed constraints distinguished.** Every constraint carries a `source` field. Inferred values can be redacted before publication.
**Owner:** `intent-marketplace` (Resolution layer).

**D-44 — Proof-type plurality within the W3C VC envelope.** Primary: Eip712Signature2026. Reserved slots: BBS+ (DataIntegrityProof), SD-JWT. Future bridge: AnonCreds via off-chain verifier. The credentialType + envelope are stable; proof type is policy.
**Owner:** `verifiable-credentials`.

**D-45 — Stealth-address sub-accounts for high-privacy agreements + payments.** Parties opt-in to stealth-address derivation per agreement; joint vault writes happen between stealth addresses; canonical SAs are not linked on-chain. Aligns with [ERC-5564](https://eips.ethereum.org/EIPS/eip-5564).
**Owner:** `agreements` + `payments`.

**D-46 — Vault data residency separation enforced.** Four vault types (PV / OV / JV / PR) with three hard rules: personal data never in OV; JV writes are bilateral-signed; PR writes are explicit opt-in.
**Owner:** `verifiable-credentials` + cross-cutting (touches all vault clients).

**D-47 — Two reputation modes; citable opt-in.** Aggregate-anonymous is default; citable-linkable is opt-in per credential class. Sybil resistance is credential-cost, not KYC.
**Owner:** `attestations` (TrustUpdate credential type).

**D-48 — Aggregation queries are privacy attacks.** Indexer-layer rate limits + k-anonymity threshold (k ≥ 5). Unrestricted aggregate queries are not part of the substrate's public surface.
**Owner:** indexer admission policy + `identity-directory` package.

## 8. Package decisions to add (PD-28 .. PD-30)

**PD-28 — BBS+ + SD-JWT alternative proof types** ship as a sub-module of `@agenticprimitives/verifiable-credentials`. Primary proof remains Eip712Signature2026; sub-module is opt-in per credential. W1 reserves the slot; W2 implements.
**Spec impact:** spec 242 §4.3 gains a proof-type-plurality subsection.

**PD-29 — Stealth-address support** ships as a sub-module of `@agenticprimitives/agreements` and `@agenticprimitives/payments`. ERC-5564 stealth-address derivation; bilateral derivation from shared secret + agreement nonce.
**Spec impact:** spec 241 gains §5.7 (stealth-address mode); spec 243 gains §6.3 (confidential rails).

**PD-30 — Confidential payment rails** (Aztec-style, Zcash-style, ZK paymasters) supported as an optional payment-rail family in `@agenticprimitives/payments`. W1 ships public rails (x402, wallet, sponsored userOps); confidential rails reserved for W2.
**Spec impact:** spec 243 §6 enumerates rails; §6.4 reserves confidential family.

## 9. Comparison table: substrate against contemporary SSI + privacy stacks

| Capability | Polygon ID / Privado | Veramo + W3C VCs | Hyperledger Indy + AnonCreds | Aztec Network | **Agentic Primitives** |
|---|---|---|---|---|---|
| Holder-controlled disclosure | ✓ | Partial | ✓ | ✓ | ✓ |
| Selective disclosure | ✓ (ZK) | ✓ (SD-JWT) | ✓ (CL-sig) | ✓ (ZK) | ✓ (D-44 add-on) |
| Predicate proofs | ✓ | Limited | ✓ | ✓ | Reserved D-44 |
| Unlinkable presentations | ✓ | Default no | ✓ | ✓ | Reserved D-44 |
| EVM-native verification | ✓ | Via contract | Bridge required | ✓ | ✓ (primary) |
| On-chain registries for cross-app composability | Limited | No | Indy-specific | Limited | ✓ (`AttestationRegistry`) |
| Two-party agreement substrate | No | No | No | Partial | ✓ (`AgreementRegistry`) |
| Intent + matching layer | No | No | No | No | ✓ (`intent-marketplace`) |
| Authority delegation w/ caveats | No | No | No | Limited | ✓ (`delegation` + ERC-7710) |
| Payment binding | No | No | No | ✓ | ✓ (`payments`) |
| Vault residency rules | App-specific | App-specific | App-specific | App-specific | ✓ (D-46) |
| Audit trail | App-specific | Limited | App-specific | ZK-only | ✓ ([ADR-0022](./decisions/0022-authority-must-be-declarative.md)) |
| Cross-credential composition | App-specific | Via Veramo | Indy-specific | No | ✓ (W3C envelope + `credentialType`) |

**Reading this table:** No single contemporary stack provides all the capabilities the substrate provides. Each row is a feature the substrate either ships in W1 or has reserved as a future addition. The "Agentic Primitives" column is the architectural commitment.

## 10. What this architecture is NOT

- **NOT a zero-knowledge platform.** ZK is a tool for specific layers (validation, payments, intent expression at PrivateZK tier). The substrate is privacy-AWARE, not ZK-FIRST.
- **NOT an AnonCreds replacement.** AnonCreds + Indy are complementary; the substrate can bridge them via off-chain verifier contracts in a future wave.
- **NOT a KYC system.** Identification is one of four identity modes, never the default.
- **NOT a stealth-address protocol.** Stealth addresses are a tool (D-45) for specific high-privacy agreements; not the universal pattern.
- **NOT a confidentiality guarantee against side-channel attacks.** Operator metadata, IP addresses, transaction graphs, paymaster correlation, and timing remain side channels. The substrate provides cryptographic privacy at the data layer; operational privacy is an app/operator concern.

## 11. Implementation status

| Capability | W1 status |
|---|---|
| W3C VC envelope + Eip712Signature2026 | ✅ Shipping in `verifiable-credentials` |
| Visibility tiers (5-tier model) | ✅ Shipping in `intent-marketplace` |
| Per-field DisclosurePolicy (D-42) | ✅ Adding to W1 |
| Constraint source provenance (D-43) | ✅ Adding to W1 |
| Vault residency rules (D-46) | ✅ Encoded in package boundaries; enforced by `pnpm check:no-domain-in-packages` and vault-client contracts |
| Holder-only revocation (D-18) | ✅ AR-10 in spec 241; AttestationRegistry has no `issuerRevoke` entrypoint |
| Reputation two-mode (D-47) | ✅ Adding to W1 (`attestations` TrustUpdate credential class) |
| Aggregation query gating (D-48) | ✅ Encoded in indexer admission policy |
| Stealth-address support (D-45 / PD-29) | 🟡 Reserved interface in W1; implemented in W2 |
| BBS+ / SD-JWT proof types (D-44 / PD-28) | 🟡 Reserved slot in W1; implemented in W2 |
| Confidential payment rails (PD-30) | 🟡 Reserved family in W1; implemented in W2 |
| AnonCreds bridge | ⏸ Considered for W3+; not committed |
| ZK-private intent expression (`PrivateZK` tier) | ⏸ Reserved in spine; deferred to W2+ |
| TEE / zkML validator types | ⏸ Reserved in spine; deferred to W2+ |

## 12. Where to read next

- [coordination-substrate.md](./coordination-substrate.md) — the 15-layer model this privacy architecture serves
- [ADR-0010](./decisions/0010-smart-agent-canonical-identifier.md) — SA address as canonical identity
- [ADR-0011](./decisions/0011-credential-recovery-and-re-association.md) — credentials rotate, identity persists
- [ADR-0023](./decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) — attestation registry contract surface
- [spec 221](../../specs/221-credential-recovery.md) — credential recovery process
- [spec 226](../../specs/226-hcs-alignment-and-standards.md) — HCS alignment + standards
- [spec 242](../../specs/242-trust-credentials-and-public-assertions.md) — W3C VC envelope + AttestationRegistry implementation

---

## Closing

Privacy + SSI is not a layer in the 15-layer spine — it is a property of every layer. The substrate makes that property load-bearing: visibility tiers affect what's stored; vault residency rules govern who holds what; proof-type plurality supports selective and unlinkable presentation; stealth addresses give high-privacy agreements true unlinkability; aggregation gating prevents commitment-anchored privacy from collapsing under graph analysis.

The thesis: **strong SSI + strong coordination are compatible if designed together from the start; they are incompatible if SSI is bolted onto a coordination platform after the fact.** The substrate is the first; not the second.

— Architecture-of-record locked 2026-06-02; revisit when proof types or vault residency rules change shape.
