# Spec 272 — x402 Pay-Per-Use for Licensed Scripture (lbsb)

**Status:** Drafted (2026-06-11).
**Owns:** The x402 *rail executor* + *pay-per-use gate* that turn the spec-243 `PaymentMandate` primitive into a working per-access payment for a priced A2A skill. Spec 243 defines the mandate; **this spec defines how it settles and gates content**.
**Architecture-of-record:** [ADR-0024](../docs/architecture/decisions/0024-intent-coordination-substrate.md) (the spine, payments = Layer 9b).
**Companion specs:** [243](./243-payments.md) (PaymentMandate primitive + rail abstraction), [269](./269-a2a-async-transport.md) (A2A task transport — the gated skill), [270](./270-del-001-session-binding.md) (connection-agnostic session/delegation binding — the payment delegation is minted the same way), [244](./244-fulfillment.md) (task lifecycle states), [266/267](./266-content-primitives.md) (the scripture corpus being gated), [273](./273-value-exchange-consideration.md) (value exchange — this flow is the single-monetary-leg degenerate case; money is one consideration type).
**Consumer doc:** `docs/a2a-platform-requirements.md` / `docs/corpus-entitlements-consumer-spec.md` (Bible Explorer + lbsb side).

---

## 0. Why this spec exists

A connected reader who calls the **licensed BSB (lbsb)** scripture A2A service from the Bible Explorer must pay a small per-use **x402** fee — USDC moves from the reader's Smart Account to the lbsb treasury SA, gated on-chain, with no third-party facilitator. Spec 243 shipped the `PaymentMandate` primitive (typed, context-bound, rail-agnostic) but **no x402 executor, no HTTP wire helpers, and no on-chain payment enforcer**. This spec fills exactly those gaps and wires them into the A2A skill lifecycle, the connect-time delegation, and the contracts.

It is **pay-per-use, complementary to the grant-based entitlement model** — either gate can satisfy lbsb (D1).

## 1. Decisions (locked 2026-06-11)

| ID | Decision | Rationale |
|---|---|---|
| **X402-D1** | **Prepay → time-boxed entitlement.** One x402 charge mints a short-lived entitlement (window + read budget). Entitlement and x402 **coexist**: an existing grant OR a live prepaid entitlement satisfies the gate. Configurable per service. | Cheapest UX, fewest on-chain settlements; doesn't strand the existing entitlement model. |
| **X402-D2** | **Delegation-native settlement first.** Settle via `DelegationManager.redeemDelegation(paymentDelegation, USDC.transfer(treasury, amount))` gated by the new `PaymentEnforcer`. **No external facilitator.** EIP-3009 `transferWithAuthorization` interop for external Coinbase-x402 clients is a **deferred phase** (Wave 5), not Wave 1. | Consistent with the whole delegation-native stack; smart-agent has no EIP-3009 either. |
| **X402-D3** | **Flat per-call price.** One fixed USDC amount per access (`AmountPolicy: 'exact'`). | Simplest enforcer + binding; per-passage / per-token reserved as `AmountPolicy` future. |
| **X402-D4** | **Service-sponsored settlement.** The lbsb scripture service relayer submits the redemption UserOp; gas sponsored by `SmartAgentPaymaster`. Reader needs no ETH and no extra signature per charge. | Best UX; reuses the existing paymaster substrate. |
| **X402-D5** | **Per-session USDC budget + frequency cap.** At connect the reader approves e.g. "$1 this session, ≤20 charges/hour" → one **payment delegation** carrying a spend cap + windowed redemption cap. | One up-front consent, no per-micro-charge popups; the cap is contract-enforced. |

