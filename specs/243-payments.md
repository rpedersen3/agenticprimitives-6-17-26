# Spec 243 — Payments: PaymentMandate primitive + payment-rail abstraction

**Status:** Drafted (2026-06-02).
**Owns:** Layer 9b of the 15-layer spine ([coordination-substrate.md](../docs/architecture/coordination-substrate.md) §4).
**Architecture-of-record:** [ADR-0024](../docs/architecture/decisions/0024-intent-coordination-substrate.md) (the spine), [ADR-0023](../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) (PaymentReceipt credential type lives in `AttestationRegistry`).
**Companion specs:** [239](./239-intent-spine.md) (intent → match), [241](./241-agreement-commitment-registry.md) (agreement), [242](./242-trust-credentials-and-public-assertions.md) (VC envelope), [244](./244-fulfillment.md) (task execution + payment binding).
**Package:** `@agenticprimitives/payments` (new W1 package per user elevation 2026-06-02).
**Privacy posture:** [privacy-and-self-sovereign-identity.md](../docs/architecture/privacy-and-self-sovereign-identity.md) §4 Layer 9b.

---

## 0. Why this spec exists

The agentic stack of 2026 has converged on three observations:

1. **Agents need to pay for things autonomously.** API access ([x402](https://www.x402.org/)), compute, off-chain services, third-party tool calls, intent fulfillment fees, validator stake, paymaster sponsorship. These are not user-facing checkout flows — they are inline protocol-layer payments.
2. **Payment-rail diversity is mandatory.** No single rail (x402, wallet, sponsored userOps, escrow, invoice, paymaster) covers every use case. The substrate must be rail-agnostic.
3. **Context-binding is the load-bearing security property.** Recent x402 security research flags missing context binding, replay, substitution, concurrency races, and atomicity as the top vulnerabilities. Payment signatures MUST bind to the exact resource, amount, nonce, chain, intentId/taskId/agreementCommitment, and expiration.

The `@agenticprimitives/payments` package + `PaymentMandate` primitive are the substrate's answer: a typed, context-bound, rail-agnostic payment authority with replay-safe binding to spine artifacts.

## 1. Decisions

| ID | Decision | Why |
|---|---|---|
| **PD-23.1** | Package name is `@agenticprimitives/payments` (locked) | Per ADR-0024 Decision 3 |
| **PMT-1** | `PaymentMandate` is the canonical primitive | Industry-standard term across x402, AP2, AgentKit |
| **PMT-2** | Payment-rail family is open (registered, not enumerated) | New rails can be added without spec change; each rail is a sub-module |
| **PMT-3** | Context binding is a hard substrate invariant | Per spine §9.2 (D2); enforced by signature scheme |
| **PMT-4** | `PaymentReceipt` is a credential type in `AttestationRegistry` | Per ADR-0023; receipts are W3C VCs |
| **PMT-5** | `PaymentMandate` is a delegation-class authority object | Mints via `DelegationManager`; redeems via rail-specific executor |
| **PMT-6** | W1 rails: x402, wallet, sponsored userOps. Reserved: escrow, invoice, confidential | Per ADR-0024 Decision 5 |
| **PMT-7** | Mandate amount policy supports exact / range / formula | Covers fixed price (x402), variable (intent-bound), market-driven (solver-priced) |
| **PMT-8** | One-shot redemption is the default; multi-use requires explicit `maxRedemptions` | Default-safe |
| **PMT-9** | Confidential rails (PD-30) reserved as a sub-module family; not implemented W1 | Per privacy doc §8 PD-30 |

## 2. Non-goals

- **NOT a new chain or new token.** PaymentMandate is a typed authority; settlement uses existing rails.
- **NOT an EOA wallet replacement.** The mandate signer is a SA; the payer in user-rail mode is the SA.
- **NOT a custodial escrow service.** Escrow rail is an authority pattern over existing escrow contracts (W2+).
- **NOT a KYC layer.** Privacy doc §1; pseudonymous-by-default.
- **NOT a tax / accounting layer.** PaymentReceipt VCs are audit material, not bookkeeping output.

## 3. Reference: smart-agent patterns to port

Smart-agent has a minimal payment story (treasury → recipient transfers via SA UserOp). The substrate generalizes that into rail-agnostic mandates while keeping the smart-agent treasury pattern as the W1 "wallet" rail implementation. Specifically:

- **Ported as-is.** SA-as-payer; treasury-style funded SA; UserOp-bundled transfers; paymaster sponsorship for gas; ERC-1271 signature verification.
- **Ported with modification.** Smart-agent treats payment as a raw `transfer(...)` call; we wrap it in a typed `PaymentMandate` with context binding + receipt issuance.
- **Diverged.** Smart-agent has no payment-rail abstraction (only direct transfers). The substrate's rail-family pattern is novel; references x402 + AP2 + AgentKit.

## 4. The `PaymentMandate` primitive

### 4.1 Type definition

```ts
interface PaymentMandate {
  // Identity
  mandateId: Hex32;                       // keccak256(payer || nonce || rail || ...)
  payer: Address;                         // SA address of payer
  payee: Address | StealthAddressRef;     // SA address of payee, or stealth (D-45)
  granter: Address;                       // SA that signed the mandate (== payer for direct; delegator for delegated)

  // Rail
  rail: PaymentRail;                      // 'x402' | 'wallet' | 'sponsored-userop' | 'escrow' | 'invoice' | 'confidential-*' (W2)
  railConfig: RailConfigUnion;            // discriminated by rail

  // Amount policy (per-redemption)
  amountPolicy:
    | { kind: 'exact'; amount: bigint; asset: AssetRef; chain: number }
    | { kind: 'range'; minAmount: bigint; maxAmount: bigint; asset: AssetRef; chain: number }
    | { kind: 'formula'; formulaId: Hex32; maxAmount: bigint; asset: AssetRef; chain: number };

  // AP2-style aggregate constraints (orthogonal to per-redemption amountPolicy; bound over mandate lifetime)
  // Aligned to https://google.github.io/A2A/ Mandate primitive
  mandateConstraints?: MandateConstraints;

  // Replay safety + concurrency
  nonce: bigint;                          // mandate-unique
  maxRedemptions: number;                 // default 1 (one-shot)
  validFrom: number;                      // unix epoch
  expiresAt: number;                      // unix epoch

  // Context binding (PMT-3)
  contextBinding: ContextBinding;

  // Authority binding
  delegationRef?: Hex32;                  // if PaymentMandate was minted via delegation
  caveats: Caveat[];                      // ERC-7710 caveats (optional extra constraints)

  // Mode discrimination (AP2-aligned; PMT-10)
  mode: 'open' | 'closed';
  requiresClosedMandateForFinalCharge?: boolean; // valid only when mode='open'; default true

  // Audit
  reasonHash: Hex32;                      // hash of off-chain reason
  signature: EIP712Signature;             // signed by `granter`
}
```

### 4.1z Open vs Closed mandates (PMT-10 — AP2-aligned)

[Google AP2's Mandate model](https://google.github.io/A2A/) introduces a distinction the substrate adopts as load-bearing:

| Mode | Authority granted | When to use |
|---|---|---|
| **Open mandate** | "I authorize autonomous payment activity by my agent under these scope constraints" — `amountPolicy` + `mandateConstraints` bound; rail executor MAY redeem repeatedly within bounds | Background activity: x402 micro-payments, subscription tracking, agent-driven discovery + small-amount commitments |
| **Closed mandate** | "I authorize THIS specific payment to THIS specific payee for THIS specific amount" — single one-shot, frozen target | Required for FINAL CHARGE on checkout-class flows; bound to a specific `agreementCommitment` or `orderHash` |

**Hard rule (PMT-10.1) — the load-bearing safety property.** If `mode = 'open'` AND `requiresClosedMandateForFinalCharge = true` (default), then the rail executor MUST refuse to redeem the open mandate against a "final-charge" call. The rail executor identifies "final-charge" calls by:
- For `x402` rail: any 200-series response from the resource server that would be the terminal call in the resource's payment lifecycle
- For `wallet` rail: any value transfer above `mandateConstraints.maxAggregateAmount × 0.5` (heuristic; rail-config tunable)
- For `escrow` rail (W2): the escrow `release()` call specifically

In each case, redemption MUST be against a **closed-mode mandate signed for the specific transaction** — the user (or the agent under a higher authority) must produce a new mandate with `mode = 'closed'` and bound to the exact target. Open mandates cannot consummate the final transaction.

**Two-step pattern (the recommended flow):**

```
Open PaymentMandate
   │  (authorizes agent to negotiate + propose payment)
   ▼
Agent runs discovery / quoting / checkout proposal
   │
   ▼
Checkout proposal frozen (canonical price + target + items)
   │
   ▼
User receives "ready to finalize?" prompt
   │  (or agent acts under a delegated `requiresHumanConfirmationAbove` boundary)
   ▼
Closed PaymentMandate signed (specific target + specific amount + specific time window)
   │
   ▼
Rail executor consummates payment
```

**Why this matters for AI commerce.** Without the open/closed distinction, agentic systems collapse into the classic failure mode: the model "understood" that the user wanted a thing, no explicit payment boundary exists, the agent pays. With this distinction:
- An agent CAN autonomously discover, quote, propose, even prepare checkout — operating under an open mandate.
- An agent CANNOT autonomously CONSUMMATE the final charge without a closed mandate.
- The user retains an explicit confirmation point per transaction without losing the autonomous-agent UX for the inexpensive activity layers.

**Substrate invariants (PMT-INV-13 .. PMT-INV-15) — added to §9:**

| ID | Invariant |
|---|---|
| **PMT-INV-13** | Open mandate refuses final-charge by default; only closed mandate consummates |
| **PMT-INV-14** | Closed mandate is **always** one-shot (`maxRedemptions = 1`); cannot be authored as multi-redemption |
| **PMT-INV-15** | Closed mandate's `contextBinding` MUST include a frozen-proposal hash (canonical price + target + items hashed at proposal time) |

**Relationship to the AP2 stage model.** Open mode = AP2's "intent / discovery" stage. Closed mode = AP2's "checkout / finalize" stage. The substrate exposes the typed boundary; AP2 documents the UX flow that consumes the boundary. The two are compatible at the envelope level.

### 4.1a Mandate constraints (AP2-aligned aggregate scope)

The `amountPolicy` field above bounds **a single redemption**. For mandates with `maxRedemptions > 1`, AP2 (Google's Agent Payments Protocol) recommends ALSO binding **aggregate scope** so an LLM-driven agent cannot exhaust mandate authority via many small redemptions or stray outside category boundaries:

```ts
interface MandateConstraints {
  maxAggregateAmount?: bigint;            // Total value across all redemptions
  frequency?: FrequencyLimit;             // Rate limit
  categories?: string[];                  // Allowed merchant / resource categories
  excludedCategories?: string[];          // Explicit denylist
  geoFence?: string[];                    // Country / region codes
  timeOfDay?: TimeWindow[];               // E.g. business hours only
}

interface FrequencyLimit {
  maxRedemptionsPerWindow: number;
  windowSeconds: number;                  // e.g. 86400 for daily
}
```

**Why both `amountPolicy` and `mandateConstraints`.** `amountPolicy` answers "what is each redemption?" — `mandateConstraints` answers "what is the total authority I'm granting?" — these are orthogonal. An "x402 micropayment for any API" mandate has `amountPolicy.kind = 'range'` with small max + `mandateConstraints.maxAggregateAmount` capped at a daily budget. Per-redemption budget AND per-mandate budget protect against different abuse patterns.

**Hard rule (PMT-3.5).** When `mandateConstraints` is present, the rail executor MUST validate the aggregate state before redeeming. Aggregate state is tracked per `mandateId` in the rail executor's storage; ADR-0023 says nothing about it (it's a payments-rail concern, not an attestation concern).

### 4.2 Context binding (PMT-3 enforcement)

`ContextBinding` is the load-bearing safety property:

```ts
interface ContextBinding {
  // At least one of these MUST be non-null (PMT-3.1):
  intentId?: Hex32;                       // payment for fulfilling an intent
  agreementCommitment?: Hex32;            // payment under an agreement
  taskId?: Hex32;                         // payment for completing a task
  artifactHash?: Hex32;                   // payment for an artifact

  // Resource binding (PMT-3.2): for x402-rail payments, the HTTP resource
  resource?: {
    method: string;
    url: string;
    requestBodyHash: Hex32;
  };

  // Chain + asset binding (PMT-3.3):
  chain: number;
  asset: AssetRef;

  // Nonce + expiry binding (PMT-3.4):
  nonce: bigint;
  validFrom: number;
  expiresAt: number;
}
```

**Hard rule (PMT-3.1):** `contextBinding` MUST have at least one of `{intentId, agreementCommitment, taskId, artifactHash, resource}` populated. An unbound `PaymentMandate` is a substrate violation; the SDK refuses to mint, and rail executors refuse to redeem.

**Hard rule (PMT-3.2):** The EIP-712 typed-data domain of the mandate signature includes `contextBinding` in full. Tampering with any context field invalidates the signature.

**Hard rule (PMT-3.3):** A mandate is redeemable on the chain named in `contextBinding.chain` only. Cross-chain redemption requires a successor ADR.

**Hard rule (PMT-3.4):** A mandate is redeemable in `[validFrom, expiresAt]` only. Outside the window: rail executor refuses.

## 5. Payment-rail abstraction

The substrate ships W1 with three rails and reserves a registration pattern for more.

### 5.1 Rail interface

```ts
interface PaymentRailExecutor {
  rail: PaymentRail;
  verifyMandate(mandate: PaymentMandate): Promise<MandateValidity>;
  prepareRedemption(mandate: PaymentMandate, context: RedemptionContext): Promise<RedemptionPlan>;
  executeRedemption(plan: RedemptionPlan): Promise<RedemptionReceipt>;
  cancelMandate?(mandateId: Hex32, granter: Address): Promise<void>;
}
```

Each rail is a separate sub-module:
- `@agenticprimitives/payments/rails/x402`
- `@agenticprimitives/payments/rails/wallet`
- `@agenticprimitives/payments/rails/sponsored-userop`

Future rails register the same interface:
- `@agenticprimitives/payments/rails/escrow` (W2)
- `@agenticprimitives/payments/rails/invoice` (W2)
- `@agenticprimitives/payments/rails/confidential-*` (W2; PD-30 family)

### 5.2 x402 rail (W1)

**Pattern.** HTTP-native payment per [x402.org](https://www.x402.org/). Server returns 402 Payment Required with mandate requirements; client mints a `PaymentMandate` with `contextBinding.resource` populated; client retries request with mandate in `X-PAYMENT` header; server verifies, calls facilitator, settles, then serves the resource.

**Substrate divergence.** x402 default is EOA-payer with raw signature. We require:
- **SA-payer** signing via ERC-1271 (not EOA).
- **`contextBinding` populated** with the exact HTTP method/url/requestBodyHash.
- **Replay nonce** in the mandate, tracked by the facilitator's nullifier store.
- **Maximum mandate validity = 5 minutes** for x402 rail (rail-config defaults).

**Facilitator role.** The facilitator verifies the mandate signature + nullifier + context binding before signaling the server. The substrate provides a reference facilitator implementation; production facilitators are app-layer.

### 5.3 Wallet rail (W1)

**Pattern.** Direct SA-to-SA transfer via UserOp. The SA executes a `transfer(...)` or `transferFrom(...)` call against an ERC-20 (or native).

**Mandate redemption flow:**
1. Solver / counterparty receives the signed `PaymentMandate` off-chain.
2. Solver constructs a UserOp from the payer SA calling the appropriate transfer method.
3. UserOp signature is the mandate signature (with sa-userop wrap per [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)).
4. Bundler submits; settlement is the UserOp execution.

**Bridge to delegation.** A `PaymentMandate` MAY be a redemption-time view over a registered `Delegation` per [ERC-7710](https://eips.ethereum.org/EIPS/eip-7710). In that case the redemption is a `redeemDelegation(...)` call against `DelegationManager.sol`, and the mandate's `delegationRef` points to the registered row.

### 5.4 Sponsored-UserOp rail (W1)

**Pattern.** Paymaster sponsors the transaction; the mandate doesn't move value, just authorizes a sponsored action. Used for: gasless onboarding, sponsored intent matching, paymaster-backed UI flows.

**Substrate role.** The mandate carries `amountPolicy.maxAmount = 0` (no value moved) + sponsor SA as `granter`. The sponsor's paymaster contract validates the mandate at `validatePaymasterUserOp(...)` time.

### 5.5 Rails W1.5 — general-purpose payment surface

x402 (§5.2) ships per-use metering, but a mature payment package also ships direct/invoice pay, escrow + refunds, recurring, and splits. These are **not new wire protocols** — each is the same `PaymentMandate` + `PaymentRailExecutor` (§5.1), reusing the closed-mandate one-shot model (§4.1z) and producing the same `PaymentReceipt` (§7). Evidence symmetry: every leg — charge, refund, split, escrow release — is an audit-equal receipt (273 EXC-D3). Cross-ref [spec 272](272-x402-pay-per-use.md) (x402 wire, anonymity tiers, entitlements) and [spec 273](273-value-exchange-consideration.md) (exchange-leg doctrine).

- **Wallet rail (now built, was §5.3 W1).** `buildWalletTransferPlan(mandate)` → a single ERC-20/native `transfer` from the payer SA for a **closed** mandate (no budget delegation, no 402 round-trip). This is plain "checkout" pay. Nullifier + receipt identical to x402. The smart-agent `PledgeRegistry` cryptographic rail (atomic `executeBatch([transfer, recordHonor])`) is the port.

- **Invoice rail (new).** A push (request-for-payment) artifact, Request-Network pattern, no protocol dependency:
  ```ts
  interface Invoice {
    invoiceId: Hex32; issuer: Address; payTo: Address;     // payTo MAY differ from issuer (treasury)
    lineItems: { description: string; amount: bigint }[];
    amount: bigint; asset: AssetRef; dueAt: number;
    memoHash: Hex32;                                        // memo body in vault
    orderHash?: Hex32;                                      // links to an ExchangeOrder (273/274)
  }
  ```
  `buildInvoice(input)` → issuer signs; `payInvoice(invoice, payer)` derives the closed mandate bound to `invoiceId`/`orderHash`, settles via the wallet rail; the receipt links invoice ↔ settlement. Payment-detection (§reconciliation) resolves "is this invoice paid?" from receipts, never `eth_getLogs` ([ADR-0012](../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md)).

- **Escrow rail (new, over `PaymentEscrow.sol`).** Hold-and-capture for an order. States: `held → captured | refunded | reclaimed`. Flow keyed by `orderHash`:
  1. `deposit(orderHash, asset, amount, payee, refundTo, expiry)` — payer funds the hold.
  2. `release(orderHash)` — payee (or an authorized releaser) captures on fulfillment evidence.
  3. `refund(orderHash)` — payer-initiated before capture, payee-consented.
  4. `reclaim(orderHash)` — payer reclaims after `expiry` with no release.
  Symmetric-escrow doctrine (273 EXC-D4): any escrowable leg can be held, not just the buyer's. Hash-only events; fail-closed; no third-party escrow dependency (port patterns from Coinbase Commerce + smart-agent `CommitmentRegistry` only).

- **Recurring profile (a mandate *pattern*, not a rail; PMT-10).** `buildRecurringTemplate({ amountPerPeriod, frequency, totalCap, validUntil })` → an **open** mandate (§4.1z) carrying `MandateConstraints.frequency` (§4.1a). `deriveScheduledCharge(template, period)` → a **closed** per-charge mandate for the current window. The `PaymentEnforcer`'s on-chain frequency window already enforces "one charge per period" + the aggregate cap — no new enforcer. Stripe-MPP `session` is the reserved richer form (§5.6).

- **Refunds (a reverse leg, no enforcer).** `buildRefund(receipt)` → a `transfer` payee→payer carrying `provenance: { refunds: originalMandateId }`; emits its own `PaymentReceipt` (audit-equal, EXC-D3). No caveat needed — the treasury custodian signs the reverse leg directly. Refunds attach to wallet/invoice/escrow/split receipts, never to a metered x402 stream mid-flight.

- **Splits (app-triggered payout fan-out).** `buildSplitPayout(receipt | amount, recipients[{ to, bps }])` → N `transfer` plans from the treasury, `bps` summing to 10000 (Seaport recipient-specific-consideration pattern). Each payout leg is its own receipt. Connected-account onboarding / KYB stays app/provider layer (ADR-0037).

- **Ops core.** Every mature stack needs: an idempotent event model (`payment.created|reserved|settling|settled|failed|refunded|expired|disputed|entitlement.issued|entitlement.consumed`), a webhook-style subscriber interface (in-process for W1, app-delivered later), reconciliation helpers (`listReceiptsBy*`, balance-delta assertion, a payment-detection query object), and CSV/JSON receipt export for treasury/accounting.

### 5.6 Reserved rail/profile families (adapters, not kernel changes)

These are **adapter families** registered behind the same `PaymentRailExecutor` / mandate envelope — they do **not** change the exchange kernel or the x402 wire. Spec + feature-analysis only in this wave (no W1 build):

- **x402 `upto`** — usage-based final amount (cap at sign, settle ≤ cap).
- **x402 `batch-settlement` / voucher-channel** — high-frequency micropayment aggregation.
- **MPP-like `session`** — Stripe/Tempo machine sessions over stablecoin/card/bank rails (a richer recurring/metered profile).
- **Streaming rail** — Superfluid/Sablier continuous streams + vesting; on-chain hook is a windowed draw-down enforcer.
- **Swap-to-pay** — Coinbase-Commerce-style multi-asset settle (pay in asset X, treasury receives asset Y).
- **CCTP V2 cross-chain** — Circle native USDC burn/mint + fast-transfer hooks for cross-chain treasury moves.
- **Fiat / ACP / Merchant-of-Record** — Stripe ACP fiat checkout, Paddle/Lemon-Squeezy tax+chargeback operating model; app/provider layer, not Ring-0.

## 6. Privacy posture

Per privacy doc Layer 9b:

| Field | Default tier |
|---|---|
| `mandateId` | Visible to indexer for nullifier tracking only |
| `payer` | Visible on chain for non-confidential rails |
| `payee` | Visible on chain for non-confidential rails |
| `amount` | Visible on chain for non-confidential rails |
| `asset` | Visible on chain for non-confidential rails |
| `reasonHash` | Hash only; reason body in vaults |
| `contextBinding.intentId` | Inherits intent visibility |
| `contextBinding.agreementCommitment` | Hash only (commitment-anchored per spec 241) |
| `contextBinding.taskId` | Inherits task visibility (typically vault-only) |

**Confidential rail family (PD-30, W2+).** Reserved for Aztec-style, Zcash-style, ZK paymaster rails where payment graph is concealed. Mandate envelope is the same; rail executor + receipt format differ.

**Stealth-address support (D-45).** Payee can be a stealth address derived for the specific payment. Payer's canonical SA still appears (for non-confidential rails); payee unlinkability is one-sided. Bilateral stealth requires confidential rails.

## 7. PaymentReceipt credential type

Per ADR-0023, every successful redemption produces a `PaymentReceipt` VC asserted into `AttestationRegistry`:

```ts
interface PaymentReceipt {
  '@context': ['https://www.w3.org/ns/credentials/v2', ...];
  type: ['VerifiableCredential', 'PaymentReceipt'];
  issuer: SAAddress;                      // the rail executor's SA
  validFrom: ISODate;
  credentialSubject: {
    id: SAAddress;                        // payer SA
    mandateId: Hex32;
    rail: PaymentRail;
    payee: Address | StealthAddressRef;
    amount: bigint;
    asset: AssetRef;
    chain: number;
    contextBindingHash: Hex32;            // hash of the binding (not the binding itself)
    settlementHash: Hex32;                // tx hash or off-chain settlement ID
    settlementEpochBucket: number;
  };
  credentialStatus?: { ... };             // not used; receipts are immutable
  proof: Eip712Signature2026;
}
```

`PaymentReceipt` is asserted to `AttestationRegistry` with `credentialType = keccak256("PaymentReceipt")`. Per ADR-0023 composability table, this is **immutable** (neither party can revoke; settlement is final).

## 8. SDK surface (`@agenticprimitives/payments`)

```ts
// Mandate construction
export function buildPaymentMandate(params: PaymentMandateInput): UnsignedPaymentMandate;
export function signPaymentMandate(unsigned: UnsignedPaymentMandate, signer: SaSigner): PaymentMandate;
export function verifyPaymentMandateSignature(mandate: PaymentMandate, publicClient: PublicClient): Promise<boolean>;

// Rail registry
export function registerRail(executor: PaymentRailExecutor): void;
export function getRail(rail: PaymentRail): PaymentRailExecutor;

// Redemption
export async function redeemPaymentMandate(
  mandate: PaymentMandate,
  context: RedemptionContext,
): Promise<RedemptionReceipt>;

// Receipt
export function buildPaymentReceiptCredential(receipt: RedemptionReceipt): UnsignedReceiptVC;
export async function assertPaymentReceipt(vc: SignedReceiptVC, attestationClient: AttestationClient): Promise<Hex32 /* uid */>;

// Rails (sub-modules, each a separate import path)
// '@agenticprimitives/payments/rails/x402'
// '@agenticprimitives/payments/rails/wallet'
// '@agenticprimitives/payments/rails/sponsored-userop'
```

## 9. Invariants (PMT-INV-01 .. PMT-INV-12)

| ID | Invariant | Enforcement |
|---|---|---|
| **PMT-INV-01** | `contextBinding` has at least one populated reference | SDK refuses to mint; rail executor refuses to redeem |
| **PMT-INV-02** | Mandate signature covers full `contextBinding` (no field-strip attack) | EIP-712 typed-data structure |
| **PMT-INV-03** | Mandate is redeemable only on `contextBinding.chain` | Rail executor checks chain ID |
| **PMT-INV-04** | Mandate is redeemable only in `[validFrom, expiresAt]` | Rail executor checks |
| **PMT-INV-05** | Mandate is one-shot by default; `maxRedemptions > 1` requires explicit signer authorization | Nullifier store per rail |
| **PMT-INV-06** | Replay across rails is impossible (nullifier scoped to rail + mandateId) | Per-rail nullifier store |
| **PMT-INV-07** | Cross-asset substitution is impossible (`asset` is in the binding) | Signature covers asset |
| **PMT-INV-08** | Cross-payee substitution is impossible (`payee` is in the binding) | Signature covers payee |
| **PMT-INV-09** | x402-rail mandates have `contextBinding.resource` populated | x402 executor enforces |
| **PMT-INV-10** | Sponsored-userop mandates have `amountPolicy.maxAmount = 0` | sponsored-userop executor enforces |
| **PMT-INV-11** | `PaymentReceipt` is immutable (no revocation entrypoint) | Per ADR-0023 composability table |
| **PMT-INV-12** | Mandate signed by SA via ERC-1271 (no raw EOA signatures) | Verifier uses ERC-1271 only |

## 10. Test scenarios (PMT-T-01 .. PMT-T-10)

1. **PMT-T-01** — Build + sign + verify a wallet-rail mandate; redeem; check `PaymentReceipt` asserted.
2. **PMT-T-02** — Build x402-rail mandate; serve from facilitator; redeem; replay attempt fails (PMT-INV-05).
3. **PMT-T-03** — Cross-chain replay attempt fails (PMT-INV-03).
4. **PMT-T-04** — Cross-asset substitution attempt fails (PMT-INV-07).
5. **PMT-T-05** — Cross-payee substitution attempt fails (PMT-INV-08).
6. **PMT-T-06** — Expired mandate cannot be redeemed (PMT-INV-04).
7. **PMT-T-07** — Mandate without `contextBinding` cannot be minted (PMT-INV-01).
8. **PMT-T-08** — Sponsored-userop mandate moves no value but sponsors a UserOp (PMT-INV-10).
9. **PMT-T-09** — Multi-redemption mandate redeems `maxRedemptions` times; nullifier rejects N+1 (PMT-INV-05).
10. **PMT-T-10** — `PaymentReceipt` cannot be revoked by payer, payee, or issuer (PMT-INV-11; ADR-0023 D-18).

## 11. Implementation order

1. **PMT-IO-01** — Typed `PaymentMandate` + `ContextBinding` + EIP-712 domain.
2. **PMT-IO-02** — SDK: build, sign, verify.
3. **PMT-IO-03** — Rail interface + registry.
4. **PMT-IO-04** — Wallet rail (smart-agent treasury pattern adapted).
5. **PMT-IO-05** — x402 rail + reference facilitator.
6. **PMT-IO-06** — Sponsored-userop rail.
7. **PMT-IO-07** — `PaymentReceipt` VC issuance + assertion path (depends on spec 242 attestation client).
8. **PMT-IO-08** — Integration tests against spec 239 intent flow (intent → mandate → fulfillment).
9. **PMT-IO-09** — Integration tests against spec 241 agreement flow (agreement → mandate → status update).
10. **PMT-IO-10** — Privacy regression suite (D-46 vault residency: receipt's reason body never crosses to public registry).

## 12. Drift acknowledgments

- **Confidential rail family (PD-30).** Reserved as sub-module path family; not implemented W1. W2 wave.
- **Stealth-address payee (D-45).** Supported in `payee` type union; full bilateral stealth requires confidential rails.
- **Cross-chain redemption.** PMT-INV-03 forbids; cross-chain payment flows require a successor ADR + bridge-aware mandate envelope.
- **Recurring mandates.** `maxRedemptions > 1` supports basic recurring use cases; sophisticated subscription / streaming patterns ([Sablier-style](https://sablier.com/)) deferred.
- **Mandate revocation before expiry.** Optional `cancelMandate(...)` per rail; not all rails support it (x402 facilitator can; wallet rail cannot since redemption is owner-driven).

## 13. Open questions (L-23 .. L-25)

- **L-23.** Should `PaymentMandate` be representable as an on-chain registered delegation row (ERC-7710) by default, or off-chain by default? Current W1 default: off-chain, registered only when revocability requires it. Revisit when delegation registry surface stabilizes.
- **L-24.** Should the substrate ship a canonical FormulaSpec for `amountPolicy.kind = 'formula'`, or leave it as opaque bytes for app-defined formulas? Lean: opaque bytes W1; standardize selected formulas (e.g., quote-based pricing, Dutch auction) in W2.
- **L-25.** Cross-rail receipt composition: if a payment uses x402 + paymaster sponsorship together, do we issue one PaymentReceipt or two? Lean: one composite receipt with rail = 'x402+sponsored'. Defer to W2.

## 14. Related

**Spine docs:**
- [coordination-substrate.md](../docs/architecture/coordination-substrate.md) Layer 9b
- [privacy-and-self-sovereign-identity.md](../docs/architecture/privacy-and-self-sovereign-identity.md) §4 Layer 9b, PD-30
- [ADR-0024](../docs/architecture/decisions/0024-intent-coordination-substrate.md) Decision 5 (W1 scope fence)
- [ADR-0023](../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) PaymentReceipt composability table

**Sibling specs:**
- [239 — intent marketplace](./239-intent-spine.md) — produces `intentId` for context binding
- [241 — agreement registry](./241-agreement-commitment-registry.md) — produces `agreementCommitment` for context binding
- [242 — verifiable credentials + attestations](./242-trust-credentials-and-public-assertions.md) — `PaymentReceipt` envelope
- [244 — fulfillment](./244-fulfillment.md) — produces `taskId` + `artifactHash` for context binding
- [273 — value exchange](./273-value-exchange-consideration.md) — payment is the `monetary` consideration-leg executor; agreements may carry non-monetary legs (barter) that never touch this package

**Industry references:**
- [x402 — HTTP-native Agent Payments](https://www.x402.org/)
- [Coinbase AgentKit](https://docs.cdp.coinbase.com/agentkit/welcome)
- [Google AP2 (Agent Payments Protocol)](https://google.github.io/A2A/)
- [ERC-7710](https://eips.ethereum.org/EIPS/eip-7710) — Smart Contract Delegation
- [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715) — Grant Permissions from Wallets
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) — Account Abstraction
- [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792) — Wallet Call API
