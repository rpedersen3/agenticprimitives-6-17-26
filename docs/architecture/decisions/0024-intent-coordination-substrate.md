# ADR-0024 — Intent coordination substrate (the 15-layer spine)

**Status:** Accepted (2026-06-02).
**Drivers:** ecosystem alignment with intent-centric architectures (ERC-7521, ERC-7683, Anoma, CoW, UniswapX); agent-protocol alignment (A2A, MCP, ERC-8004); coordination-across-layers as platform thesis; privacy + SSI as load-bearing properties.
**Architecture overview (companion docs):** [coordination-substrate.md](../coordination-substrate.md) — positioning + 15-layer reference; [privacy-and-self-sovereign-identity.md](../privacy-and-self-sovereign-identity.md) — privacy + SSI properties of every layer.
**Companion ADR:** [ADR-0023](./0023-attestation-registry-eas-aligned-bilateral-consent.md) (attestation registry contract surface).
**Concrete specs:** [239](../../../specs/239-intent-spine.md), [241](../../../specs/241-agreement-commitment-registry.md), [242](../../../specs/242-trust-credentials-and-public-assertions.md), [243](../../../specs/243-payments.md), [244](../../../specs/244-fulfillment.md).

---

## Why this ADR exists

The Agentic Primitives platform is **a coordination substrate**, not a feature collection. The 15-layer model in [coordination-substrate.md](../coordination-substrate.md) is the substrate's reference architecture. This ADR locks the **decisions** that architecture rests on, so they cannot drift without an explicit successor ADR.

Companion intent: ADR-0023 locks the attestation registry contract surface; this ADR locks the spine that registry serves evidence + reputation for.

## The substrate decisions

### Decision 1 — The 15 layers are first-class architectural primitives

The 15-layer model (1 Desire / 2 Intent / 3 ConstraintSet+AssumptionSet / 4 Resolution / 5 Proposal-Order / 6 SolverBid-MatchCandidate / 7 IntentMatch / 8 Agreement-Commitment / 9a PermissionGrant / 9b PaymentMandate / 10 FulfillmentCase / 11 Task-WorkItem / 12 Artifact-Evidence / 13 Outcome / 14 Validation / 15 TrustUpdate) is **the** reference architecture. Specs, packages, contracts, audits, and demo apps MUST map their work to a named layer.

Adding a new layer requires a successor ADR. Renaming a layer requires a successor ADR. Removing a layer is forbidden; layers can only be marked deprecated.

### Decision 2 — Package-to-layer mapping (locked)

| Layer | Owning package | Owning contract |
|---|---|---|
| 1 Desire | ontology only (spec 225) | none |
| 2 Intent | `intent-marketplace` | none |
| 3 Constraint+Assumption | `intent-marketplace` | none |
| 4 Resolution | `intent-marketplace` | none |
| 5 Proposal/Order | `intent-marketplace` | none |
| 6 SolverBid/MatchCandidate | `intent-marketplace` | none |
| 7 IntentMatch | `intent-marketplace` | none |
| 8 Agreement/Commitment | `agreements` | `AgreementRegistry.sol` |
| 9a PermissionGrant | `delegation` (existing) | `DelegationManager.sol` |
| 9b PaymentMandate | `payments` | rails-specific (spec 243) |
| 10 FulfillmentCase | `fulfillment` | none |
| 11 Task/WorkItem | `fulfillment` + `mcp-runtime` (existing) | none |
| 12 Artifact/Evidence | `fulfillment` (lifecycle) + `attestations` (`EvidenceCredential`) | `AttestationRegistry.sol` |
| 13 Outcome | `attestations` (`OutcomeCredential`) | `AttestationRegistry.sol` |
| 14 Validation | `attestations` (`ValidationCredential`) | `AttestationRegistry.sol` |
| 15 TrustUpdate | `attestations` (`TrustUpdate` credential class) | `AttestationRegistry.sol` |

**The architectural inverse of the smart-contract-per-credential anti-pattern.** Layers 12–15 do NOT each get their own contract. They are discriminated by `credentialType` in the same `AttestationRegistry`. Adding a new credential class requires a SHACL shape registration in `ShapeRegistry` (governance-gated) — never a new contract.

### Decision 3 — Six W1 packages, no more, no less

| Package | Layers | Status |
|---|---|---|
| `@agenticprimitives/verifiable-credentials` | envelope substrate for 12–15 | W1 |
| `@agenticprimitives/attestations` | 12, 13, 14, 15 | W1 |
| `@agenticprimitives/agreements` | 8 | W1 |
| `@agenticprimitives/intent-marketplace` | 2, 3, 4, 5, 6, 7 | W1 |
| `@agenticprimitives/payments` | 9b | W1 (per user elevation 2026-06-02) |
| `@agenticprimitives/fulfillment` | 10, 11, 12 lifecycle | W1 (per user elevation 2026-06-02) |

Plus extensions to existing packages: `delegation.verifyAuthorization(...)` view-only entrypoint (PD-9 per spec 242).