| **X402-D6** | **Conform to x402 v2 wire + the a2a-x402 extension** (added 2026-06-11 after best-practice review). HTTP transport uses the v2 headers `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` (base64 JSON; the v1 `X-PAYMENT`/`X-PAYMENT-RESPONSE` names are dead), CAIP-2 network ids (`eip155:84532`, not `84532`), and the standard `accepts: PaymentRequirements[]` shape. Our delegation-native settlement is published as a **scheme variant** (`scheme: 'exact'`, `extra.assetTransferMethod: 'erc7710-delegation'`, mandate template in `extra`) so a Wave-5 Coinbase-interop entry is just a second `accepts` element (`assetTransferMethod: 'eip3009'`) — no wire break. A2A tasks do NOT get a new task state: per a2a-x402 v0.2 the task parks in the existing `input-required` state with `x402.payment.status` metadata. | Interop is free now, a migration later; facilitator-less direct settlement is explicitly allowed by the x402 spec provided we implement duplicate detection (= PAY-RAIL-4). |
| **X402-D7** | **Anonymity-optional, not anonymity-driven** (added 2026-06-11). The default flow is the persistent-pseudonymous reader SA (privacy doctrine: pseudonymous-by-default, identified-by-explicit-credential). Anonymity is an **alternative flow** reserved in the design from day one — see §10 — never a Wave-1 build and never a constraint that complicates the default path. Three shape rules are locked NOW so anonymity lands later with zero wire/contract breaks: (1) **the entitlement is the anonymity boundary** — the gate validates an entitlement, never a payer identity; (2) **the contract layer is identity-blind** — `PaymentEnforcer` keys on `[delegator][delegationHash]`, valid for any SA incl. nameless and ERC-5564 stealth sub-accounts; (3) **entitlement binding mode is an extension field** — `binding: 'sa' \| 'bearer'`, Wave 1 ships `'sa'` only. | Most users don't need anonymity; the ones who do must not force a redesign. Mirrors the D-44 / D-45 / PD-30 reserved-slot pattern in `docs/architecture/privacy-and-self-sovereign-identity.md`. |
| **X402-D8** | **Payment rides outcomes; it is never the outcome** (added 2026-06-11). The spine (ADR-0024) stays primary: intent → agreement → fulfillment → **outcome/entitlement**. There is **one access lane** — the gate decides on {grant OR live entitlement}; an x402 charge is just one *mint path* for an entitlement, bound to a fulfillment milestone, never a parallel access lane and never the central object. Concretely: (1) the customer-visible product is the entitlement/outcome, the charge is a Layer-9b event attached to it; (2) every settlement records WHICH milestone/resource it paid for (`resourceHash`, `taskId`, `entitlementId` in the receipt) — payment evidence cites fulfillment, not vice-versa; (3) intent supplies the spend rail: the connect-time payment delegation (X402-D5) is the reader's *intent-scoped budget*, and charges are closed mandates derived under it; (4) finality policy is content-shaped — settle-before-serve for static licensed content; reserve → fulfill → settle reserved as a later mode for expensive generation. | Legacy commerce makes payment the central outcome; we make customer outcomes central and payment an evidence-bearing event on the milestone. Keeps the same primitives reusable for any paid skill, compute job, or treasury flow. |
| **X402-D9** | **Staged executor + immutable quote + first-class receipts** (added 2026-06-11 after external design review). (1) The rail executor is a **multi-stage state machine** — `verify → reserve → prepare → simulate → execute → receipt` — because those stages fail differently and need distinct telemetry/idempotency handling; (2) the 402 carries a **`PaymentQuote`** (`quoteId`, scheme, network, asset, payTo, amount, resource, nonce, expiry) and the quote is **immutable**: the service persists `taskId → quoteId → resourceHash → amount → payee` and a retry MUST match it — no silent re-pricing; (3) **receipts are durable first-class data** (PAY-CON-4 upgraded from optional → required): a signed `PaymentReceipt` + hash-only on-chain `PaymentSettled` event powering charge history, treasury views, entitlement minting, and disputes — never just a response header. | Verification/reservation/simulation/execution have different failure + retry semantics; quote immutability kills re-pricing attacks; receipts are the audit substrate the whole repo doctrine demands. |

**Non-goals:** not a new token (test USDC); not an EOA wallet replacement (payer is the reader SA); not a generic billing system (flat per-call, one service, one asset to start); not a hosted facilitator (the service settles directly — the x402 facilitator role is collapsed into the rail executor).

## 2. Reference: smart-agent patterns to port

Per the repo rule, checked `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`). **No turnkey x402** (its `@smart-agent/payments-settlement` is "planned-not-built"), but two stateful enforcers + a mock asset are direct ports:

