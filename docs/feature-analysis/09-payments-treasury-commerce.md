# 09 — Agent payments, treasury & commerce

**Focus area:** agents paying and getting paid — machine-payable APIs, agent commerce protocols, treasury funding/management, escrow, recurring/streaming payments, payouts.
**AP packages in scope:** [`payments`](../../packages/payments) (PaymentMandate + rails), [`delegation`](../../packages/delegation) (spend/payment caveats), [`contracts`](../../packages/contracts) (`PaymentEnforcer`, `PaymentReceiptRegistry`, `PaymentEscrow`), [`agent-account`](../../packages/agent-account) (treasury IS an SA per ADR-0010 + ERC-20 helpers), `SmartAgentPaymaster` (gas economics), [`agreements`](../../packages/agreements)/[`fulfillment`](../../packages/fulfillment) (exchange legs, specs 273/274); intent-marketplace lineage from smart-agent branch `003-intent-marketplace-proposal`.
**AP capability today:** treasury-as-Smart-Agent (canonical address, custody tiers, per-call spend enforcers); delegation-scoped spend; **shipped: the x402 rail** (v2 wire, `PaymentQuote`, staged executor, nullifier nonce-store) + `PaymentEnforcer` (treasury-scoped, per-charge + session caps, frequency window, one-shot nonce, transfer-only, identity-blind) + `PaymentReceiptRegistry`, all live on Base Sepolia. **This wave** adds the general-purpose payment surface every mature stack ships — direct/invoice pay, escrow + refunds, recurring, splits, prepaid credits, entitlements + bearer vouchers — plus x402 alignment (signed mandates, simulate, receipt VCs).

