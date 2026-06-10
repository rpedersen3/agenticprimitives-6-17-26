# @agenticprimitives/intent-resolver

> **Status: STUB / SKELETON** (Wave 0.5 of the W1 implementation wave). W1 ships types + `PassThroughResolver` only; the full resolver engine lands in W2 per the [w1 implementation wave plan](../../docs/architecture/w1-implementation-wave-plan.md).

Between "what a user said" and "what the system can match" sits resolution: turning an opaque expressed intent into a normalized canonical order. ERC-7683 made the resolver a named role in cross-chain intents; Anoma made it the heart of its architecture. Both treat resolution as separate from matchmaking — and so do we, because the resolver is where AI enters the trust chain. When a model infers a constraint a user never typed, that inference needs provenance: which model, which prompt, what confidence, and whether the user confirmed it. In this substrate that provenance is a typed `ResolutionReceipt`, and resolution happens under the same canonical identity, delegation, and audit trail as everything else the agent does.

This package is the designed Layer 4 of that spine — interface reserved now, engine landing in W2 — so the resolver grows in its own bounded home instead of being bolted onto the marketplace later.

Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## What ships today

The complete W1 surface is three exports:

- **`IIntentResolver`** — `resolve(intent): Promise<ResolvedOrder | null>`. The stable contract every future resolver implements.
- **`ResolvedOrder`** — `resolvedFromIntentId` + `canonicalConstraints` + `expandedAssumptions` + `validationRequirements`, with an optional `erc7683Order` slot reserved for cross-chain interop.
- **`PassThroughResolver`** — the deterministic W1 implementation: returns the intent's existing `ConstraintSet` / `AssumptionSet` unchanged. No LLM, no normalization, no surprises.

```ts
import { PassThroughResolver } from '@agenticprimitives/intent-resolver';

const resolver = new PassThroughResolver();
const order = await resolver.resolve(intent); // constraints pass through unchanged
```

## What lands in W2 (designed, not shipped)

Constraint normalization (colloquial scope → canonical codes), credential-requirement expansion, LLM-driven resolution with full `ResolutionReceipt` provenance (RR-INV-01..05 — every resolution produces a receipt, and inferred constraints cannot bind without user confirmation), and ERC-7683 order emission. Per-domain resolvers live in apps or W2+ resolver packages, never here.

## Where this is heading / market context

- **ERC-7683** defines the resolver-assumption pattern for cross-chain orders; this package follows its resolver/matchmaker separation and targets its order shape for interop.
- **Anoma** treats intent resolution as constraint solving; the `ConstraintSet` types this resolver consumes (from [`intent-marketplace`](../intent-marketplace)) are CSP-shaped for the same reason.
- **x402 / Google AP2** machine-payment rails make the stakes concrete: a resolved order can bind a payment mandate, so the resolution step must be attributable and auditable under the same identity substrate as the spend it triggers. That is the combination — resolution with receipts, inside one delegation + custody + audit chain — that stitched stacks do not offer.

**Authoritative spec:** [spec 239 — intent spine, §4.5](../../specs/239-intent-spine.md) (see [`spec.md`](./spec.md)). Owns spine layer 4 (skeleton); bounded surface in `CLAUDE.md` and `capability.manifest.json`.

## Build

```bash
pnpm --filter @agenticprimitives/intent-resolver typecheck
pnpm --filter @agenticprimitives/intent-resolver test
pnpm --filter @agenticprimitives/intent-resolver build
```

## Status — honest version

STUB / SKELETON. `PassThroughResolver` is the only implementation and it is intentionally trivial. Everything in "What lands in W2" is a spec'd commitment, not shipped capability. Wave sequencing: [w1-implementation-wave-plan.md](../../docs/architecture/w1-implementation-wave-plan.md). Repo-wide security findings: [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).
