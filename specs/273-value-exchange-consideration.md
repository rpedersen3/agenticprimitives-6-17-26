# Spec 273 — Value Exchange: Consideration Legs (money is one leg type)

**Status:** Drafted (2026-06-11).
**Owns:** The `ExchangeLeg` / consideration abstraction in the Agreement layer — the typed structure that makes the substrate **exchange-centered** (barter-capable) rather than payment-centered.
**Architecture-of-record:** [ADR-0024](../docs/architecture/decisions/0024-intent-coordination-substrate.md) (the spine). This spec binds Layers 8–13 together; it adds no new layer.
**Companion specs:** [239](./239-intent-spine.md) (intent/match — already object-agnostic), [241](./241-agreement-commitment-registry.md) (agreement — gains the legs structure), [243](./243-payments.md) (monetary-leg settlement), [244](./244-fulfillment.md) (service-leg settlement), [272](./272-x402-pay-per-use.md) (a degenerate single-leg exchange).

---

## 0. Why this spec exists

Legacy commerce systems make payment the central object and bolt the deliverable on. Our spine is the opposite — Intent → Match → Agreement → Fulfillment → **Outcome** — and the intent layer is already resource-plural (`direction × object`, matcher forbidden from branching on type, spec 239 §7.1). But the Agreement layer has **no typed consideration structure**: nothing names what each party owes, so every consumer reinvents it and money-shaped assumptions creep in.

This spec adds the missing primitive: an agreement carries **exchange legs**, each leg is a consideration of SOME type, and **money is just one leg type with its own settlement rail**. Car-for-money, service-for-money, car-for-service, donation (one leg), and x402 pay-per-use (one monetary leg + entitlement mint) are all the same machinery.

## 1. Decisions