- **`AllocationLimitEnforcer.sol`** (`packages/contracts/src/enforcers/`) — per-tranche cumulative spend cap via `mapping(bytes32 ⇒ uint256) trancheSpent`, `asset == target` check, `args` = disburse amount. **Port:** the aggregate-spend half of `PaymentEnforcer`.
- **`RateLimitEnforcer.sol`** — windowed redemption counter, `_buckets[delegator][delegationHash][scopeKey] = {windowStart, callsInWindow}`, rolls the window on expiry. **Port:** the frequency-cap half of `PaymentEnforcer` (X402-D5).
- **`mocks/MockUSDC.sol`** — dev ERC-20 with open mint. **Port:** the fee asset (extended to EIP-3009 `transferWithAuthorization` so Wave 5 interop is a no-redeploy add).

**Deliberate divergence:** smart-agent keeps these as *two* enforcers. We **fuse** them into one `PaymentEnforcer` because an x402 mandate needs spend-cap + frequency-cap + context-binding atomically in one `beforeHook` (a payment that passes the rate limit but exceeds the budget must revert the whole redemption, not two independent caveats that can disagree).

## 3. Actors, wallets, asset

| Actor | Identity (agent-naming) | Wallet | Role |
|---|---|---|---|
| Reader | the connected user's agent | reader SA | payer |
| lbsb scripture service | `lbsb-scripture.impact` (custodied by `lbsb.impact`) | service SA | charges + serves; **delegate** of the payment delegation |
| lbsb treasury | `lbsb-treasury.impact` (custodied by `lbsb.impact`) | treasury SA | payee |
| Fee asset | test USDC (EIP-3009) on Base Sepolia (84532) | — | unit of account |

`lbsb.impact` custodies both service agents (resolvable today via agent-naming). Both are `AgentAccount`s.

## 4. The exchange (per access, X402-D1 prepay variant)

```
Explorer → lbsb A2A scripture skill (get passage / graph)
  ← 402 + PAYMENT-REQUIRED: b64{ x402Version:2, resource{url,...}, accepts:[{
            scheme:'exact', network:'eip155:84532', amount, asset:USDC, payTo:treasurySA,
            maxTimeoutSeconds, extra:{ assetTransferMethod:'erc7710-delegation',
                                       mandateTemplate{resource,nonce,expiresAt} } }] }
Reader's agent → build PaymentMandate(mode=closed, contextBinding=resource) authorized by the reader's
                 PAYMENT DELEGATION (minted at connect, X402-D5)
Explorer → retry with PAYMENT-SIGNATURE: b64{ x402Version:2, accepted, payload:{ mandate } }
  lbsb A2A → x402 executor: verifyMandate → prepareRedemption → executeRedemption
             (service-sponsored UserOp: DelegationManager.redeemDelegation(paymentDelegation,
              USDC.transfer(treasury, amount)) gated by PaymentEnforcer) → settlementHash
           → MINT a time-boxed entitlement (window + read budget, binding:'sa') [X402-D1/D7]
  ← 200 + content + PAYMENT-RESPONSE: b64{ success, settlementHash, mandateId, entitlementExpiry }
Subsequent reads within the window → served against the entitlement, NO new settlement
```

On the A2A async path the same exchange rides task metadata instead of HTTP headers (a2a-x402 v0.2): the task parks in `input-required` with `x402.payment.status:'payment-required'` + `x402.payment.required:{...}`; the client replies with `x402.payment.payload`; settlement appends `x402.payment.receipts[]` and the task resumes (X402-D6).

`ContextBinding.resource` binds the mandate to this exact request (anti-replay, PMT-3.1); `mode=closed` makes it one-shot (PMT-INV-14). The prepay entitlement (X402-D1) means subsequent reads in the window skip settlement.

## 5. Requirements — PACKAGES

