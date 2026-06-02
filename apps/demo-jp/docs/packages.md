# demo-jp Packages + Spec Architecture (Planning Draft)

**Status:** draft — D-6 closed; PD-1..PD-8 from prior draft locked. **Agentic Trust feature** added 2026-06-02 — PD-4 reversed; new packages `verifiable-credentials` + `attestations`; new contract `AttestationRegistry`; decisions **PD-9..PD-15**. **Intent Marketplace feature** added 2026-06-02 — new package `@agenticprimitives/intent-marketplace` (Direct Lane only in W1, ported from smart-agent spec 001); decisions **PD-16..PD-21**.
**Companion docs:** [information-architecture.md](information-architecture.md) — the cast, vaults, lifecycle, Agentic Trust model; **spec 239 — Intent Marketplace**, **spec 241 — Agreement Registry**, **spec 242 — Verifiable Credentials + Attestations**, **spec 243 — Payments**, **spec 244 — Fulfillment**; [coordination-substrate.md](../../../docs/architecture/coordination-substrate.md) (15-layer architecture overview); [privacy-and-self-sovereign-identity.md](../../../docs/architecture/privacy-and-self-sovereign-identity.md) (privacy + SSI); [ADR-0023](../../../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) (attestation registry); [ADR-0024](../../../docs/architecture/decisions/0024-intent-coordination-substrate.md) (intent coordination substrate); [ADR-0021](../../../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md); [spec 100](../../../specs/100-package-boundary-doctrine.md); [packages/contracts/CLAUDE.md](../../../packages/contracts/CLAUDE.md).
**What this is:** the package-level breakdown for the demo-jp upgrade — what we **reuse**, what we **add**, where the **vocabulary firewall** between generic and JP-specific code sits, and the **dependency-graph** addition. Now includes the Agentic Trust packages.
**What this is NOT:** the contract surface itself (spec 241 for agreements, spec 242 for trust), the JP-vertical payload schemas (apps/demo-jp/src/lib/), or implementation order.

---

## 0. Package boundary doctrine (recap)

Two rules anchor everything below:

1. **Packages are generic trust building blocks; white-label / vertical / deployment code lives in apps.** ([ADR-0021](../../../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)) → JP-adoption-specific words (`facilitator`, `adopter`, `FPG`, `MOU`, `peopleGroup`, `Joshua Project`) **MUST NOT** appear in any `packages/*` we touch. Caught by `pnpm check:no-domain-in-packages` + `pnpm check:forbidden-terms`.
2. **Package boundaries are one-directional.** ([spec 100](../../../specs/100-package-boundary-doctrine.md)) → any new package slots into the existing graph (`types ← identity-auth ← agent-account ← delegation ← mcp-runtime`, plus the custody-layer fork). No back-edges. Enforced by `pnpm check:dependency-graph`.

These two rules drive most of the packaging decisions below.

---

## 1. Existing packages we reuse

