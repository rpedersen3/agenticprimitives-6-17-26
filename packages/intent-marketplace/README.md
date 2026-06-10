# @agenticprimitives/intent-marketplace

> **Status: STUB** (Wave 0.5 of the W1 implementation wave). Typed primitives and matcher math ship today; the full Direct Lane marketplace lands in Wave 5 per the [w1 implementation wave plan](../../docs/architecture/w1-implementation-wave-plan.md).

Agents are about to negotiate with each other at scale, and the intent layer is where that negotiation starts: *"I want X, under these constraints — find me a counterparty."* ERC-7683 and Anoma proved the pattern for cross-chain settlement; what no one ships is intents that live under the **same delegation, custody, and audit substrate as the identity expressing them**. An intent here is expressed by a canonical Smart Agent address, brokered under a scoped delegation, and resolved with a signed, AI-auditable receipt — not a freeform message in a vendor silo.

This package is the designed coordination slice of that substrate: spine Layers 2, 3, 5, 6, and 7 — intent expression through dual-signed commitment — spec'd in full, scaffolded now, landing in the implementation waves.

Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## What ships today

The W1 foundational surface — types and pure functions, no marketplace runtime:

- **`Intent` typed envelope** — direction (`receive` | `give`) + SKOS object IRI + topic + payload + expected outcome + 5-tier visibility + status state machine.
- **`ConstraintSet` + `AssumptionSet`** — first-class typed structures (Anoma CSP-shaped), never freeform payload. Every constraint carries its `source` (`user-asserted` | `llm-inferred` | `policy-imposed`), strength, and enforcement point.
- **`ResolutionReceipt` type** — the AI-auditability surface: model + version + prompt hash + tool-call hashes + confidence + a `requiresUserConfirmation` gate, so an LLM-inferred constraint can never silently bind a user.
- **`IntentMatch` + `Commitment` types** — the match record and the dual-signed envelope handed off (as bytes) to `agreements`.
- **Matcher math** — `isCompatible` (opposite direction + same object + topic similarity) and the `composite` score (0.6 × proximity + 0.4 × outcome, Laplace-smoothed) with `toMatchScore`.

## What lands in the waves (designed, not shipped)

`buildIntent` / `signIntent`, the `runMatcher` / `rankCandidates` pipeline, visibility projections (`projectFor` with per-field DisclosurePolicy), the three-tier delegation model (T1 session / T2 system / T3 cross), and the scope catalog + cross-delegation builders. Pool Lane (1-to-N) and Proposal Lane (RFP) are deliberately deferred beyond W1. The resolver engine is a separate package — [`intent-resolver`](../intent-resolver).

## Where this is heading / market context

- **ERC-7683** standardized cross-chain intent orders and the resolver role; we adopt its resolver/matchmaker separation and reserve an `erc7683Order` slot for interop.
- **Anoma** shaped intents as constraint-satisfaction problems; our `ConstraintSet` follows that shape as a first-class type.
- **x402 and Google AP2** are making machine payments and agent mandates real — which is exactly why the intent that *triggers* a payment must share a trust chain with the mandate that authorizes it. Here, the intent, the delegation that brokered it, the payment mandate it binds to ([`payments`](../payments)), and the audit event it emits all reference one canonical address.

That combination — intents under the same delegation + custody + audit substrate — is the gap this package exists to fill.

**Authoritative spec:** [spec 239 — intent spine](../../specs/239-intent-spine.md) (see [`spec.md`](./spec.md)). Owns spine layers 2-3-5-6-7; bounded surface in `CLAUDE.md` and `capability.manifest.json`.

## Build

```bash
pnpm --filter @agenticprimitives/intent-marketplace typecheck
pnpm --filter @agenticprimitives/intent-marketplace test
pnpm --filter @agenticprimitives/intent-marketplace build
```

## Status — honest version

STUB. Treat every API outside "What ships today" as a design commitment, not a capability. Wave sequencing: [w1-implementation-wave-plan.md](../../docs/architecture/w1-implementation-wave-plan.md). Security findings for the whole repo are tracked live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).