### 5.1 `payments` — x402 rail executor (PAY-RAIL) — staged per X402-D9
- **PAY-RAIL-1 `verifyMandate`** — structural + signature + `assertContextBindingValid` + `assertClosedMandateInvariants`; confirm `payee == treasury SA`, `asset == USDC`, `amount ≤ maxAmount`, `chain == 84532`, not expired, nonce unused, **quote match** (mandate fields == persisted `PaymentQuote`, X402-D9), **payment delegation not revoked** (`isRevoked`, PAY-DEL-3).
- **PAY-RAIL-2 `prepareRedemption`** — build the `DelegationManager.redeemDelegation` plan: payment delegation + `USDC.transfer(treasury, amount)` execution, gated by `PaymentEnforcer`.
- **PAY-RAIL-3 `executeRedemption`** — submit as a service-sponsored UserOp (X402-D4), return `{ receiptHash, settlementHash }`; then emit/record the durable `PaymentReceipt` (X402-D9.3) referencing `mandateId`, `resourceHash`, `taskId?`, `entitlementId?`.
- **PAY-RAIL-4 idempotency** — on-chain nonce + off-chain replay cache; a redeemed `mandateId`/nonce cannot settle twice. Replay key is a rail-scoped nullifier: `hash(rail, chainId, payer, payee, asset, mandateId, nonce, resourceHash)`.
- **PAY-RAIL-5 `reserveNonce`** — BEFORE simulation/execution, reserve the nullifier off-chain (states: `unseen → reserved → settling → settled | failed_retryable | failed_terminal`). A nonce is never marked permanently consumed before tx submission outcome is known, but concurrent duplicates are blocked at `reserved`. A safe retry of an already-`settled` request returns the original receipt.
- **PAY-RAIL-6 `simulateRedemption`** — simulate the full redemption (revocation, balance, caveats, aggregate + frequency caps, nullifier) before submission. Anti-griefing controls live here: per-settlement gas cap, rate-limit on unpaid 402 retries, deny-list for repeatedly-failing payers, settlement timeout.
- Registered via the existing `registerRail({ rail: 'x402', ... })`. Lives in a new `src/rails/x402/` with the transfer method as an adapter (`exact/erc7710-delegation` Wave 1; `exact/eip3009` Wave 5; Permit2 future) — x402 concepts stay inside the rail, `PaymentRailExecutor` is the platform abstraction.

### 5.2 `payments` — x402 HTTP wire helpers (PAY-WIRE) — v2 wire (X402-D6)
- **PAY-WIRE-1 `buildPaymentRequired(quote)`** → `{ status: 402, headers: { 'PAYMENT-REQUIRED': b64 }, body }` — `x402Version: 2`, `resource{url,description,mimeType}`, `accepts: PaymentRequirements[]` with `scheme:'exact'`, CAIP-2 `network`, atomic-unit `amount` (string), `asset` address, `payTo`, `maxTimeoutSeconds`, `extra:{ assetTransferMethod:'erc7710-delegation', mandateTemplate, quoteId }`. Input is the first-class `PaymentQuote` (X402-D9.2); the same quote feeds the A2A `x402.payment.required` metadata for non-HTTP flows.
- **PAY-WIRE-2 `parsePaymentSignature(req)`** → `{ accepted, mandate } | null` (decode + validate the base64 `PAYMENT-SIGNATURE` payload; reject unknown `x402Version` / scheme / `assetTransferMethod` — fail-closed, no silent v1 fallback per ADR-0013). **Deliberate divergence from the external review:** we do NOT parse legacy `X-PAYMENT`/v1 headers, even behind config — one wire mechanism per ADR-0013; external v1 clients are out of scope until Wave 5 eip3009 interop, which is still v2 wire.
- **PAY-WIRE-3 `buildPaymentResponse(receipt)`** → `PAYMENT-RESPONSE` header (b64 `SettlementResponse`: `success`, `settlementHash`, `mandateId`, network, payer). The header is a *projection* of the durable `PaymentReceipt` (X402-D9.3), never the receipt of record.
- **PAY-WIRE-4** interop: our delegation-native payload is a registered `assetTransferMethod` variant of `scheme:'exact'`; Wave 5 adds a second `accepts` entry with `assetTransferMethod:'eip3009'` (`extra.name`/`extra.version` EIP-712 domain fields per the exact-EVM scheme spec) — same headers, same shapes, zero migration. `upto` / `batch-settlement` schemes + signed offers + SIWX proof-of-prior-payment are future `accepts[]` additions, not redesigns.
- **PAY-WIRE-5 `canonicalizePaymentResource(req | task)`** → stable `resourceHash` over {protocol, method, canonical URL/route, queryHash, bodyHash, serviceAgent SA, treasury, skillId, taskId, quoteId, asset, amount, chainId, expiry, nonce}. ONE shared helper for HTTP + A2A — workers MUST NOT hand-roll URL/body hashing. This is the security-critical object (the binding, not the amount).
- **PAY-WIRE-6 `redactPaymentMetadata`** — no licensed text, user queries, PII, or full sensitive URLs in payment descriptions, receipts, `accepts[]` metadata, or on-chain events (hashes only). Platform-level helper, not per-app discipline; companions §10 (anonymity tiers consume the same redaction guarantees).