| Package | What we use it for in demo-jp | Notes |
|---|---|---|
| `@agenticprimitives/types` | Shared `Address`, `Hex`, basic types | unchanged |
| `@agenticprimitives/agent-account` | Deploy Global Church + JP SAs; ERC-1271 verify on party signatures | reuse `getAddressForAgentAccount`, `AgentAccountClient`, the EOA-custodian deploy path |
| `@agenticprimitives/account-custody` | Mode-0 EOA-only deploy params for the two Org SAs | reuse `AgentAccountInitParams` shape; no custody-policy install needed (mode 0) |
| `@agenticprimitives/delegation` | Pattern reference for typed-data + ERC-1271 round-tripping; the canonical `hashDelegation` pattern is the template our `hashAgreement` mirrors | **inspiration, not direct dependency** — agreement typed-data has its own EIP-712 domain |
| `@agenticprimitives/agent-naming` | Register `global-church.impact` and `joshua-project.impact` | reuse `buildSubregistryRegisterCall` + `buildSetPrimaryNameCall` (already wired by `apps/demo-sso-next/src/connect-client.ts::buildClaimCallData`) |
| `@agenticprimitives/agent-profile` | Profile facets on Global Church + JP (display name, country, homepage) | optional in W1; required for the "issuer / broker" badges in the matched UI |
| `@agenticprimitives/agent-relationships` | **Deliberately unused for this surface.** The whole point of the commitment registry is that adopter↔facilitator is NOT modeled as a public edge. Relationships stay for the existing person→HAS_GOVERNANCE_OVER→org edge (member's own orgs); agreements live elsewhere. | clarifies the architectural shift in IA §3 |
| `@agenticprimitives/ontology` | Schema registration for the canonical `AgentCollaborationAgreement` shape — published as a SHACL shape via `ShapeRegistry`; the on-chain `schemaHash` is the keccak of that registered shape | locked by D-12 |
| `@agenticprimitives/identity-directory` + `@agenticprimitives/identity-directory-adapters` | Resolve `global-church.impact` and `joshua-project.impact` to SA addresses across resolution paths | reuse without modification |
| `@agenticprimitives/connect` | If we later issue a JP-side OIDC token for cross-app session ("matched-adopter" / "matched-facilitator"), reuse the broker primitives | **L-9** — out of W1 |
| `@agenticprimitives/audit` | Fail-hard audit emission for issuer attestations + registry writes (mirrors the pattern PR #84 locked in mcp-runtime + delegation) | use `composeFailHardSinks` for the issuance + status-update emit sites |
| `@agenticprimitives/key-custody` | EOA storage helpers for Pete + Jill **only if we go shared-package route (PD-3)** | **PD-3 deferred decision** |

---

## 2. New packages proposed

| Package | Generic? | Why new | Lives at | Status |
|---|---|---|---|---|
| `@agenticprimitives/agreements` | **Yes** — encoder/decoder + read client for `AgreementRegistry`; commitment math; EIP-712 typed-data for issuer attestation; nullifier derivation; ABI mirror. Pure substrate, no JP vocabulary. | Any two-party agreement-with-issuer model reuses the same commitment math + nullifier set. Putting it in a package = future apps inherit privacy-preserving agreement infra without forking demo-jp. | `packages/agreements/` | **proposed** — closes D-6 (SDK side). |
| `@agenticprimitives/verifiable-credentials` *(NEW 2026-06-02)* | **Yes** — generic W3C-VC envelope + EIP-712 issuer signature; DOLCE+DnS Situation helpers (Situation/Description/Roles types); per-credential-type schema registration into `ontology.ShapeRegistry`; vault-side load/store helpers; verifier-side validation helpers. No JP vocabulary; the credential subjects are generic `Situation` shapes consumers compose. | The vault-held VC tier of the Agentic Trust feature (IA §3a, Tier 1). Both `JpAssociationCredential` (issued by JP) and `AgreementCredential` (issued by Global Church) are instances of this generic shape. **Reverses PD-4 from the prior draft** (which proposed bundling the VC shape inside `agreements`); the verifiable-credentials surface is broader than agreements and deserves its own package. | `packages/verifiable-credentials/` | **proposed** — closes the credential side of the Agentic Trust feature. |
| `@agenticprimitives/attestations` *(NEW 2026-06-02)* | **Yes** — encoder/decoder + read client for `AttestationRegistry`; assertion typed-data shapes (Association assertion, Joint Agreement assertion); revocation semantics; the **delegation-as-permission-predicate** validation glue against `DelegationManager` for D-23 bilateral consent. No JP vocabulary. | The public on-chain tier of the Agentic Trust feature (IA §3a, Tier 2). The registry is generic over credential type; demo-jp uses it for both Org→JP Association assertions AND joint-agreement assertions. | `packages/attestations/` | **proposed** — closes the on-chain assertion side. |
| `@agenticprimitives/intent-marketplace` *(NEW 2026-06-02)* | **Yes** — intent typed-data + SHACL Description shapes (Intent, MatchInitiation, IntentMatch, Commitment) ported from smart-agent ontology; ranking-basis snapshot helpers (proximity × outcome composite); state-machine encoders; visibility-tier types + cascade rule; the scope catalog (`intent:express`, `jp:broker_intent`, `intent:bump_ack_count`, `match_initiation:create/notify/accept`, etc.); cross-delegation builders for the Tier-3 grants the broker holds. No JP vocabulary (`adopter`, `facilitator`, `FPG` stay in the app). | The marketplace layer upstream of the agreement layer (IA §3b, §4d). Ports smart-agent's load-bearing patterns (Intent ⊂ ufo:Intention, direction property single-class, five-tier visibility cascade, three-tier delegation model, MatchInitiation ≠ IntentMatch, ranking-basis snapshot). Smart-agent's three lanes split into separate packages would be a future carve-out (L-13 Pool, L-14 Proposal); W1 ships only the Direct Lane in one package. | `packages/intent-marketplace/` | **proposed** — closes the intent spine. |
| **No new app-named package** for JP itself | n/a | All JP-specific concepts (facilitators, adopters, FPGs, the matching function, MOU text, vault shapes that name "adopter" / "facilitator") stay in `apps/demo-jp/src/lib/*`. ADR-0021 vocabulary firewall. | `apps/demo-jp/src/lib/` (unchanged) | — |

**Three new packages**, not one. The rest of the demo-jp upgrade lands in `apps/demo-jp/` (JP-vertical code) and `packages/contracts/` (the two new registry contracts — see §3).

**Why three packages and not one umbrella?** Each maps to a distinct on-chain artifact / lifecycle:
- `agreements` ↔ `AgreementRegistry` contract (commitment lifecycle, nullifiers).
- `verifiable-credentials` ↔ no on-chain artifact directly; it's the off-chain VC + ontology-registered schemas.
- `attestations` ↔ `AttestationRegistry` contract (assertion lifecycle, revocation, the delegation-glue for bilateral consent).

Each package can be consumed independently: an app that wants only assertion infra without agreement commitments can import only `attestations` + `verifiable-credentials`; one that wants only commitments without public assertions can import only `agreements`. Umbrella-ing them would force unwanted coupling.

**PD-1** — should `agreements` include the `ScheduleAgreement` / `ApplyAgreement` typed-data shapes for time-windowed issuance? **Recommendation: not in W1.** Keep agreements one-shot issued.

---

## 3. New contracts — two registries

Both live inside `packages/contracts/src/` (consolidated Foundry workspace, per [packages/contracts/CLAUDE.md](../../../packages/contracts/CLAUDE.md)).

### 3.1 `AgreementRegistry`

Lives at **`packages/contracts/src/agreement/AgreementRegistry.sol`**. Surface in spec 241.

```
packages/contracts/src/agreement/
  AgreementRegistry.sol       — commitment-only registry
  IAgreementRegistry.sol      — interface
  AgreementTypes.sol                    — Solidity struct definitions
  errors.sol                            — typed custom errors
packages/contracts/test/agreement/
  AgreementRegistry.t.sol
  AgreementRegistry.invariant.t.sol
packages/contracts/script/agreement/
  DeployAgreement.s.sol
```

### 3.2 `AttestationRegistry` *(NEW 2026-06-02)*

Lives at **`packages/contracts/src/attestation/AttestationRegistry.sol`**. Surface in spec 242.

**Holder-only revocation (D-18 locked).** The contract exposes a self-revoke path for the holder (Association assertions) or for either party (Joint Agreement assertions, per D-26). There is **no issuer-revoke function** — issuer credential-status revocation is off-chain. This keeps the registry small and the access-control rules simple.

```
packages/contracts/src/attestation/
  AttestationRegistry.sol            — public trust signals (Association + Joint Agreement)
                                          - assertAssociation(...)
                                          - assertJointAgreement(...)
                                          - revokeOwnAssociation(...)         (holder-only)
                                          - revokeOwnJointAgreement(...)      (either party — D-26)
                                          (NO issuer-revoke; D-18 locked)
  IAttestationRegistry.sol           — interface
  AssertionTypes.sol                    — Solidity struct definitions for AssociationAssertion + JointAgreementAssertion (IA §10b)
  TrustErrors.sol                       — typed custom errors
packages/contracts/test/trust/
  AttestationRegistry.t.sol          — unit tests (Association + Joint Agreement flows)
  AttestationRegistry.invariant.t.sol — invariants (no double-assert, holder-revoke monotonicity, etc.)
  AttestationRegistry.consent.t.sol  — bilateral-consent enforcement (D-22 / D-23 paths)
  AttestationRegistry.revoke.t.sol   — holder-revoke + party-revoke + issuer-CANNOT-revoke regression
packages/contracts/script/trust/
  DeployTrust.s.sol
```

**Bilateral-consent integration with `DelegationManager` (D-23).** When a party's stance is `requires-fresh-consent`, the assertion includes a packed delegation; `AttestationRegistry.assertJointAgreement` calls into `DelegationManager.verifyAuthorization(...)` (or an equivalent view-only validator) with the supplied delegation + the standard caveat-enforcer set. The delegation is NOT redeemed as a cross-account execution — it's used as a **signed authorization predicate**. This requires either:

- (a) A new `view-only` validation entry-point on `DelegationManager` (clean, but a new exported function), OR
- (b) `AttestationRegistry` re-implements the EIP-712-signature + caveat-enforcer dispatch locally (avoids growing `DelegationManager`'s surface, but duplicates code).

**PD-9 (NEW)** — which integration path? **Recommendation: (a) — a new view-only `verifyAuthorization(...)` entrypoint on `DelegationManager`.** It's a 30-line addition, audits cleanly, and prevents `AttestationRegistry` from drifting out of lockstep with the canonical caveat-enforcer set. Spec 238 will detail the entrypoint.

**PD-2** — should EITHER registry be upgradeable (UUPS)? **Recommendation: NON-upgradeable for both in W1.** Fresh deployment per version; migration is a documented operational step.

**PD-10 (NEW)** — should the two registries share a common base contract (status-commitment storage, nullifier sets, epoch-bucket math) or stay independent? Both have similar shape: a `bytes32 → record` mapping + a nullifier set + epoch-bucket timestamps. Sharing would DRY ~100 lines of Solidity. Argument against: coupling for code-savings is usually wrong at the registry level; each registry's events + access-control rules diverge. **Recommendation: independent for W1.** Revisit if a third registry of the same shape arrives.

**Closes D-6:** the contracts live inside `packages/contracts/src/{agreement,attestation}/`; the SDKs live in `packages/{agreements,attestations,verifiable-credentials}/`.

---

## 4. The SDK — `@agenticprimitives/agreements`

Lives at **`packages/agreements/`**. New package.

Public surface (proposed):

```
packages/agreements/
  src/
    index.ts                            — public exports
    commitments.ts                      — hashAgreement, computeAgreementCommitment, hashPartySet, computeIssuerCommitment
    nullifiers.ts                       — partyActionNullifier, issuerActionNullifier derivation
    typed-data.ts                       — EIP-712 domain + types for IssuerAttestation, StatusUpdateRequest
    abi.ts                              — Solidity ABI mirror (kept in lockstep with the contract via pnpm check:abi-sync)
    client.ts                           — AgreementRegistryClient (readContract-only)
    encoding.ts                         — envelope schema + canonical JSON serialization for hashing
    schema-shape.ts                     — the SHACL shape for AgentCollaborationAgreement (registered into ShapeRegistry)
  test/
    unit/
      commitments.test.ts               — round-trip vectors (cross-stack typehash equality with the contract)
      nullifiers.test.ts                — replay-prevention edge cases
      encoding.test.ts                  — canonical JSON determinism
  capability.manifest.json              — public exports + tier classifications
  CLAUDE.md, AUDIT.md, README.md        — per-package context budget
  package.json
```

**Allowed imports** (one-directional graph slot):

```
@agenticprimitives/types          (base)
@agenticprimitives/agent-account  (Address-typed receiver + ERC-1271 verify helpers; type-only OK)
viem                              (encoding)
```

**Forbidden imports:**

- `@agenticprimitives/delegation` — different domain; reuse only by pattern, not by code path
- `@agenticprimitives/agent-relationships` — the package whose semantics we're deliberately NOT inheriting
- anything JP-specific (would fail `check:no-domain-in-packages` even if we tried)

**Where it slots in the dependency graph:** at the same level as `delegation` — both consume `agent-account` (for SA + ERC-1271), both publish their own typed-data shapes, both have a registry-write surface. Neither depends on the other. So:

```
types ← agent-account ← delegation         ← mcp-runtime
                     ← agreements  ← (no consumer yet; mcp-runtime may consume later for VC presentation flows)
                     ← key-custody → delegation
                     ← tool-policy → mcp-runtime
                     ← custody  (account-custody fork)
```

`agreements` becomes a sibling of `delegation` under `agent-account`. **PD-3** — does `agreements` need a hard dependency on `agent-account`, or just type-only (matching how `delegation` consumes `agent-account` per [packages/delegation/CLAUDE.md](../../../packages/delegation/CLAUDE.md))? **Recommendation: type-only**, so the ERC-1271 verify helper is imported as a type and the runtime call goes through viem against the SA address — matches the `delegation` pattern.

**PD-4 — REVERSED 2026-06-02.** Previously: bundle the VC in `agreements` for W1. The Agentic Trust feature broadens the VC surface beyond agreements (Association credentials, future Endorsement credentials etc.), so the VC envelope + Situation/Description helpers carve out into their own package: `@agenticprimitives/verifiable-credentials` (§4a). `agreements` no longer holds the VC shape; it imports type-only from `verifiable-credentials` for the `AgreementCredential` definition.

---

## 4a. The SDK — `@agenticprimitives/verifiable-credentials` *(NEW 2026-06-02)*

Lives at **`packages/verifiable-credentials/`**. Off-chain Tier-1 of the Agentic Trust feature.

Public surface (proposed):

```
packages/verifiable-credentials/
  src/
    index.ts                            — public exports
    vc-envelope.ts                      — W3C-VC types + canonical JSON serialization + hash helpers
    eip712-signature.ts                 — Eip712Signature2026 proof type; signing + verification helpers
    situation.ts                        — DOLCE+DnS Situation / Description / Roles types + JSON encoding
    schema-registration.ts              — register a Description as a SHACL shape via ontology.ShapeRegistry
    vault-store.ts                      — generic vault-side load/store helpers (per-holder)
    verifier.ts                         — verifier-side validation: signature → recompute hashes → match
    abi.ts                              — type-only re-export of any ABI needed for chain reads
  test/
    unit/
      vc-envelope.test.ts               — canonical JSON determinism, round-trip
      situation.test.ts                 — DOLCE+DnS shape conformance
      verifier.test.ts                  — happy-path + bad-signature + bad-schema + revoked-issuer
  capability.manifest.json
  CLAUDE.md, AUDIT.md, README.md
  package.json
```

Allowed imports:

```
@agenticprimitives/types
@agenticprimitives/agent-account     (type-only — for Address-typed Subject + Issuer)
viem                                 (canonical encoding + crypto)
```

Forbidden:

- `@agenticprimitives/agreements` (lower in graph)
- `@agenticprimitives/attestations`   (sibling; would create a cycle)
- anything JP-specific (caught by `check:no-domain-in-packages` + `check:forbidden-terms`)

**PD-11 (NEW)** — should the `verifiable-credentials` package include BBS+ selective-disclosure presentation helpers in W1? Argument for: aligns with the prior architecture conversation (BBS+ was the recommended VC presentation curve). Argument against: BBS+ introduces BLS12-381 keys, a curve we don't otherwise use; W1 doesn't need selective disclosure (the credential is full-content vault-held; the assertion exposes only the hash). **Recommendation: NOT in W1.** Stub the presentation type for forward compatibility; BBS+ presentation infra lands in L-5 (or carves out to a separate `@agenticprimitives/credentials-bbs` package).

**PD-12 (NEW)** — schema registration: `verifiable-credentials` calls `ontology.ShapeRegistry.register(...)` at credential-type deploy time. The W3C-VC `credentialSchema.id` field uses an opaque `did:shape:<name>:<version>` form whose **registered SHACL bytes** hash to the on-chain `schemaHash`. **Recommendation: lock this convention in W1** so the on-chain schemaHash + off-chain did:shape pointer round-trip correctly.

---

## 4b. The SDK — `@agenticprimitives/attestations` *(NEW 2026-06-02)*

Lives at **`packages/attestations/`**. On-chain Tier-2 of the Agentic Trust feature.

Public surface (proposed):

```
packages/attestations/
  src/
    index.ts                            — public exports
    typed-data.ts                       — EIP-712 domain + types for AssociationAssertion + JointAgreementAssertion
    abi.ts                              — Solidity ABI mirror; check:abi-sync gate
    client.ts                           — TrustAssertionClient (readContract for status + record reads)
    encoders.ts                         — encodeAssociationAssertion, encodeJointAgreementAssertion
    bilateral-consent.ts                — helpers for building / verifying / packing the
                                          delegation-as-permission-predicate (D-23 bilateral consent);
                                          imports the existing `@agenticprimitives/delegation` helpers
    revocation.ts                       — holder-revoke encoder (Association) + either-party-revoke
                                          encoder (Joint Agreement). NO issuer-revoke encoder
                                          (D-18 locked: issuer cannot revoke on-chain assertions).
  test/
    unit/
      typed-data.test.ts                — round-trip + cross-stack typehash equality
      bilateral-consent.test.ts         — pre-authorized vs. requires-fresh-consent path coverage
      revocation.test.ts                — replay-prevention via the nullifier set
  capability.manifest.json
  CLAUDE.md, AUDIT.md, README.md
  package.json
```

Allowed imports:

```
@agenticprimitives/types
@agenticprimitives/agent-account     (type-only)
@agenticprimitives/delegation        (type-only — for the bilateral-consent predicate shape;
                                       runtime calls hit DelegationManager via viem)
@agenticprimitives/verifiable-credentials (type-only — for credential type identifiers + hash)
viem
```

Forbidden:

- `@agenticprimitives/agreements` (sibling — would couple the two on-chain registries via the off-chain SDK; the contracts themselves DO reference each other for the agreement-commitment back-pointer, but that's at the contract layer, not the SDK)
- anything JP-specific

**PD-13 (NEW)** — does `attestations` need a runtime dependency on `@agenticprimitives/delegation`, or just type-only? **Recommendation: type-only.** Bilateral-consent helpers build delegation payloads using viem-side encoding; the delegation contract is reached via the SA's own userOp execution path, not via direct SDK call. Same pattern as the rest of the graph.

**PD-14 (NEW)** — bilateral-consent helpers: live in `attestations` (where they're used) or in `delegation` (where the underlying primitive lives)? **Recommendation: in `attestations` (HERE).** The helper builds the specific caveat set required by trust assertions (`AllowedTargetsEnforcer = AttestationRegistry`, `AllowedMethodsEnforcer = assertJointAgreement.selector`, `CalldataHashEnforcer` pinning the assertion bytes). That's trust-assertion-specific; `delegation` stays generic.

---

## 4c. The SDK — `@agenticprimitives/intent-marketplace` *(NEW 2026-06-02)*

Lives at **`packages/intent-marketplace/`**. Direct-lane intent marketplace (smart-agent spec 001 pattern).

Public surface (proposed):

```
packages/intent-marketplace/
  src/
    index.ts                            — public exports
    intent.ts                           — Intent type (single class, direction property — NO subclasses);
                                          intent state-machine enum + transitions
    match-initiation.ts                 — MatchInitiation type + state machine (proposed/declined/accepted/expired)
    intent-match.ts                     — IntentMatch durable type (post-accept)
    commitment.ts                       — Commitment typed-data + EIP-712 domain; party-bilateral signing
    visibility.ts                       — five-tier visibility enum + cascade computation
                                          (public + private → private-commitment etc.); SHACL invariants
                                          (mirrored from smart-agent /docs/ontology/tbox/shacl/visibility.ttl)
    ranking.ts                          — composite rank: 0.6 * proximityScore + 0.4 * outcomeScore;
                                          basis-snapshot type; Laplace-smoothed outcomeScore
    scopes.ts                           — delegation scope catalog (intent:express, jp:broker_intent,
                                          intent:bump_ack_count, match_initiation:*, match_attestation:witness,
                                          jp:read_intent_full, etc.)
    delegation-templates.ts             — Tier-3 cross-delegation builders for each scope; pinned via
                                          CalldataHashEnforcer to specific artifact ids
    schema-shapes.ts                    — SHACL Description shapes for Intent / MatchInitiation / IntentMatch /
                                          Commitment; registers via ontology.ShapeRegistry at deploy time
    projections.ts                      — Full / Coarse / Summary / Null projection types per visibility tier
    vault-store.ts                      — generic vault-side load/store helpers
  test/
    unit/
      intent.test.ts                    — state-machine transitions; rejected drafted→fulfilled etc.
      ranking.test.ts                   — composite formula against known basis vectors
      visibility.test.ts                — cascade rule conformance
      delegation-templates.test.ts      — Tier-3 caveat set correctness; CalldataHashEnforcer pinning
    integration/
      direct-lane.test.ts               — end-to-end Intent → MatchInitiation → IntentMatch → Commitment
                                          using viem + a mock JP broker
  capability.manifest.json
  CLAUDE.md, AUDIT.md, README.md
  package.json
```

Allowed imports:

```
@agenticprimitives/types
@agenticprimitives/agent-account     (type-only — for Address + ERC-1271 verify helpers)
@agenticprimitives/delegation        (type-only — for Tier-3 cross-delegation builder shapes;
                                       SAME pattern as attestations uses for D-23)
@agenticprimitives/verifiable-credentials (type-only — for the credential type identifiers when an
                                       Intent references a credentialed-issuer constraint)
viem
```

Forbidden:

- `@agenticprimitives/attestations` (sibling; intent layer is upstream of assertion layer)
- `@agenticprimitives/agreements` (sibling; intent flows hand off to it but don't depend on it)
- anything JP-specific (vocabulary firewall)

**Why no on-chain SDK surface for W1?** Per IA D-28, intents + matches are vault-only in W1. There's no `IntentRegistry.sol` or `MatchInitiationRegistry.sol` in our scope. Smart-agent's spec 001 on-chain `MatchInitiationRegistry` is deferred to L-15. So `intent-marketplace` is **off-chain only in W1** — typed-data + helpers + SHACL shapes + vault store; no ABI mirror, no contract client.

**PD-16 (NEW)** — should the marketplace scope catalog (`scopes.ts`) live in `intent-marketplace` (where it's used) or in `delegation` (where the underlying primitive lives)? **Recommendation: in `intent-marketplace` (HERE).** Smart-agent's `marketplace-scopes.ts` lives in its `sdk` package alongside the matching logic. Mirrors PD-14 (bilateral-consent helpers live in `attestations`, not `delegation`). Same logic: scopes are feature-specific; the delegation primitive stays generic.

**PD-17 (NEW)** — should `intent-marketplace` include the Pool Lane (`PoolPledge`, `Pool`, `Fund` types from smart-agent spec 002) and Proposal Lane (`GrantProposal`, `Round` from spec 003)? **Recommendation: NO for W1 (Direct Lane only).** If Pool/Proposal land later (L-13, L-14), they get their own packages (`@agenticprimitives/intent-pool`, `@agenticprimitives/intent-proposal`), each sibling to `intent-marketplace` under `agent-account`. Splitting them keeps `intent-marketplace` focused on the substrate the Direct Lane needs.

**PD-18 (NEW)** — Ranking formula tuning: hard-code `0.6 * proximity + 0.4 * outcome` per smart-agent's defaults, or expose weights as configurable in the SDK? **Recommendation: hard-code for W1.** Smart-agent ships the same fixed weights; tuning is a future-product decision, not a W1 substrate decision.

**PD-19 (NEW)** — SHACL shape ownership for the Intent / MatchInitiation / Commitment Description shapes: generic (in `intent-marketplace`) or JP-specific (in `apps/demo-jp/src/lib/`)? **Recommendation: generic (in `intent-marketplace`).** The shapes for the spine layer are domain-agnostic (Intent, MatchInitiation are generic concepts). JP-specific shapes (`JpFacilitatorAssociationDescription` etc., per PD-15) stay in the app. Mirrors how smart-agent split `intents.ttl` (generic T-Box) from any JP-vertical instance.

**PD-20 (NEW)** — Visibility-tier projections (Full / Coarse / Summary / Null) — does the SDK provide projection builders, or just the projection types? **Recommendation: types + a `projectFor(intent, viewerRole, visibility)` helper.** Apps shouldn't have to re-implement projection logic; smart-agent's bug-class history (early versions leaked sensitive fields into coarse views) argues for a single, audited projection helper.

**PD-21 (NEW)** — Outcomes ledger: lives in the `intent-marketplace` package or app-side? Smart-agent persists outcomes in its DB (`/apps/web/drizzle/0012_intents_bdi.sql`) for ranking-formula history. **Recommendation: app-side for W1.** The outcomes ledger is per-broker (JP keeps its own; another broker would keep its own); the SDK only provides the `OutcomeLedgerEntry` type and a `computeRanking(history, ...)` helper. Brokers maintain their own histories.

---

## 5. App-layer — what stays in `apps/demo-jp/`

JP-vertical-specific code stays here. ADR-0021 vocabulary firewall.

```
apps/demo-jp/src/lib/
  personas.ts                  — NEW. Generate + persist Pete + Jill EOAs; load helpers; "Reset demo" wipe.
  org-personas.ts              — NEW. Compute Global Church + JP SA addresses; lazy-deploy on first use; load org vault.
  agreement-payload.ts         — NEW. JP-specific payload schema (peopleGroupId, adopterType, MOU text, capabilities). Wraps + unwraps the generic envelope from agreement-registry.
  agreement-flow.ts            — NEW. Step-by-step orchestrator for the lifecycle in IA §4: sign-bilateral → hand-to-JP → forward-to-GC → issue → write-registry.
  vault.ts                     — EXISTING. Extend with the new keys (eoa:pete, eoa:jill, org:global-church, org:jp, agreement-vault:…) per IA §5 + §6.
  matches.ts                   — EXISTING. Match function. NO change for W1.
  brand.ts, capacity.ts, mou.ts — EXISTING. Unchanged.

apps/demo-jp/src/dashboards/   — NEW dir (or extend src/App.tsx) for the four persona dashboards
  IssuerDashboard.tsx          — Pete-as-Global-Church view: pending issuance, issuance log
  BrokerDashboard.tsx          — Jill-as-JP view: matches log, pending drafts, issued receipts
  AdopterDashboard.tsx         — EXISTING. Extend with the agreements[] list from §5.4 of IA.
  FacilitatorDashboard.tsx     — EXISTING. Same extension on the mirror side.

apps/demo-jp/functions/        — EXISTING Cloudflare Pages Functions. Likely unchanged for W1 (everything happens client-side + via demo-a2a).
```

---

## 6. The vocabulary firewall (what stays out of packages)

Forbidden in any `packages/*` we touch:

- `facilitator`, `adopter`, `Joshua Project`, `JP` (as an org name, not the abbreviation), `peopleGroup`, `FPG`, `MOU`, `adoption`, `capability` (in the JP coverage sense), any FPG identifier (`fpg-najdi-sa`, etc.).

Allowed in packages:

- `agreement`, `commitment`, `party`, `issuer`, `broker` (if we use it as a generic role term — **PD-5** decides), `attestation`, `revocation`, `nullifier`, `schema`, `registry`.

`pnpm check:no-domain-in-packages` and `pnpm check:forbidden-terms` enforce this. If the IA §9 schema needs JP-specific fields they MUST live in the JP payload (app-layer), not the envelope (package).

**PD-5** — does the package vocabulary include `broker` as a generic role? Argument for: matches the architecture (registry has issuer + parties; brokers are a workflow concept that doesn't appear on-chain in W1). Argument against: the contract has no `broker` field; including the word in the package is purely conceptual. **Recommendation: NO.** Keep `broker` as an app-layer concept (in IA §2 and `apps/demo-jp/src/lib/`). The package surface knows only `issuer` + `parties` because those are the on-chain entities.

---

## 7. Dependency graph addition

Updated graph after this lands:

```
                                    audit
                                     ▲
                                     │
types ─── agent-account ─── delegation ─── mcp-runtime ─── tool-policy
              │     │           │
              │     │           └── (consumed type-only by agreements +
              │     │                attestations for the bilateral-consent
              │     │                predicate shape)
              │     │
              │     ├── verifiable-credentials   ◀── NEW (W3C-VC envelope + DOLCE+DnS)
              │     │       ▲
              │     │       │ (type-only)
              │     │       │
              │     ├── agreements  ◀── NEW (commitment-only registry)
              │     │       ▲
              │     │       │ (type-only — for AgreementCommitment back-pointer)
              │     │       │
              │     ├── attestations    ◀── NEW (public assertion registry +
              │     │                              delegation-as-permission glue)
              │     │
              │     ├── account-custody (custody fork)
              │     │
              │     └── key-custody → delegation, agreements  (signer surface)
              │
              ├── connect-auth
              ├── agent-naming
              ├── agent-profile
              └── agent-relationships
```

The new packages slot in this order:

1. `verifiable-credentials` (no consumers below it),
2. `agreements` (consumes verifiable-credentials type-only for the `AgreementCredential` shape),
3. `intent-marketplace` (consumes verifiable-credentials type-only for credential identifiers when an intent has a `credentialRequired` predicate),
4. `attestations` (consumes verifiable-credentials + agreements for back-pointers, and intent-marketplace type-only for Commitment identifiers).

Updated graph:

```
                                    audit
                                     ▲
                                     │
types ─── agent-account ─── delegation ─── mcp-runtime ─── tool-policy
              │     │           │
              │     │           └── (consumed type-only by agreements,
              │     │                attestations, and intent-marketplace for
              │     │                Tier-3 cross-delegation builders)
              │     │
              │     ├── verifiable-credentials   ◀── NEW
              │     │       ▲
              │     │       │ (type-only)
              │     │       │
              │     ├── agreements  ◀── NEW
              │     │       ▲
              │     │       │ (type-only — for AgreementCommitment back-pointer)
              │     │       │
              │     ├── intent-marketplace        ◀── NEW (Direct Lane only in W1;
              │     │       ▲                       L-13 Pool + L-14 Proposal land later)
              │     │       │ (type-only — for Commitment identifier referenced by JointAgreementAssertion)
              │     │       │
              │     ├── attestations    ◀── NEW
              │     │
              │     ├── account-custody (custody fork)
              │     │
              │     └── key-custody → delegation, agreements  (signer surface)
              │
              ├── connect-auth
              ├── agent-naming
              ├── agent-profile
              └── agent-relationships
```

All four new packages sit at the `delegation` level under `agent-account`. No cycles. Future MCP-side VC presentations (L-5) become a consumer of `verifiable-credentials`; future Pool/Proposal lanes (L-13, L-14) become siblings of `intent-marketplace`.

Enforcement: `pnpm check:dependency-graph` after a routing-index edit. No back-edges, no cycles.

---

## 8. Smart-agent reference check ([CLAUDE.md](../../../CLAUDE.md) hard rule)

CLAUDE.md mandates: *"Always check smart-agent first. Before designing any non-trivial capability look at the analog in `/home/barb/smart-agent`. New specs MUST include a 'Reference: smart-agent patterns to port' section."*

**To do, before locking spec 241:** scan `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`) for:

- Any `commitment-registry`, `agreement`, `attestation-registry` analog
- The intent-marketplace's commitment / nullifier shape (if any) — the name suggests it has one
- Whether smart-agent has a VC issuance flow worth porting

**PD-6** — assigned to spec 241 lead, not this doc. Spec 237 must include the "Reference: smart-agent patterns to port" section before it can land.

---

## 9. Tests + checks added by this work

- `packages/agreements/test/unit/*` (vitest)
- `packages/contracts/test/agreement/*.t.sol` (forge)
- Cross-stack EIP-712 typehash equality (`packages/agreements/test/integration/cross-stack-typehashes.test.ts`) — same pattern as the existing `packages/delegation/test/integration/cross-stack-typehashes.test.ts` locked in PR #85. Wired into `pnpm check:eip712-typehash-equality`.
- `pnpm check:abi-sync` extended to cover the new contracts/SDK pair.
- `pnpm check:api-surface` for the new package's `api-surface.snap`.
- `pnpm check:public-exports` for `capability.manifest.json`.
- All existing `pnpm check:all` / `pnpm check:all-publish` gates apply automatically.

---

## 10. Open packages-decisions

### 10.1 Pre-Agentic-Trust (from prior draft)

| # | Decision | Recommendation |
|---|---|---|
| **PD-1** | Include `ScheduleAgreement` / `ApplyAgreement` typed-data shapes for time-windowed issuance? | Not in W1. |
| **PD-2** | Are the registry contracts (Agreement + Trust) upgradeable (UUPS)? | NON-upgradeable in W1, both. |
| **PD-3** | `agreements` dependency on `agent-account`: hard vs. type-only? | Type-only. |
| **PD-4** | *(REVERSED 2026-06-02)* Where does the VC envelope live? | **Carve out `@agenticprimitives/verifiable-credentials`** as its own package. `agreements` imports type-only from it. See §4a. |
| **PD-5** | Include `broker` as a generic role term in the package vocabulary? | No. Keep `broker` app-layer. |
| **PD-6** | Smart-agent reference: any analog to port from `/home/barb/smart-agent`? | Assigned to spec 241 (for agreements) AND spec 242 (for trust) authors. CLAUDE.md hard rule. |
| **PD-7** | Pete/Jill EOA storage: app-only or share via `key-custody`? | App-only. |
| **PD-8** | Who registers the SHACL shape for `AgentCollaborationAgreementShape` into `ShapeRegistry`? | Owned by `agreements`'s deployment helper. |

### 10.2 Agentic Trust packaging (NEW 2026-06-02)

| # | Decision | Recommendation |
|---|---|---|
| **PD-9** | Bilateral-consent integration with `DelegationManager`: new view-only `verifyAuthorization(...)` entrypoint, or re-implement in `AttestationRegistry`? | **Add a view-only entrypoint to `DelegationManager`.** Keeps caveat-enforcer dispatch in one place. Spec 238 details. |
| **PD-10** | Share a common base contract between `AgreementRegistry` and `AttestationRegistry` (status-storage, nullifier set, epoch math)? | Independent for W1. Revisit if a third registry of the same shape arrives. |
| **PD-11** | Does `verifiable-credentials` include BBS+ selective-disclosure presentations in W1? | NO. Stub the presentation type for forward compatibility; BBS+ lands in L-5 (possibly in a separate `credentials-bbs` package). |
| **PD-12** | `did:shape:<name>:<version>` ↔ on-chain `schemaHash` round-trip convention. | Lock in W1. `verifiable-credentials.schema-registration` enforces it. |
| **PD-13** | `attestations` runtime dependency on `delegation`: hard vs. type-only? | Type-only. Runtime call through viem against the SA's userOp execution path. |
| **PD-14** | Bilateral-consent helpers: live in `attestations` or in `delegation`? | In `attestations`. The caveat set (`AllowedTargets=AttestationRegistry`, `AllowedMethods=assertJointAgreement`, `CalldataHash=…`) is trust-assertion-specific. |
| **PD-15** | Who registers the SHACL shape for `JpFacilitatorAssociationDescription` / `JpAdopterAssociationDescription` into `ShapeRegistry`? Lives generic (`verifiable-credentials`), app (`apps/demo-jp/src/lib/`), or both? | **App-layer.** The Description names are JP-vertical (`JpFacilitatorAssociationDescription`) — they have JP vocabulary in them. The package provides the *registration helper*; the JP-specific shape definitions live in `apps/demo-jp/src/lib/jp-shapes.ts` and call the helper at app-deploy time. |

### 10.3 Intent Spine packaging (NEW 2026-06-02)

| # | Decision | Recommendation |
|---|---|---|
| **PD-16** | Marketplace scope catalog: live in `intent-marketplace` or `delegation`? | In `intent-marketplace`. Scopes are feature-specific; delegation primitive stays generic. Same logic as PD-14. |
| **PD-17** | Pool Lane + Proposal Lane in W1's `intent-marketplace` package? | NO. Direct Lane only. If lanes land later (L-13, L-14), they get separate packages (`@agenticprimitives/intent-pool`, `@agenticprimitives/intent-proposal`). |
| **PD-18** | Ranking formula weights: hard-coded `0.6 * proximity + 0.4 * outcome` or configurable? | Hard-coded for W1. Matches smart-agent's defaults. |
| **PD-19** | SHACL shapes for Intent / MatchInitiation / Commitment: generic (`intent-marketplace`) or app-specific? | Generic. Substrate shapes are domain-agnostic. JP-specific shapes stay in `apps/demo-jp/src/lib/`. |
| **PD-20** | Projection builders (Full / Coarse / Summary / Null) shipped in the SDK? | Yes — types + a `projectFor(intent, viewerRole, visibility)` helper. Smart-agent's bug history argues for a single audited helper rather than each app re-implementing projection logic. |
| **PD-21** | Outcomes ledger: in `intent-marketplace` package or app-side? | App-side. The SDK ships the type + `computeRanking(history, ...)` helper; each broker maintains its own history. |

### 10b. Wave decisions added 2026-06-02 (post-architecture-substrate review)

After deep dives into EAS / Verax patterns ([ADR-0023](../../../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md)), the v2 15-layer coordination model ([ADR-0024](../../../docs/architecture/decisions/0024-intent-coordination-substrate.md) + [coordination-substrate.md](../../../docs/architecture/coordination-substrate.md)), and the privacy/SSI architecture ([privacy-and-self-sovereign-identity.md](../../../docs/architecture/privacy-and-self-sovereign-identity.md)).

| ID | Question | Decision |
|---|---|---|
| **PD-22** | Where does `AgreementCredential` live — `verifiable-credentials` or `agreements`? | **`agreements`.** VC package ships only the envelope + Situation/Description bases (domain-neutral substrate). `AgreementCredential` is a specific Situation that describes a two-party agreement; lives next to the `AgreementRegistry` it gets issued into. Spec 241 owns the shape. |
| **PD-23** | Reserve `@agenticprimitives/payments` package name? | **Yes — PROMOTED TO W1 PACKAGE** per user direction 2026-06-02. Owns Layer 9b (PaymentMandate, x402 client, AP2 envelope, ERC-4337 paymaster bridge). [Spec 243](../../../specs/243-payments.md). |
| **PD-24** | Reserve `@agenticprimitives/fulfillment` package name? | **Yes — PROMOTED TO W1 PACKAGE** per user direction 2026-06-02. Owns Layers 10–12 (FulfillmentCase, A2A Task wrapping, Artifact references, Evidence binding). [Spec 244](../../../specs/244-fulfillment.md). |
| **PD-25** *(REVISED 2026-06-02b)* | Resolver layer (spine Layer 4) — separate `intent-resolver` package or fold into `intent-marketplace`? | **REVERSED: Reserve `@agenticprimitives/intent-resolver` package name (skeleton in W1, full implementation W2+).** Same pattern as old PD-23/PD-24 before promotion. Conceptual separation matters: the Resolver translates opaque intents into normalized executable orders ([ERC-7683 Resolver pattern](https://www.erc7683.org/)) — that's a distinct capability from intent expression + matchmaking. W1 ships a stub skeleton; intent-marketplace consumes via type-only edge. Spec 239 §4 documents the Resolver contract; the package itself lands as a skeleton (types + TODO stubs) for forward compatibility. Reason for reversal: user input 2026-06-02 + alignment with Anoma + ERC-7683 separation-of-concerns. |
| **PD-26** | Trace spans (`IntentTraceSpan`) — separate package? | **No.** Runtime/app-layer concern. Spans emit from spine packages but log/aggregate in `mcp-runtime` (existing). |
| **PD-27** | New packages for `desires` / `outcomes` / `reputation` / `validators` / `tasks`? | **No.** They are credential types via `attestations` (Layers 13/14/15) or A2A-runtime extensions (Layer 11). Per [ADR-0024](../../../docs/architecture/decisions/0024-intent-coordination-substrate.md) Decision 2 (architectural inverse of smart-contract-per-credential anti-pattern). |
| **PD-28** | BBS+ / SD-JWT alternative proof types — when? | **Reserved slot in W1**; implemented in W2 as a sub-module of `verifiable-credentials`. Primary remains `Eip712Signature2026`. Per [privacy doc](../../../docs/architecture/privacy-and-self-sovereign-identity.md) §2.3. |
| **PD-29** | Stealth-address support — where? | **Sub-module of `agreements` + `payments`** ([ERC-5564](https://eips.ethereum.org/EIPS/eip-5564)). Reserved interface in W1; implemented in W2. Per [privacy doc](../../../docs/architecture/privacy-and-self-sovereign-identity.md) D-45. |
| **PD-30** | Confidential payment rails (Aztec-style / Zcash-style / ZK paymasters) — when? | **Reserved sub-module family** in `payments`; W2 implementation. W1 ships public rails (x402, wallet, sponsored userOps). Per [privacy doc](../../../docs/architecture/privacy-and-self-sovereign-identity.md) §8 + [spec 243](../../../specs/243-payments.md) §5. |

### 10c. The W1 package list (final, locked 2026-06-02b)

**Six full + one skeleton new packages** + one extension to an existing package:

| Package | Layers (spine) | Spec | Contract | W1 implementation |
|---|---|---|---|---|
| `@agenticprimitives/verifiable-credentials` | envelope substrate for 12–15 | [242](../../../specs/242-trust-credentials-and-public-assertions.md) | none | full |
| `@agenticprimitives/attestations` | 12, 13, 14, 15 | [242](../../../specs/242-trust-credentials-and-public-assertions.md) + [ADR-0023](../../../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) | `AttestationRegistry.sol` | full |
| `@agenticprimitives/agreements` | 8 | [241](../../../specs/241-agreement-commitment-registry.md) | `AgreementRegistry.sol` | full |
| `@agenticprimitives/intent-marketplace` | 2, 3, 5, 6, 7 (Direct Lane) | [239](../../../specs/239-intent-spine.md) | none (vault-only W1) | full |
| `@agenticprimitives/intent-resolver` *(SKELETON 2026-06-02b)* | 4 | [239](../../../specs/239-intent-spine.md) §4.5 | none | **skeleton only** — types + TODO stubs; full impl W2 |
| `@agenticprimitives/payments` *(W1)* | 9b | [243](../../../specs/243-payments.md) | rails-specific (no new monolithic contract) | full |
| `@agenticprimitives/fulfillment` *(W1)* | 10, 11, 12 lifecycle | [244](../../../specs/244-fulfillment.md) | none | full |
| `@agenticprimitives/delegation` (extension) | 9a | [242](../../../specs/242-trust-credentials-and-public-assertions.md) PD-9 | `DelegationManager.verifyAuthorization(...)` view-only entrypoint added | extension only |

---

## 11. Implementation order (rough; not the wave plan yet)

This is the order things would need to land **once spec 241 settles** — the wave plan proper comes after. Each step is gated by the prior:

1. Spec 237 lands (closes contract surface + EIP-712 domain).
2. Solidity in `packages/contracts/src/agreement/` + tests + invariants land. Coverage gate via existing `check:forge-coverage`.
3. SDK package `@agenticprimitives/agreements` lands. Tests + cross-stack typehash + api-surface gates.
4. `ShapeRegistry.register(AgentCollaborationAgreementShape)` integrated into the agreements deploy helper (PD-8).
5. Deployment to Base Sepolia. New entries in `packages/contracts/deployments-base-sepolia.json`. Pages config (`deploy-cloudflare.ts`) propagates the new address.
6. App layer in `apps/demo-jp/` consumes the SDK. New dashboards + flow orchestrator. Personas + org-personas helpers land.
7. End-to-end flow: Pete-as-Global-Church issues an agreement between an adopter and a facilitator. Full IA §4 lifecycle exercised.

L-N items from IA §12 stay queued for later waves.

---

## 12. What this doc does NOT decide

- Contract surface details (constants, gas budgets, event signatures) → **spec 241**.
- Canonical JSON serialization rules (sort-key, escape rules, char encoding) → **spec 241 §3** (must be deterministic across stacks).
- The JP-specific payload schema fields → **`apps/demo-jp/src/lib/agreement-payload.ts`**, drafted in the implementation wave after spec 241.
- Wave-level implementation plan + PR sequencing → **separate doc once specs 237 + this + IA settle**.
- Privacy hardening (epoch buckets, relayer rotation, padding) → **L-3** and later.
- ZK / BBS+ infrastructure → **L-4 / L-5** and later.

---

## 13. Locked answer rolled in from IA §11

> **D-6** — Where does `AgreementRegistry` live? **Resolved:**
> - **Contract**: `packages/contracts/src/agreement/AgreementRegistry.sol`
> - **SDK**: `@agenticprimitives/agreements` (new package)
> - **Solidity** stays consolidated under `packages/contracts`; the TypeScript surface is what's new.

That's the only decision this doc was tasked with closing for IA. The PD-N items above are the new packaging-level decisions that emerge from following through.
