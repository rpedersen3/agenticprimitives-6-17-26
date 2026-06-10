# @agenticprimitives/intent-marketplace — Claude guide

> **Status:** Foundational (W1) — code shipped; not production enforcement. See [AUDIT.md](./AUDIT.md).

## What this package owns

**Spine Layers 2, 3, 5, 6, 7** — the Direct Lane intent marketplace per [spec 239](../../specs/239-intent-spine.md). Pool / Proposal lanes are deferred to L-13 / L-14.

- **`Intent` typed envelope** — direction (receive | give) + object (SKOS) + topic + payload + expectedOutcome + visibility tier + state machine (per spec 239 §5).
- **`ConstraintSet` + `AssumptionSet`** — first-class typed structures, NOT freeform payload (per D-38; Anoma CSP-shaped; spec 239 §4.4).
- **`ResolutionReceipt`** — AI-auditability surface (RR-INV-01..05 per spec 239 §4.5a). Captures model + version + prompt hash + tool calls + confidence + `requiresUserConfirmation` gate.
- **`MatchInitiation` vs `IntentMatch`** — distinct classes per smart-agent's SS-02 / SS-03 invariants (spec 239 §6.3).
- **`Commitment`** — the dual-signed envelope handed off to `agreements` (Layer 7 → 8 bridge).
- **Matcher** — compatibility rule (filter: opposite direction + same object + topicSimilarity ≥ threshold) + composite score (0.6 × proximity + 0.4 × outcome; Laplace-smoothed) per spec 239 §7.
- **Visibility tiers + projections** — 5-tier model + cascade rule + per-field DisclosurePolicy (D-42).
- **Three-tier delegation model** — T1 session / T2 system / T3 cross (spec 239 §9).
- **Scope catalog + cross-delegation builders** — `intent:express` / `jp:broker_intent` / `match_initiation:create` / `match_initiation:notify` / `match_initiation:accept` etc.

## What this package does NOT own

- **Resolver engine** — that's `intent-resolver` (skeleton in W1; spec 239 §4.5).
- **AgreementCommitmentRegistry** — that's `agreements`.
- **The `AgreementCredential` shape** — `agreements` (PD-22).
- **Pool Lane (1-to-N) / Proposal Lane (RFP)** — deferred to L-13 / L-14.
- **App / JP-vertical content** — `apps/demo-jp/src/lib/` per [ADR-0021](../../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md).
- **Outcomes ledger storage** — app-side per PD-21 (the SDK ships the type + `computeRanking` helper only).

## Read these first

1. [`spec.md`](./spec.md) → [`specs/239-intent-spine.md`](../../specs/239-intent-spine.md)
2. [`coordination-substrate.md`](../../docs/architecture/coordination-substrate.md) Layers 2–7
3. [`ai-engagement-model.md`](../../docs/architecture/ai-engagement-model.md) — five AI roles + RR-INV-01..05 enforcement
4. [`privacy-and-self-sovereign-identity.md`](../../docs/architecture/privacy-and-self-sovereign-identity.md) D-42 per-field DisclosurePolicy

## Stable public exports (planned)

`buildIntent`, `signIntent`, `Intent`, `ConstraintSet`, `AssumptionSet`, `Constraint`, `NamedAssumption`, `MatchInitiation`, `IntentMatch`, `Commitment`, `ResolutionReceipt`, `runMatcher`, `rankCandidates`, `composite`, `projectFor(intent, viewerRole, visibility)`, scope catalog, cross-delegation builders.

## Allowed imports

- `@agenticprimitives/types`, `@agenticprimitives/verifiable-credentials` (type-only — for credentialRequired predicates), `@agenticprimitives/delegation` (type-only — for T3 cross-delegation builders), `@agenticprimitives/ontology` (IRI constants), `@agenticprimitives/intent-resolver` (type-only)
- `viem`

## Forbidden imports

- Runtime call into `agreements` (Commitment hand-off is via bytes, not by typed import)
- `apps/*`
- Faith / health / education / vertical vocabulary — `pnpm check:no-domain-in-packages` enforces

## Drift triggers — STOP and route

- "Make Pool / Proposal Lane W1" — **STOP.** PD-17. Direct Lane only.
- "Add `ConstraintSet` fields to freeform `payload`" — **STOP.** D-38. ConstraintSet is first-class typed.
- "Skip `ResolutionReceipt.requiresUserConfirmation` gate for inferred constraints" — **STOP.** RR-INV-01 + DOC-1 enforcement.
- "Make `matcher` configurable in W1 (custom scoring weights)" — **STOP.** PD-18. Hard-coded for W1.
- "Inline JP / faith vocabulary in a payload helper" — **STOP.** That belongs in `apps/demo-jp/src/lib/`.

## Validate

```bash
pnpm --filter @agenticprimitives/intent-marketplace typecheck
pnpm --filter @agenticprimitives/intent-marketplace test
```
