# @agenticprimitives/intent-resolver — Claude guide

> **Status:** STUB / SKELETON in W1 (Wave 5.4). Full resolver engine deferred to W2. This package ships **types + PassThroughResolver only** in W1.

## What this package owns

**Spine Layer 4 (Resolution)** — translates an opaque expressed `Intent` into a normalized canonical form (`ResolvedOrder`) per [ERC-7683's resolver-assumption pattern](https://www.erc7683.org/).

W1 scope:

- **`IIntentResolver` interface** — `resolve(intent): Promise<ResolvedOrder | null>`.
- **`ResolvedOrder` type** — `resolvedFromIntentId` + `canonicalConstraints` + `expandedAssumptions` + `validationRequirements` + optional `erc7683Order` (for future cross-chain interop).
- **`PassThroughResolver`** — single trivial implementation that returns the intent's existing `ConstraintSet` / `AssumptionSet` unchanged. Sets `confidence = 1.0` + `requiresUserConfirmation = false`. The W1 stub.

## What this package does NOT own (yet — deferred)

- **Per-domain resolvers** — `JpAdoptionResolver`, `CoachingResolver`, etc. (W2+; live in apps or vertical packages).
- **Constraint normalization** — "Coloradans" → `geo: 'US-CO'` etc. (W2).
- **Credential-requirement expansion** — `requiredFaithCredential` → `[JpAssociationCredential, ...]` (W2).
- **ERC-7683 cross-chain settlement emission** — `GaslessCrossChainOrder` (W2+).
- **LLM-driven resolution** — model invocation, prompt engineering, tool-calling (W2+, with full `ResolutionReceipt` provenance per RR-INV-01..05).

## Why a separate package even in W1

Per PD-25 (REVISED 2026-06-02b): the Resolver layer is conceptually distinct from intent expression + matchmaking. Reserving the package name + interface now gives W2 a clean place to grow without restructuring `intent-marketplace`. ERC-7683 + Anoma both separate the resolver from the matchmaker; we follow.

## Read these first

1. [`spec.md`](./spec.md) → [`specs/239-intent-spine.md`](../../specs/239-intent-spine.md) §4.5
2. [`coordination-substrate.md`](../../docs/architecture/coordination-substrate.md) Layer 4
3. [`ai-engagement-model.md`](../../docs/architecture/ai-engagement-model.md) §1.2 Resolver agent role

## Stable public exports (planned for W1)

`IIntentResolver`, `ResolvedOrder`, `PassThroughResolver`.

## Allowed imports

- `@agenticprimitives/types`, `@agenticprimitives/intent-marketplace` (type-only — for Intent + ConstraintSet + AssumptionSet)
- `@agenticprimitives/verifiable-credentials` (type-only — for `ResolutionReceipt` envelope when ResolutionReceiptCredential is asserted)
- `@agenticprimitives/ontology` (IRI constants)

## Forbidden imports

- Runtime call into `intent-marketplace` (type-only edge; resolver is upstream)
- Any LLM client lib in the W1 surface (PassThrough is deterministic)
- `apps/*`
- Vertical vocabulary

## Drift triggers — STOP and route

- "Add an LLM call in W1" — **STOP.** W2. W1 = PassThrough only.
- "Add per-vertical normalization" — **STOP.** Lives in apps or W2+ resolver-class packages.
- "Skip `ResolutionReceipt` production" — **STOP.** RR-INV-04 — every resolution produces a receipt (even PassThrough).
- "Promote draft intent without user confirmation" — **STOP.** RR-INV-01.

## Validate

```bash
pnpm --filter @agenticprimitives/intent-resolver typecheck
pnpm --filter @agenticprimitives/intent-resolver test
```
