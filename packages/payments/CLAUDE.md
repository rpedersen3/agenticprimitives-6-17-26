# @agenticprimitives/payments — Claude guide

> **Status:** Foundational (W1) — code shipped; not production enforcement. See [AUDIT.md](./AUDIT.md).

## What this package owns

**Spine Layer 9b (PaymentMandate)** — per [spec 243](../../specs/243-payments.md).

- **`PaymentMandate` typed primitive** — including `ContextBinding` (PMT-3), `MandateConstraints` (AP2-aligned aggregate scope), and `mode: 'open' | 'closed'` discriminator (PMT-10).
- **EIP-712 typed-data builder + signer + verifier** — SA-signed via ERC-1271; no raw EOA signatures.
- **Open vs closed mode invariants (PMT-10.1)** — open mandate refuses final-charge; closed mandate one-shot; PMT-INV-13..15.
- **Rails** (sub-modules under `./rails/`) — spec 243 §5.5:
  - `x402` — HTTP-native per [x402.org](https://www.x402.org/) (v2 wire, staged executor + simulate, nonce store).
  - `wallet` — direct SA→SA closed-mandate transfer (`buildWalletTransferPlan`).
  - `invoice` — request-for-payment object → wallet mandate bound to `invoiceId`.
  - `escrow` — calldata over `PaymentEscrow.sol` (deposit/release/refund/reclaim).
  - `recurring` — open-mandate template + per-period closed-charge derivation (PMT-10).
- **Mandate signing** (`mandate-sign.ts`) — EIP-712 typed-data + `signPaymentMandate` + ERC-1271 `verifyPaymentMandateSignature` (PMT-INV-02/12; `hashContextBinding` = no field-strip).
- **`PaymentReceipt` VC** (`receipt.ts`) — `buildPaymentReceiptCredential` (immutable; refund legs carry provenance).
- **Entitlements** (`entitlement/`) — `EntitlementRecord` (sa|bearer) mint/check/consume + credits; **VOPRF blind vouchers** (`entitlement/voucher.ts`, ristretto255/RFC 9497 — spec 272 §10 A3).
- **Helpers** — `buildRefund` (reverse leg) · `buildSplitPayout` (bps fan-out) · `ops` (idempotent event log + reconciliation + CSV/JSON export).
- **Rail interface + registry** — `PaymentRailExecutor` + extensible registration; confidential-* rails reserved (PD-30, W2).

## What this package does NOT own

- **Permission delegation** — that's `delegation` (Layer 9a). PaymentMandate REFERENCES a delegation when minted via one (`delegationRef`) but doesn't own delegation semantics.
- **Confidential rails** (Aztec-style, Zcash-style, ZK paymasters) — reserved sub-module family per PD-30; W2 implementation.
- **The VC envelope for `PaymentReceipt`** — `verifiable-credentials`.
- **The attestation contract** — `attestations` + `AttestationRegistry.sol`.

## Read these first

1. [`spec.md`](./spec.md) → [`specs/243-payments.md`](../../specs/243-payments.md)
2. [`coordination-substrate.md`](../../docs/architecture/coordination-substrate.md) Layer 9b
3. [`ai-engagement-model.md`](../../docs/architecture/ai-engagement-model.md) §3.2 economic-plane threats
4. [ADR-0023](../../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) composability table (PaymentReceipt row)
5. [`privacy-and-self-sovereign-identity.md`](../../docs/architecture/privacy-and-self-sovereign-identity.md) D-45 stealth-address payee

## Stable public exports (planned)

`buildPaymentMandate`, `signPaymentMandate`, `verifyPaymentMandateSignature`, `registerRail`, `getRail`, `redeemPaymentMandate`, `buildPaymentReceiptCredential`, `assertPaymentReceipt`, `PaymentMandate`, `ContextBinding`, `MandateConstraints`. Plus sub-module exports per rail under `./rails/{wallet,x402,sponsored-userop}`.

## Allowed imports

- `@agenticprimitives/types`, `@agenticprimitives/verifiable-credentials` (type-only — for PaymentReceipt envelope), `@agenticprimitives/attestations` (type-only — for assertion client), `@agenticprimitives/delegation` (type-only — for delegationRef when present), `@agenticprimitives/ontology` (IRI constants)
- `viem`, `@noble/curves` (ristretto255 VOPRF for blind vouchers), `@noble/hashes`

## Forbidden imports

- `apps/*`
- Vertical vocabulary
- Runtime call into `attestations` (use assertion client, not direct contract call)
- Hard-coded merchant / vendor identities

## Drift triggers — STOP and route

- "Open mandate consummates final charge directly" — **STOP.** PMT-10.1 + PMT-INV-13.
- "Closed mandate with `maxRedemptions > 1`" — **STOP.** PMT-INV-14; closed is always one-shot.
- "Payment without `contextBinding` populated" — **STOP.** PMT-INV-01.
- "Cross-chain redemption" — **STOP.** PMT-INV-03; same-chain only in W1. Successor ADR required.
- "Implement Aztec / Zcash / ZK rails in W1" — **STOP.** Reserved per PD-30; W2.
- "Raw EOA signature on a mandate" — **STOP.** PMT-INV-12; SA + ERC-1271 only.

## Validate

```bash
pnpm --filter @agenticprimitives/payments typecheck
pnpm --filter @agenticprimitives/payments test
```