**No new packages for desires / outcomes / reputation / validators / tasks.** They are credential types in `attestations` or live in `mcp-runtime`. This is locked.

### Decision 4 — Each layer has an industry-standard analog

| Layer | Adopted from |
|---|---|
| 2 Intent | ERC-7521, ERC-7683, Anoma, CoW signed orders, UniswapX |
| 3 Constraint+Assumption | ERC-7683 resolver assumptions, A2A AgentCard requirements |
| 4 Resolution | ERC-7683 Resolver contract |
| 5 Proposal/Order | UniswapX signed orders, CoW order-book, A2A task proposal |
| 6 SolverBid | CoW solvers, UniswapX fillers, Anoma compositional matching |
| 7 IntentMatch | EAS attestation linking |
| 8 Agreement/Commitment | Hyperledger Indy commitments, Sidetree anchor pattern |
| 9a PermissionGrant | ERC-7710 + ERC-7715 + ERC-7579 |
| 9b PaymentMandate | x402, AP2, AgentKit, ERC-4337 paymasters, EIP-5792 |
| 10 FulfillmentCase | A2A Task lifecycle, OpenAI Agents SDK |
| 11 Task/WorkItem | A2A Task states, MCP tool calls |
| 12 Artifact/Evidence | A2A Artifact, EAS off-chain, W3C VC evidence |
| 13 Outcome | PROV-O, DOLCE+DnS, ERC-8004 outcomes |
| 14 Validation | ERC-8004 Validation Registry, zkML, TEE attestations |
| 15 TrustUpdate | ERC-8004 Reputation, AnonCreds reputation, EAS reputation |

**Every new layer or credential type MUST include a "Reference: industry patterns to port" section in its spec, naming what we adopt + what we diverge on.** This is a hard rule, enforced by spec review.

### Decision 5 — W1 scope fence

W1 ships **Direct Lane only** for the intent marketplace (matching is 1-to-1 / 1-to-many for direct counterparties). Pool Lane (many-to-1) and Proposal Lane (open competitive bidding) are deferred to W2+ per [spec 239](../../../specs/239-intent-spine.md) §4.3 (L-13, L-14).

W1 ships Resolution **off-chain only**. On-chain Resolution contract (for ERC-7683 settlement-layer interop) is deferred.

W1 ships **public payment rails** (x402, wallet, sponsored userOps). Confidential rails (Aztec-style, Zcash-style, ZK paymasters) are reserved per PD-30, deferred to W2.

W1 ships **Eip712Signature2026** as the primary credential proof. Selective-disclosure proof types (BBS+, SD-JWT) are reserved per D-44 + PD-28, deferred to W2.

W1 ships **canonical W3C VC envelope**. AnonCreds bridge is deferred to W3+; not committed.

### Decision 6 — Cross-cutting concerns are substrate properties, not packages

Five cross-cutting concerns are **architectural properties** that every layer respects, not separate packages:

| Concern | How it's substrate-wide |
|---|---|
| **Identity** | SA address ([ADR-0010](./0010-smart-agent-canonical-identifier.md)); credentials rotate, identity persists ([ADR-0011](./0011-credential-recovery-and-re-association.md)) |
| **Authority** | Typed delegation (ERC-7710 + caveats); declarative ([ADR-0022](./0022-authority-must-be-declarative.md)) |
| **Privacy** | Visibility tiers + DisclosurePolicy + vault residency (see ADR companion doc [privacy-and-self-sovereign-identity.md](../privacy-and-self-sovereign-identity.md); D-42..D-48) |
| **Provenance** | Typed trace spans (`IntentTraceSpan`) emitted by every layer; PROV-O grounding |
| **W3C VC composability** | Same envelope for every signed artifact across the substrate; `credentialType` discrimination |

### Decision 7 — Trace spans live in runtime, not as a new package

`IntentTraceSpan` event-shape is emitted by spine packages but logged/aggregated by `mcp-runtime` (existing) and apps. **Not a new package** (PD-26). The substrate publishes the span shape; the runtime + indexer consume.

### Decision 8 — AgreementCredential lives in `agreements`, not in `verifiable-credentials`

Per PD-22: the VC package ships only the envelope + Situation/Description bases (domain-neutral substrate). Specific credential types live in the package that owns their use case. `AgreementCredential` lives in `agreements` next to the `AgreementRegistry` it gets issued into.

### Decision 9 — Reference: smart-agent patterns ported into the spine

Per CLAUDE.md hard rule, the spine specs document the smart-agent patterns ported:

- **Ported as-is.** BDI loop (Perceive/Deliberate/Plan/Act); SHACL + PROV-O grounding; intentType-as-presentation vs. matching-semantics-as-structure separation; vault-shape conventions; `intentMatch` / `intentExpects` semantics; visibility-tier model; count-based `bump_ack_count` state transitions; sensitive-type private-default rule; beneficiary defaulting rules; matchScore 0..10000 decimal range; the 12-scope catalog.