### 5.3 `a2a` — payment-gated skills (PAY-A2A) — a2a-x402 v0.2 shape (X402-D6)
- **PAY-A2A-1** a skill descriptor may declare `payment: { rail: 'x402', price: AmountPolicy, payee }`.
- **PAY-A2A-2** invoked without a valid payment → sync RPC path returns HTTP 402 + `PAYMENT-REQUIRED` (PAY-WIRE-1); async task path parks in the **existing `input-required` task state** with message metadata `x402.payment.status: 'payment-required'` + `x402.payment.required: <PaymentRequired>` — **no new `TaskState`** (a2a-x402 keeps the A2A state machine untouched and layers payment status in metadata; granular states `payment-submitted/verified/completed/failed` live in `x402.payment.status`).
- **PAY-A2A-3** on a valid payment (`x402.payment.payload` on the resume message, or `PAYMENT-SIGNATURE` sync) → framework calls the rail executor, appends the settle response to `x402.payment.receipts[]` on the task, THEN runs the handler. The gate slots into `dispatchTask` before `handler.handle(ctx)`.
- **PAY-A2A-4** the agent-card declares the extension in `capabilities.extensions[]` (`uri: 'https://github.com/google-a2a/a2a-x402/v0.1'`) + per-skill price annotations; clients activate via the `X-A2A-Extensions` header. **Note (NEW-A2A-2 dependency):** the payment gate authenticates the payer from the *mandate signature*, never from a caller param — do not inherit the a2a `caller` pattern flagged in the 06-11 audit.
- **PAY-A2A-5 quote immutability (X402-D9.2)** — when a task enters payment-required, persist `taskId → quoteId → resourceHash → amount → payee → asset → expiry`; the retried payment MUST match the original quote or be rejected. No silent re-pricing.
- **PAY-A2A-6 payment is middleware, not handler logic** — the verify/reserve/settle/receipt sequence wraps `dispatchTask` (framework-level); skill handlers never see raw x402 wire objects, only "payment satisfied" + receipt ref. Gate decision per X402-D8: {grant OR live entitlement} first; charge only mints the entitlement.

### 5.4 `delegation` — payment-mandate caveats (PAY-DEL)
- **PAY-DEL-1 `buildPaymentMandateCaveats({ delegate, payee, asset, chainId, maxAmountPerCharge, maxAggregate, maxRedemptionsPerWindow, windowSeconds, validAfter?, validUntil, allowedSkillIds?, allowedResourcePatterns? })`** → caveat set (delegator = reader, delegate = lbsb scripture agent): `PaymentEnforcer` terms + `timestamp` (validUntil) + `allowedTargets` (USDC) + `allowedMethods` (**`transfer` only** — no `transferFrom`, see PAY-CON-1).
- **PAY-DEL-2** the reader's home mints this delegation at connect via a new `delegation_template: 'x402-pay'` (spec 270 path), scoped to treasury + USDC + spend cap (X402-D5). The open delegation is the budget; every charge is a **closed one-shot mandate derived under it** ("open budget, closed charge").
- **PAY-DEL-3** revocation: implement the **currently-stubbed** `isRevoked`/`revokeDelegation` (`onchain.ts`); revocation is checked **twice** — executor checks `isRevoked` before settling (off-chain) AND the redemption path enforces it on-chain. Never off-chain-only.
- **PAY-DEL-4 human-readable consent** — the template exposes a display object ("Allow X to charge your agent wallet? Asset / Recipient / Max per charge / Session budget / Frequency cap / Expires / Revoke anytime") — the connect UI never renders raw `delegate execute to contract X`.
- **PAY-DEL-5 no subdelegation** — payment authority is non-subdelegable by default (`allowSubdelegation: false`); future service clusters require explicit, equal-or-stricter attenuation.

