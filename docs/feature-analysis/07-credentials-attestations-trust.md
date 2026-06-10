# 07 — Credentials, attestations, reputation & trust graph

**Focus area:** issuing, verifying, indexing, and consuming credentials/attestations and reputation.
**AP packages in scope:** `verifiable-credentials`, `attestations`, `agreements`, `agent-skills`, `geo-features`, `related-agents`, `contracts` (`AttestationRegistry`, `AgreementRegistry`, skill/geo/ontology registries).
**AP capability today:** on-chain attestation registry (deterministic UID = keccak(subject, issuer, type, hash, ref, salt)); issuer-signed association + joint-agreement attestations bound to chain/contract/parties (SC-1/SC-2 fixed); agreement status-transition registry with nullifier + chain/contract binding; VC packages; skill/geo self-claim registries.
**Known gaps (from contract audits):** `assertJointAgreement` issuer signature still unbound (ATT-1, High); revocation is cosmetic — salt-replay re-anchors a revoked attestation under a fresh UID (ATT-2).

> Agent *reputation/validation registries* (ERC-8004 Reputation + Validation) are covered in [doc 12](12-agent-registry-discovery-intents.md); this doc covers credential/attestation primitives.

> Gap layers: `[Contracts]` Solidity surface · `[SDK]` TS packages/backends · `[UX]` product surface (**deferred**). See [index](index.md#gap-layers-every-gap-is-classified-into-exactly-one).

---

## Category verdict at a glance

| Product | Type | Tags | Verdict |
| --- | --- | --- | --- |
| Ethereum Attestation Service (EAS) | Open protocol | VC DIR AUDIT | **Interop + adopt** (schema/UID/explorer benchmark) |
| Verax | Open protocol | VC DIR | Adopt patterns (registry architecture) |
| Gitcoin Passport | Commercial/protocol | VC POLICY | Integrate (Sybil/reputation signal) |
| Sismo | Protocol | VC PRIVACY | Track (selective disclosure / zk badges) |
| Clique | Commercial | VC REPUTATION | Track (issuer ecosystem) |
| Privado ID / Polygon ID | OSS/commercial | VC AUTH PRIVACY | Integrate option (ZK credential verification) |
| Veramo | OSS | VC DID | **Integrate** (standards library) |
| Trinsic | Commercial | VC AUTH | Track (enterprise issuer/verifier UX) |
| cheqd / Dock | Commercial/protocol | VC DID DIR | Adopt patterns (revocation / trust registry) |
| Microsoft Entra Verified ID | Commercial | VC AUTH | **Integrate** (enterprise verified credentials) |
| World ID | Protocol/commercial | VC AUTH POLICY | Integrate (personhood signal) |
| Proof of Humanity / BrightID | Protocol | VC REPUTATION | Track (anti-Sybil inputs) |

---

## Deep dives — primary overlap products

### Ethereum Attestation Service (EAS) — interop + adopt

- **Identity:** the dominant open attestation primitive; schema registry + attestation registry + explorer + indexing ecosystem across many chains.
- **Feature inventory:** schema registry (typed attestation shapes), on/off-chain attestations, UID-addressed records, revocation + revocation registries, referenced attestations (graphs), delegated attestations, an explorer UX, and indexer/GraphQL tooling.
- **Overlap with AP:** `AttestationRegistry` is conceptually an EAS-shaped registry; AP UID derivation ≈ EAS UID; agreements ≈ referenced/linked attestations.
- **AP lacks:**
  - `[Contracts]` **schema registry** (typed attestation shapes); **robust revocation** — EAS revocation is first-class; AP revocation is cosmetic (salt-replay re-anchors, ATT-2; key on `(issuer, credentialHash)` not salted UID); referenced-attestation graphs; delegated attestations.
  - `[SDK]` indexed query APIs (who attested what about whom); EAS-schema interop layer.
  - `[UX]` (deferred) explorer/browser + issuer directory.
- **EAS lacks:**
  - `[Contracts]` binding attestations to custody/delegation model, agent identity, names/relationships; consent-bound bilateral agreements with on-chain status transitions.
  - `[SDK]` MCP-permission integration (credential → authority → action).
- **Verdict:** interop (be EAS-schema-compatible where possible) + adopt (schema explorer, revocation rigor, indexer). EAS is the benchmark for the entire attestation surface.

### Veramo + Microsoft Entra Verified ID — integrate

- **Veramo:** OSS DID/VC framework — DID methods, VC/VP issuance + verification, plugin architecture. Integrate as the standards-conformant VC engine behind `verifiable-credentials` so AP issues/verifies W3C VCs interoperably.
- **Entra Verified ID:** enterprise verified credentials tied to Microsoft identity (verified employee/member credentials). Integrate as an issuer source so enterprise customers can present Entra-issued credentials that bind to a Smart Agent.
- **AP lacks:**
  - `[SDK]` W3C VC/VP standards conformance breadth; enterprise issuer onboarding; credential schema lifecycle + revocation status (StatusList2021-style).

### Gitcoin Passport / World ID / Proof of Humanity / BrightID — integrate (trust signals)

- **Feature inventory:** Sybil-resistance + proof-of-personhood scores (Passport aggregates stamps; World ID proof-of-personhood; PoH/BrightID social uniqueness).
- **Overlap with AP:** inputs to trust tiers / risk policy in `tool-policy` and custody decisions.
- **AP lacks:**
  - `[SDK]` a trust-scoring input layer — ingesting external personhood/reputation signals into policy decisions and risk metadata.
- **Verdict:** integrate as policy inputs (not custody replacements). Personhood ≠ custody; feed scores into risk tiers.

### Verax / cheqd / Dock / Privado ID / Sismo / Clique / Trinsic — adopt / track

| Product | Lesson for AP | Verdict |
| --- | --- | --- |
| agentic-trust (sibling lab) | Working Veramo integration + relational VCs + ERC-8004 reputation graph — **port, don't rebuild** (FG-VC-4; see doc 12) | Converge + port |
| smart-agent `privacy-creds` (lineage) | zk credential circuits for selective disclosure — prior art for FG-VC-6 (see doc 12) | Port |
| Hashgraph Online HCS-25/HCS-19 | Composite agent trust-score methodology; privacy-compliance consent records (ISO 27560) | Track (see doc 12) |
| Verax | Registry architecture + attestation DX (Linea ecosystem) | Adopt patterns |
| cheqd / Dock | Credential lifecycle + revocation + trust-registry patterns | Adopt patterns |
| Privado ID / Polygon ID | ZK credential verification (prove a claim without revealing it) | Integrate option |
| Sismo | Selective disclosure / zk badges for private eligibility | Track |
| Clique | Off-chain data → attestation issuer ecosystem | Track |
| Trinsic | Enterprise issuer/verifier admin workflows | Track |

---

## Focus-area gap rollup — by layer

### `[Contracts]` gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| Bind ALL issuer/consent/status signatures (close ATT-1: `assertJointAgreement` issuer side) | (internal audit) | FG-SEC-12 | **P0** |
| Real revocation (key on `(issuer, credentialHash)`, not salted UID — close ATT-2) | EAS, cheqd | FG-VC-1 | P1 |
| Attestation schema registry (typed shapes, referenced attestations) | EAS, Verax | FG-VC-2 | P1 |

### `[SDK]` / package gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| Indexed attestation query APIs | EAS, The Graph (10) | FG-VC-3 | P1 |
| W3C VC/VP standards conformance (issue/verify interoperable credentials) | Veramo, Trinsic | FG-VC-4 | P1 |
| EAS-schema interop layer | EAS | FG-VC-7 | P2 |
| Enterprise credential issuer integration | Entra Verified ID | FG-ENT-2 | P2 |
| External trust/personhood signals as policy inputs | Gitcoin Passport, World ID | FG-VC-5 | P2 |
| ZK / selective-disclosure credentials | Privado ID, Sismo | FG-VC-6 | P3 |

### `[UX]` gaps — **deferred (recorded, not current focus)**

| Gap | Evidence |
| --- | --- |
| Attestation explorer/browser + issuer directory | EAS explorer |
| Enterprise issuer/verifier admin workflows | Trinsic |

**Substrate advantages to preserve:** attestations bound to canonical SA identity + names + relationships; consent-bound bilateral agreements with on-chain status transitions (chain/contract/nullifier-bound); credentials that gate MCP permissions and custody tiers — no standalone attestation protocol connects credential → authority → action the way the substrate can.