> Gap layers: `[Contracts]` Solidity surface · `[SDK]` TS packages/backends · `[UX]` product surface (**deferred**). See [index](index.md#gap-layers-every-gap-is-classified-into-exactly-one).

---

## Category verdict at a glance

| Product | Type | Tags | Verdict |
| --- | --- | --- | --- |
| x402 (Coinbase) / `@x402/*` v2 | Open protocol | PAY MCP | **Shipped + extending** — conform v2, `exact` now, reserve `upto`/`batch` |
| Google AP2 (Agent Payments Protocol) | Open spec | PAY DELEG | **Conform** — mandates ≈ our `PaymentMandate` + delegation caveats |
| Stripe Agentic Commerce (ACP) / Instant Checkout | Commercial + open spec | PAY ORDER | Map to `ExchangeOrder` (273/274), not payment internals |
| Stripe / Tempo MPP | Commercial | PAY SESSION | Reserve `session` (metered/recurring mandate profile) |
| Request Network | OSS protocol | PAY INVOICE AUDIT | **Port** invoice + payment-detection patterns |
| Coinbase Commerce Onchain Payment Protocol | Open protocol | PAY ESCROW | **Port** escrow/capture/refund; reserve swap-to-pay |
| Circle USDC / CCTP V2 | Commercial | PAY XCHAIN | Reserve cross-chain treasury rail (burn/mint + hooks) |
| Superfluid / Sablier | OSS protocol | PAY STREAM | Reserve streaming rail/profile |
| Stripe Connect / Adyen / MangoPay | Commercial | PAY SPLIT PAYOUT | **Port** split/payout; leave KYB/compliance to app/provider |
| Paddle / Lemon Squeezy (MoR) | Commercial | PAY TAX | Product-layer operating model, not Ring-0 |
| Privacy Pass / VOPRF (RFC 9576/9578) | Open standard | PAY ANON | **Port** blind bearer vouchers (tier A3) |
| smart-agent `PledgeRegistry`/`CommitmentRegistry` | Sibling repo | PAY ESCROW EVIDENCE | **Port** two-rail settlement + commitment-escrow + evidence-hash |

---

## Modern references to learn from

What each teaches and exactly what we port vs. reserve. We **port primitive patterns**, never take a runtime dependency or a conformance obligation ([ADR-0037](../architecture/decisions/0037-primitives-pure-repo-external-integration-and-ux-layers.md)).

- **x402 / `@x402/*` (v2)** — `PAYMENT-REQUIRED`/`PAYMENT-SIGNATURE`/`PAYMENT-RESPONSE` headers, CAIP-2 network ids, `accepts[]` requirements, `exact`/`upto`/`batch-settlement` schemes, multi-network adapters (EVM/SVM/Stellar/Aptos), framework middleware. **Port:** conform to v2 (shipped), implement `exact`. **Reserve:** `upto` (usage-based final amount), `batch-settlement` (high-frequency channels).
- **Google AP2** — mandates as portable authorization/trust *evidence* over any rail (intent/cart mandates). **Port:** map directly onto `PaymentMandate` + delegation caveats — open vs closed mandate (PMT-10) already mirrors AP2's intent/cart split. We are the *enforced* implementation of the mandate concept, not a parallel stack.
- **Stripe MPP (Tempo)** — `charge` + `session` model; streaming/pay-as-you-go machine sessions over stablecoin/card/bank rails. **Reserve:** `session` as a recurring/metered mandate *profile*, not a W1 wire protocol.
- **Stripe ACP / Instant Checkout** — checkout/order-level commercial intent + merchant fulfillment. **Map** to `ExchangeOrder` (specs 273/274); this is exchange-kernel territory, not payment internals.
- **Request Network** — invoices, payment *detection*, payment processor, escrow, streaming, Safe/multisig payment, encrypted invoice stakeholders. **Port:** invoice (request-for-payment) object + payment-detection/reconciliation query concepts.
- **Coinbase Commerce Onchain Payment Protocol** — guaranteed settlement, exact amount/address, swap-to-pay, operator-fee destination, escrow + delayed capture + refunds. **Port:** escrow/capture/refund (the new `PaymentEscrow.sol`). **Reserve:** swap-to-pay adapter, operator-fee split.
- **smart-agent `003-intent-marketplace-proposal`** (sibling repo) — `PledgeRegistry` two-rail settlement (cryptographic atomic `executeBatch([transfer, recordHonor])` + attested mark-paid with `sha256` evidence hash); `CommitmentRegistry` post-match escrow (status machine `PENDING → IN_FLIGHT → COMPLETED` / `RELEASES_BLOCKED`, milestone-tranche release, donor-only cancel); nullifier-keyed identity-blind on-chain state + visibility cascade; cadence enum + amendment log for recurring. **Port:** evidence-hash receipt pattern, commitment-escrow status machine, nullifier privacy. **Net-new vs smart-agent** (it lacks these): invoices, bearer vouchers/blind sigs, refund *distribution*, recipient splits, a universal receipt ledger.
- **Circle CCTP V2** — native USDC burn/mint, fast transfer + hooks. **Reserve:** cross-chain treasury rail.
- **Superfluid / Sablier** — continuous streams + vesting. **Reserve:** streaming rail/profile (windowed draw-down enforcer is the on-chain hook).
- **Stripe Connect / Adyen Platforms / MangoPay** — connected accounts, onboarding/KYB, split payouts, delayed payouts, balances. **Port:** split-payout + delayed-payout *concepts* (Seaport recipient-specific-consideration pattern). **Leave:** KYB/compliance to the app/provider layer.
- **Paddle / Lemon Squeezy (Merchant-of-Record)** — tax/VAT remittance + chargeback liability as a product operating model. **Not Ring-0** — record as an app/provider concern.

---

## Standard payment-package capability inventory

What a general-purpose payment stack must provide, each mapped to our primitive, with status and owning spec. `shipped` = live; `this-wave` = this plan; `reserved` = adapter family (spec/feature-analysis only, no W1 build).

| # | Capability | Our primitive | Status | Spec |
| --- | --- | --- | --- | --- |
| 1 | Quotes + payment links | app projection of `PaymentQuote` | shipped | 272/274 |
| 2 | Invoices (request-for-payment) | `rails/invoice` `Invoice` → closed mandate bound to `invoiceId`/`orderHash` | this-wave | 243 §5.3 |
| 3 | One-time direct pay (checkout) | `rails/wallet` direct SA→SA closed-mandate transfer | this-wave | 243 §5.3 |
| 4 | Pay-per-use metering | x402 `exact` rail + `PaymentEnforcer` | shipped | 272 |
| 5 | Usage-based capped charge | x402 `upto` scheme | reserved | 272 |
| 6 | Batched micropayments / channels | x402 `batch-settlement` / voucher channel | reserved | 272 |
| 7 | Holds + capture | `rails/escrow` over `PaymentEscrow.sol` (deposit→release) | this-wave | 243 §5.3 |
| 8 | Refunds / reversals | `buildRefund(receipt)` reverse leg, provenance-linked | this-wave | 243 / 273 EXC-D3 |
| 9 | Recurring / subscriptions | recurring profile (open mandate + `MandateConstraints.frequency`, per-charge derivation) | this-wave | 243 §5.3 / PMT-10 |
| 10 | Streaming | Superfluid/Sablier-style stream rail + windowed draw-down enforcer | reserved | 243 |
| 11 | Split payments + payouts | `buildSplitPayout(amount, recipients[{to,bps}])` | this-wave | 243 |
| 12 | Prepaid credits / balances | entitlement with `maxUses: N` | this-wave | 243 |
| 13 | Entitlements (pay-once-then-access) | `entitlement/` `EntitlementRecord { binding:'sa'\|'bearer' }` | this-wave | 272 §10 |
| 14 | Anonymous bearer tokens | VOPRF blind vouchers (Privacy Pass), tier A3 | this-wave | 272 §10 |
| 15 | Multi-asset + swap-to-pay | swap-to-pay adapter (Coinbase Commerce) | reserved | 243 |
| 16 | Cross-chain USDC | CCTP V2 burn/mint treasury rail | reserved | 243 |
| 17 | Disputes / chargeback evidence | dispute leg (audit-equal evidence, EXC-D3) | reserved | 273 |
| 18 | Receipts + reconciliation/export | `PaymentReceipt` VC + `PaymentReceiptRegistry` + `listReceiptsBy*`/CSV export | this-wave | 272 §11 / 243 §7 |
| 19 | Webhook / event delivery | idempotent event model + in-process subscriber (app-delivered later) | this-wave | 243 |
| 20 | Payment detection / balance reconciliation | payment-detection query object + balance-delta assertion | this-wave | 243 |
| 21 | Payouts to humans | off-ramp / mark-paid attested rail (track) | reserved | 243 |

**Anonymity tiers** (272 §10): A1 = nameless session SA (session-salt, no name facet; SA→treasury graph still public — honesty-labeled); A3 = blind bearer voucher (unlinkable redeem). Neither needs a contract change — `PaymentEnforcer` is already identity-blind (X402-D7).

---

## Focus-area gap rollup — by layer

### `[Contracts]` gaps

| Gap | Evidence | Roadmap ID | Priority | Status |
| --- | --- | --- | --- | --- |
| Per-use payment enforcer (treasury-scoped, caps, frequency, one-shot nonce, transfer-only) | x402, AP2 | FG-PAY-1 | P1 | **done** (PaymentEnforcer, this+prior wave) |
| Escrow / hold-capture-refund-reclaim contract | Coinbase Commerce, smart-agent CommitmentRegistry | FG-PAY-7 | P1 | **this-wave** (PaymentEscrow.sol) |
| Cumulative/periodic spend budget enforcer | AP2 mandates, MetaMask Guard Mode | FG-DELEG-1 | P1 | partial (frequency window shipped) |
| Stream-aware treasury enforcers (draw-down caveats) | Superfluid, Sablier | FG-PAY-4 | P3 | reserved |

### `[SDK]` / package gaps

| Gap | Evidence | Roadmap ID | Priority | Status |
| --- | --- | --- | --- | --- |
| x402 integration: price-gated tools + payer-side spend under caveats | x402, Coinbase | FG-PAY-1 | P1 | **done** (x402 rail + a2a gate) |
| Payment ↔ audit-evidence binding (receipts tied to agreements) | Request, x402 | FG-PAY-2 | P1 | **this-wave** (PaymentReceipt VC + registry) |
| Invoice (request-for-payment) object + payment detection | Request Network | FG-PAY-8 | P1 | this-wave |
| Refunds / reversals (provenance-linked reverse leg) | Request, Coinbase Commerce | FG-PAY-9 | P1 | this-wave |
| Recurring/subscription mandate profile | Stripe MPP, AP2 | FG-PAY-10 | P2 | this-wave |
| Prepaid credits / entitlement balances | Stripe, gift-card model | FG-PAY-11 | P2 | this-wave |
| Split payouts + payout helper | Stripe Connect, Adyen, MangoPay | FG-PAY-12 | P2 | this-wave |
| AP2 mandate compat (delegation → mandate mapping; A2A payment extension) | Google AP2 | FG-PAY-3 | P2 | partial (mandate shipped; A2A ext done) |
| Stablecoin treasury ops (USDC, CCTP cross-chain) | Circle | FG-PAY-5 | P2 | reserved |
| Agent-wallet provisioning DX (one-call funded wallet) | Coinbase AgentKit | FG-PAY-6 | P2 | reserved |

### `[UX]` gaps — **deferred (recorded, not current focus)**

| Gap | Evidence |
| --- | --- |
| Treasury funding/top-up flows; spend dashboards | Safe, Stackup, Den |
| Invoice/payout/subscription operator surfaces | Request Finance, Payman, Stripe Billing |

**Substrate advantages to preserve:** treasury IS a Smart Agent (custody tiers + spend caveats on the same canonical address — no payment product has this); delegation-scoped spending enforced on-chain (not just signed mandates); every payment leg is audit-equal evidence bindable to on-chain agreements/attestations (273 EXC-D3); identity-blind settlement with optional bearer-unlinkable vouchers — privacy posture no commercial rail offers.