### 5.5 `agent-account` — treasury + payer execution + receipts (PAY-ACCT)
- **PAY-ACCT-1** treasury is a plain `AgentAccount` (no change to receive USDC); add a `readErc20Balance` / receipts helper.
- **PAY-ACCT-2** confirm the delegate-initiated `execute(USDC.transfer(treasury, amount))` under the payment delegation + `PaymentEnforcer` works through `redeemDelegation`; add a thin `buildErc20TransferCall` helper.
- **PAY-ACCT-3** receipt views: list receipts by payer / payee / mandateId / window against `PaymentReceiptRegistry` (PAY-CON-4) — via indexer/app cache per ADR-0012, never inline log scans in hot paths.

## 6. Requirements — CONTRACTS

### 6.1 `PaymentEnforcer.sol` (PAY-CON-1) — new stateful enforcer
A sibling of `TimestampEnforcer`/`ValueEnforcer` implementing `ICaveatEnforcer.beforeHook`, fusing the smart-agent `AllocationLimit` + `RateLimit` patterns:
- decode `terms = (address treasury, address asset, uint256 maxAmountPerCharge, uint256 maxAggregate, uint32 maxRedemptionsPerWindow, uint32 windowSeconds)`; `args`/`callData` carry the transfer.
- assert `target == asset` (USDC), **selector == `transfer` ONLY** (no `transferFrom` — allowance semantics widen the attack surface for a smart-account-native payer; no `approve`; single-call execution mode only — reject batch/multicall smuggling and delegatecall), decoded `to == treasury`, `amount ≤ maxAmountPerCharge`.
- **stateful** (storage keyed `[delegator][delegationHash]`): cumulative `spent + amount ≤ maxAggregate`; windowed `callsInWindow + 1 ≤ maxRedemptionsPerWindow` (roll on expiry, port `RateLimitEnforcer`).
- bind to the mandate's `nonce`/`contextBinding` hash (passed via `args`) to prevent replay; emit `PaymentCharged(delegator, delegationHash, treasury, asset, amount, nonce)`.
- **Fail-closed:** any decode failure / cap breach / asset or target mismatch → revert (blocks the whole `redeemDelegation`).

### 6.2 Settlement path (PAY-CON-2)
Delegation-native only (X402-D2): `DelegationManager.redeemDelegation(paymentDelegation, target=USDC, value=0, data=transfer(treasury,amount))`, gated by `PaymentEnforcer` in Phase-1 `beforeHook`. No facilitator. (EIP-3009 `transferWithAuthorization` alternative → Wave 5.)

### 6.3 Fee asset (PAY-CON-3)
`MockUSDC.sol` (port smart-agent), EIP-3009-capable, open mint + a faucet path for demos. Reader + treasury `AgentAccount`s hold it. Deployed to Base Sepolia.

### 6.4 Receipts (PAY-CON-4, **required** — upgraded per X402-D9.3)
`PaymentEnforcer` emits `PaymentCharged`; PLUS a tiny `PaymentReceiptRegistry` emitting `PaymentSettled(mandateId indexed, payer indexed, payee indexed, asset, amount, resourceHash, delegationHash, nonce)` for independent treasury audit, charge history, and demo-corpus treasury views without trusting service logs. **Hashes and addresses only — no passage refs, raw URLs, queries, or text on-chain** (PAY-WIRE-6). Read paths still MUST NOT depend on receipt existence (per §10 rule 4 and ADR-0012 — apps read receipts via indexer/app cache, not inline log scans).

## 7. Consumer side (this repo, after platform ships) — §6 of the source doc
- `lbsb-scripture.impact` A2A: its `get-gated-passage` / `/vault/*` skills priced (PAY-A2A-1); the existing `verify_access` entitlement gate becomes one of two gates (x402 the other; X402-D1 coexist).
- Bible Explorer: on a 402, the reader's session uses its payment delegation to build + attach the mandate and retry (no popup); show "✓ paid 0.0x USDC → lbsb treasury" + receipt. No payment delegation → prompt to approve a session budget (mint `x402-pay`, PAY-DEL-2).
- demo-corpus / lbsb owner view: a **treasury tab** — balance, recent settlements, withdraw (reads treasury SA + receipts).

## 8. Implementation waves