- **Ported with modification.** ConstraintSet + AssumptionSet first-class (smart-agent kept these in payload — D-38 promotes them to typed structures); LLM-inferred vs. user-asserted vs. policy-imposed constraint source distinction (D-43 — smart-agent didn't distinguish); progressive commitment lifecycle (smart-agent had partial lifecycle; we add stages).

- **Not ported / diverged.** Smart-agent's marketplace was monolithic; we split into intent-marketplace + agreements + payments + fulfillment as separate packages with type-only cross-edges.

## Drift triggers — STOP and reroute

- "I want to add an intent layer between 7 and 8." — **STOP.** Either it fits into an existing layer, or it requires a successor ADR.
- "I want to put the outcome credential in its own package because it's important." — **STOP.** Decision 2. Outcomes are a credential type in `attestations`.
- "I want to add a new contract for reputation." — **STOP.** Decision 2. TrustUpdate is a credential class in `AttestationRegistry`.
- "I want to ship competitive solver bidding in W1." — **STOP.** Decision 5. Direct Lane only. L-14 deferred.
- "I want a payment rail that doesn't bind to intentId / taskId / agreementCommitment." — **STOP.** Decision 4 + ADR-0023. Context-binding is a hard substrate invariant (see x402 security research). Unbinding it is a successor ADR.
- "I want to ship AnonCreds support in W1." — **STOP.** Decision 5. W3 consideration; not W1 commitment.
- "I want to skip the smart-agent reference section because we're inventing this layer." — **STOP.** CLAUDE.md hard rule. If there's no prior art, the spec must say so explicitly and justify.

## What this ADR is NOT

- NOT a list of features. The layers describe coordination primitives, not user-facing features.
- NOT a roadmap. The architectural commitments are independent of timing.
- NOT EAS / Anoma / A2A / MCP compatible at the binary level. Pattern-recognizable, not drop-in.
- NOT a governance document. Governance of substrate evolution is via ADR succession + ShapeRegistry `defineShape(...)` for new credential types.
- NOT mutable. Successor ADRs can change decisions; this ADR cannot be edited in place except for status (Accepted → Superseded by ADR-NNNN).

## Related

**ADRs:**
- [ADR-0023](./0023-attestation-registry-eas-aligned-bilateral-consent.md) — Attestation registry (the substrate this spine emits credentials into)
- [ADR-0010](./0010-smart-agent-canonical-identifier.md) — Smart Agent canonical identifier
- [ADR-0011](./0011-credential-recovery-and-re-association.md) — Credentials rotate; identity persists
- [ADR-0021](./0021-generic-packages-vs-white-label-apps.md) — Packages are generic; white-label is config
- [ADR-0022](./0022-authority-must-be-declarative.md) — Authority is declarative

**Architecture overview docs:**
- [coordination-substrate.md](../coordination-substrate.md) — the 15-layer reference architecture (this ADR's positioning companion)
- [privacy-and-self-sovereign-identity.md](../privacy-and-self-sovereign-identity.md) — privacy + SSI properties

**Specs:**
- [239 — intent marketplace](../../../specs/239-intent-spine.md) — Layers 2–7
- [241 — agreement registry](../../../specs/241-agreement-commitment-registry.md) — Layer 8
- [242 — verifiable credentials + attestations](../../../specs/242-trust-credentials-and-public-assertions.md) — Layers 12–15 substrate
- [243 — payments](../../../specs/243-payments.md) — Layer 9b
- [244 — fulfillment](../../../specs/244-fulfillment.md) — Layers 10–12

## Sources

- [ERC-7521 — General Intents for Smart Contract Wallets](https://eips.ethereum.org/EIPS/eip-7521)
- [ERC-7683 — Cross-Chain Intents Standard](https://www.erc7683.org/)
- [ERC-7710 — Smart Contract Delegation](https://eips.ethereum.org/EIPS/eip-7710)
- [ERC-7715 — Grant Permissions from Wallets](https://eips.ethereum.org/EIPS/eip-7715)
- [ERC-7579 — Modular Smart Account](https://eips.ethereum.org/EIPS/eip-7579)
- [ERC-4337 — Account Abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-8004 — Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [EIP-5792 — Wallet Call API](https://eips.ethereum.org/EIPS/eip-5792)
- [Anoma — Intent-centric architecture](https://anoma.net/)
- [A2A — Agent-to-Agent Protocol](https://google.github.io/A2A/)
- [MCP — Model Context Protocol](https://modelcontextprotocol.io/specification)
- [x402 — HTTP-native Agent Payments](https://www.x402.org/)
- [Coinbase AgentKit](https://docs.cdp.coinbase.com/agentkit/welcome)
- [CoW Protocol — Intents, MEV, and Batch Auctions](https://www.shoal.gg/p/cow-swap-intents-mev-and-batch-auctions)
- [UniswapX](https://docs.uniswap.org/contracts/uniswapx/overview)
- [W3C VC Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C VC StatusList2021](https://www.w3.org/TR/vc-status-list/)
- [PROV-O](https://www.w3.org/TR/prov-o/)
