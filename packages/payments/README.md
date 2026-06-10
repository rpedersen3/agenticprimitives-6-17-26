# @agenticprimitives/payments

> **Status: STUB** (Wave 0.5 of the W1 implementation wave). Typed primitives and invariant guards ship today; the EIP-712 mandate signer and the three W1 rails land in Wave 6 per the [w1 implementation wave plan](../../docs/architecture/w1-implementation-wave-plan.md). A recent self-audit flagged this package's docs for overclaiming ([NEW-PMT-1](../../docs/audits/findings.yaml)); this README is written to the actual surface.

Machine payments arrived. x402 made HTTP-native pay-per-request real; Google's AP2 defined mandates for agent-initiated spend. What neither ships — what nobody ships — is machine payments scoped by the *same* delegation, custody, and audit substrate that governs everything else the agent does. "This agent may spend up to this amount, for this task, on this rail, until Friday — signed by a smart account, bound to the work it pays for, receipted into an attestation registry" is the combination the agent economy actually needs, and it only exists when payments are a layer of one system rather than a bolted-on rail.

This package is the designed payments slice of that substrate — spine Layer 9b, the `PaymentMandate` — spec'd in full, scaffolded now, landing in the implementation waves.

Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## What ships today

Typed primitives and pure invariant guards — no signing, no execution, no money moves:

- **`PaymentMandate` type** — payer, payee, granter, rail, `AmountPolicy` (exact / range / formula), `maxRedemptions`, validity window, `mode`, and an optional `delegationRef` linking the mandate to the delegation that authorized it.
- **`ContextBinding` + `assertContextBindingValid`** — PMT-3.1 enforced: every mandate must bind to at least one of intent / agreement / task / artifact / HTTP resource. No context-free spend.
- **`MandateConstraints`** — AP2-aligned aggregate scope: cumulative caps, redemption frequency windows, category allow/deny, geo-fencing.
- **Open/closed mode discrimination + `assertClosedMandateInvariants`** — PMT-INV-14 enforced: a closed (final-charge) mandate is always one-shot.
- **`computeMandateId`** — deterministic keccak-256 mandate identity over payer + nonce + rail + chain.
- **`PaymentRailExecutor` interface + `registerRail` / `getRail`** — the extension point every rail (current and future, including the reserved confidential family) implements.

## What lands in Wave 6 (designed, not shipped)

The EIP-712 typed-data builder, SA signing and ERC-1271 verification (no raw EOA signatures — PMT-INV-12), `redeemPaymentMandate`, and the three W1 rails: `rails/wallet` (SA-to-SA transfer via UserOp), `rails/x402` (HTTP-native per [x402.org](https://www.x402.org/) + reference facilitator), and `rails/sponsored-userop` (paymaster-sponsored, no value moved). Plus `PaymentReceipt` — an immutable, non-revocable credential asserted into the attestation registry per [ADR-0023](../../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md), so every redemption leaves first-class evidence. Confidential rails (Aztec-style, Zcash-style, ZK paymasters) are a reserved W2 sub-module family.

## Where this is heading / market context

- **x402** proved HTTP-native machine payments; it is one of our three W1 rails, not a competitor.
- **Google AP2** defined mandate semantics for agent spend; `MandateConstraints` is deliberately AP2-aligned so the substrate speaks the emerging lingua franca.
- The gap both leave open: x402 and AP2 authorize a *payment*; neither anchors it to a canonical on-chain identity with custody policy, a revocable delegation chain, and an audit trail behind it. Delegation-scoped machine payments — mandate references delegation, delegation references the Smart Agent, every step receipted — is the combination this layer exists to ship.

**Authoritative spec:** [spec 243 — payments](../../specs/243-payments.md) (see [`spec.md`](./spec.md)). Owns spine layer 9b; bounded surface in `CLAUDE.md` and `capability.manifest.json`.

## Build

```bash
pnpm --filter @agenticprimitives/payments typecheck
pnpm --filter @agenticprimitives/payments test
pnpm --filter @agenticprimitives/payments build
```

## Status — honest version

STUB. Nothing here signs or settles a payment today; treat the rails and the EIP-712 surface as spec'd commitments. The audit finding that this package's docs once claimed more ([NEW-PMT-1](../../docs/audits/findings.yaml)) is public — transparency about the gap is the point. Wave sequencing: [w1-implementation-wave-plan.md](../../docs/architecture/w1-implementation-wave-plan.md).