| Wave | Scope | Gate |
|---|---|---|
| **W1 — contracts** | `PaymentEnforcer.sol` (stateful, fused, `transfer`-only) + `PaymentReceiptRegistry.sol` (PAY-CON-4, now required) + `MockUSDC.sol` (EIP-3009) + forge tests (cap, window, replay, asset/target/selector incl. transferFrom/approve/multicall/delegatecall rejection, fail-closed) + storage-layout snapshot + deploy to Base Sepolia; add to `deployments-base-sepolia.json` + `EnforcerAddressMap.payment`. | `pnpm check:contracts`, forge coverage floor |
| **W2 — delegation** | `buildPaymentMandateCaveats` (PAY-DEL-1) + implement `isRevoked`/`revokeDelegation` (PAY-DEL-3, double-checked) + `'x402-pay'` template + consent display object (PAY-DEL-4) + no-subdelegation default (PAY-DEL-5) + golden tests. | `pnpm check:delegation` |
| **W3 — payments** | x402 rail executor (`src/rails/x402/`, PAY-RAIL-1..6: staged verify/reserve/prepare/simulate/execute/receipt) + wire helpers (PAY-WIRE-1..6 incl. `canonicalizePaymentResource` + `redactPaymentMetadata`) + nullifier reservation store + `PaymentQuote` + unit tests (mandate verify, quote mismatch reject, redemption plan, replay reject, concurrent-duplicate reject). | `pnpm check:payments` |
| **W4 — a2a + agent-account** | skill `payment` field + `input-required` park with `x402.payment.*` metadata (no new TaskState) + 402 short-circuit (sync + async) + quote persistence (PAY-A2A-5) + payment middleware around `dispatchTask` (PAY-A2A-6) + agent-card extension declaration (PAY-A2A) + `buildErc20TransferCall`/balance/receipt-view helpers (PAY-ACCT). | `pnpm check:a2a` |
| **W5 (deferred)** | EIP-3009 `transferWithAuthorization` adapter for external Coinbase-x402 clients (D2 interop; second `accepts[]` entry, same v2 wire) + `upto`/`batch-settlement` schemes + reserve→fulfill→settle mode for expensive generation (X402-D8.4). | — |

Each wave deployed/verified before the next (contracts first — everything depends on the enforcer + USDC addresses). Consumer wiring (§7) is a separate effort in the Bible Explorer / demo-corpus repos once W1–W4 ship.

## 9. Invariants (DO NOT BREAK)
- **PMT-3 context binding** — every mandate signature binds resource + amount + payee + nonce + chain + expiry; the `PaymentEnforcer` re-checks the binding hash on-chain.
- **One-shot closed mandate** — a final charge mandate is `mode='closed'`, `maxRedemptions=1`; settled exactly once (on-chain nonce + off-chain cache, PAY-RAIL-4).
- **Fail-closed enforcer** — unknown asset/target/selector, decode failure, or any cap breach reverts the whole `redeemDelegation`.
- **Budget is contract-enforced, not UI-enforced** — `maxAggregate` + windowed cap live in `PaymentEnforcer` storage; the reader's approved budget cannot be drained beyond the mandate even by a compromised service.
- **Revocation before settle** — the executor MUST check `isRevoked(paymentDelegation)` before `executeRedemption`.
- **Payer is the SA** — the reader's `AgentAccount` is the payer; the service is only a scoped delegate, never a custodian (ADR-0019 / spec 202).
- **Identity-blind gate (X402-D7)** — the pay-per-use gate decides on {valid grant} OR {live entitlement} OR {valid payment mandate}. It MUST NOT require a name facet, identity credential, or any payer attribute beyond the mandate signature. Adding an identity requirement to the gate is a spec violation, not a config option.
- **One access lane (X402-D8)** — access is always granted by the entitlement/grant check; a charge only MINTS an entitlement. Payment must never become a second, parallel access mechanism the gate consults independently.
- **Quote immutability (X402-D9)** — a persisted quote cannot be re-priced; a payment that doesn't match its quote is rejected, never "close enough".
- **`transfer`-only calldata** — the enforcer accepts exactly `IERC20.transfer(treasury, amount)` in single-call mode; `transferFrom`, `approve`, batch/multicall, and delegatecall all revert.
- **No subdelegation of payment authority (PAY-DEL-5)** — default-off; explicit equal-or-stricter attenuation only.
- **LLMs out of the trust path** — agents/LLMs may request content and explain pricing; they never hold keys, build raw calldata, judge mandate validity, override caveat failures, or mark payments settled. All trust decisions are deterministic SDK/contract logic.

## 10. Anonymity: reserved alternative flow (X402-D7)