| ID | Decision | Rationale |
|---|---|---|
| **EXC-D1** | **Exchange is the primitive; payment is a leg type.** An agreement body carries `legs: ExchangeLeg[]` (≥1). Each leg = `{ legId, provider: Address, recipient: Address, consideration, settlement, milestones? }`. The `agreementCommitment` hash covers the full legs array — terms cannot be swapped post-signature. | Names what each party owes; kills the implicit "buyer/seller + price" shape. |
| **EXC-D2** | **Open consideration-type family** (registered, mirrors PMT-2 rails): `monetary` (AssetRef + amountPolicy → settles via `payments` rail / `PaymentMandate`), `asset-transfer` (on-chain token / title → settles via transfer + receipt), `service` (settles via spec-244 fulfillment task + evidence + validation), `entitlement` (mint/transfer of an entitlement), `credential` (issuance per spec 242). New types register; the agreement layer never enumerates them. | Resource plurality is open-ended (smart-agent catalog: capital, in-kind, coaching, hospitality, …). |
| **EXC-D3** | **Symmetric settlement, one evidence shape.** Every leg settles through its own lane but emits the same-shaped evidence: `LegSettled { agreementCommitment, legId, considerationType, evidenceHash, settledAt }` — a PaymentReceipt VC for monetary legs, an EvidenceCredential/validation for service legs, a transfer receipt for asset legs. Fulfillment (244) tracks ALL legs to completion; Outcome closes when all legs settle (or per agreed partial terms). | The car leg and the money leg are audit-equal. No leg type is "the real one". |
| **EXC-D4** | **Atomicity is per-exchange policy**, not a money feature: `sequential` (milestone-ordered; X402-D8's settle-on-milestone is this), `escrowed` (the reserved escrow rail, PMT-6, generalizes to a **symmetric escrow** holding any escrowable leg — W2), `atomic-onchain` (both legs on-chain → single redemption, future). Non-escrowable legs (services) pair milestone settlement with the counter-leg. | Barter needs the same counterparty-risk tools commerce has; escrow must not be money-only. |
| **EXC-D5** | **No money privilege — enforced.** Matcher (239), agreement (241), and fulfillment (244) layers MUST NOT branch on `considerationType === 'monetary'`. Only the leg's settlement executor knows its type. Pricing/checkout UX is app-layer. | Same load-bearing constraint as 239's "matcher MUST NOT branch on intentType". |

**Non-goals:** not a DEX/AMM (no automated price discovery — solver bids do that, Layer 6); not a legal-contract engine (the agreement body is the term sheet; enforcement is evidence + validation + trust, not courts); not double-entry accounting.

## 2. Reference: smart-agent patterns to port

- **`generalized-intent-matchmaking.md`** — the foundational re-framing: "the system is fundamentally an intent matchmaking platform, of which funding is one specialization among many"; the resource catalog (capital, **in-kind goods**, coaching, mentorship, hospitality, …) maps directly to the consideration-type family (EXC-D2). **Ported:** resource plurality as the root assumption; money as a specialization.
- **`grants-ontology.md`** — `Pledge` as "subclass of Commitment for capital/in-kind specifically" shows smart-agent already treats money and goods as siblings under one commitment class. **Ported:** consideration as a typed property of the commitment, not a separate payment object.
- **Deliberate divergence:** smart-agent never settles non-monetary legs (engagement/activity tracking only, no symmetric evidence). We add EXC-D3's uniform `LegSettled` evidence so barter legs are as auditable as transfers.

## 3. Commerce patterns → legs (the proof of generality)

| Pattern | Legs | Settlement |
|---|---|---|
| Traditional ecommerce (goods for money) | `monetary` (buyer→seller) + `asset-transfer` or `service`(shipping) (seller→buyer) | sequential or escrowed |
| Services engagement | `monetary` + `service` (with milestones) | sequential, milestone-bound (X402-D8 pattern) |
| Pure barter (car for service) | `asset-transfer` + `service` | escrowed (asset leg) + milestone (service leg) |
| Donation / grant | single leg (`monetary` or `asset-transfer`), counter-leg = outcome evidence only | sequential; evidence per smart-agent disbursement pattern |
| x402 pay-per-use (spec 272) | `monetary` (reader→treasury) + `entitlement` (service→reader) | degenerate sequential — already conformant via X402-D1/D8 |
| Credential-for-fee (licensing) | `monetary` + `credential` | sequential |

## 4. Requirements (deltas to companion specs)

- **EXC-R1 (`agreements`, spec 241):** agreement body gains `legs: ExchangeLeg[]`; `agreementCommitment` covers it; JV stores the full legs; on-chain stays commitment-hash-only (D-46.3 unchanged). Add §5.x to spec 241 when implemented.
- **EXC-R2 (`payments`, spec 243):** NO type changes — `PaymentMandate.contextBinding.agreementCommitment` + a new optional `legId` bind a mandate to the monetary leg it settles. The monetary-leg executor IS the existing rail registry.
- **EXC-R3 (`fulfillment`, spec 244):** a FulfillmentCase tracks all legs; `LegSettled` evidence (EXC-D3) is a typed evidence kind; case closes per atomicity policy (EXC-D4).
- **EXC-R4 (registry kit / ADR-0038):** consideration types are a registered family like payment rails; verticals add types (e.g. `in-kind:equipment`) without spec change.
- **EXC-R5 (spec 272):** no change required — the lbsb flow is the single-monetary-leg degenerate case; X402-D8's "payment rides outcomes" is EXC-D1 applied to one leg.

## 5. Invariants (DO NOT BREAK)

- **EXC-INV-1** — every agreement has ≥1 leg; every leg has a provider, recipient, consideration, and settlement lane. An agreement with un-typed consideration is a substrate violation.
- **EXC-INV-2** — the commitment hash covers all legs; no leg can be added, dropped, or re-priced post-signature (quote-immutability generalized from X402-D9).
- **EXC-INV-3** — no spine layer outside settlement executors branches on `considerationType` (EXC-D5).
- **EXC-INV-4** — every settled leg emits `LegSettled` evidence regardless of type; monetary legs get no extra audit standing, non-monetary legs no less.
- **EXC-INV-5** — atomicity policy is declared in the agreement (covered by the commitment); executors enforce it; UI never invents it.

## 6. Implementation status

Doctrine + type shapes only (this spec). Implementation rides the existing wave plans: EXC-R1 with the next `agreements` wave, EXC-R3 with `fulfillment`, symmetric escrow with the W2 escrow rail. Spec 272 ships unchanged.