Anonymity does **not** drive this architecture. It is an opt-in alternative flow whose extension points are fixed now so it can be added without reshaping Waves 1–4. Not all users want it; the ones who do compose these tiers (weakest → strongest), each riding the unchanged Wave-1 substrate:

| Tier | Flow | What it reuses | What it adds (later wave) | Status |
|---|---|---|---|---|
| **A0 — default** | Persistent-pseudonymous reader SA pays; SA-bound entitlement. | Everything in §4–§6. | — | Wave 1 |
| **A1 — nameless payer** | Reader connects nameless (spec 259); payer SA has no name/credential facets. Payment graph still links SA → treasury. | Nameless connect, unchanged payment path. | Nothing — app policy only. | Available at Wave 4 |
| **A2 — stealth payer** | Payment delegation minted from an ERC-5564 stealth sub-account; canonical SA absent from the payment graph. | `PaymentEnforcer` unchanged (identity-blind, D7-2); `'x402-pay'` template takes any delegator. | Stealth derivation in `delegation`/`payments` (activates PD-29 / D-45). Funding hop is the residual leak. | Reserved |
| **A3 — bearer entitlement** | Payment settles from any SA (named, sponsor, org); the X402-D1 entitlement is minted `binding:'bearer'` — a blind-signed one-time voucher (Privacy Pass pattern) presented unlinkably per read. Decouples **who paid** from **who reads**. | The grant-OR-entitlement gate (X402-D1) as the anonymity boundary (D7-1); `binding` field (D7-3). | Blind-sign issue/verify in the entitlement mint + gate. No contract or wire change (`extra.entitlementBinding` advertised in `accepts[]`). | Reserved — first anonymity tier to build |
| **A4 — predicate gate** | Gate accepts an unlinkable presentation ("holds a valid entitlement/membership") via BBS+/SD-JWT or AnonCreds bridge; enables sponsor-paid + anonymous reader. | Same gate slot as A3. | Depends on `verifiable-credentials` D-44 proof types landing (W2+). | Reserved |

**Rules for Wave 1–4 implementers (the "factor it in" contract):**
1. The gate's decision function takes an entitlement/grant/mandate — never a reader identity. Threading a `caller`/name into the gate breaks A1–A4 (and NEW-A2A-2).
2. `PaymentEnforcer`, the `'x402-pay'` template, and the rail executor make no assumption that the delegator SA is named, credentialed, or reused across sessions.
3. The entitlement record carries `binding: 'sa' | 'bearer'` from day one; Wave 1 only ever writes `'sa'`, and the gate rejects `'bearer'` until A3 ships (fail-closed, ADR-0013 — no silent acceptance).
4. Receipts (PAY-CON-4) are required for the default flow (X402-D9.3) but per-charge registry rows are hash-only and the A2/A3 flows omit the payer-linking fields. Don't make any access/read path depend on receipt existence — receipts are audit evidence, not gates.
5. Confidential rails (PD-30, amount/party-hiding) remain out of scope for this spec; if ever needed they arrive as a sibling rail in `accepts[]`, not a change to this one.

## 11. Security test checklist (rail not "done" until these pass)

- **Mandate/context:** reject missing/wrong context binding (method, URL, bodyHash, skillId, taskId, serviceAgent, treasury), changed quote/amount/asset/chain, expired or not-yet-valid mandate, open mandate for a final charge, reused closed mandate.
- **Calldata:** reject wrong recipient/amount/token, `approve`, `transferFrom`, multicall containing extra calls, delegatecall, malformed calldata.
- **Budget:** maxAmountPerCharge / maxAggregate / frequency cap enforced; window rollover; revocation stops settlement; nonce reuse fails; same-nonce-different-resource fails.
- **Wire:** v2 headers round-trip; CAIP-2 accepted; v1 `X-PAYMENT` rejected (no legacy parse, PAY-WIRE-2); unsupported scheme/transferMethod rejected cleanly.
- **A2A lifecycle:** priced skill in agent-card; unpaid sync → 402; unpaid async → parked `input-required`; mismatched-quote retry rejected; handler never runs before settlement; receipt attached to result.
- **Privacy:** no licensed text / user queries / raw URLs in payment metadata, receipts, or on-chain events (hashes only); §10 identity-blind gate holds under all tiers.
