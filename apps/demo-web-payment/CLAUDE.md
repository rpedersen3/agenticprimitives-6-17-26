# demo-web-payment — Claude guide

## What this app is

The **agentic payments** demo (specs 272 + 243 §5.5) — a **tabbed multi-flow** app
exercising the whole payment surface on the live Base Sepolia substrate.

Wallet-only (no passkey). The connected wagmi wallet is the payer; for pay-per-use
it custodies the reader SA. Person deploys are gasless via demo-a2a `direct-deploy`.

## The flows (`src/App.tsx` shell + `src/flows/*.tsx`)

| Tab | File | Exercises |
| --- | --- | --- |
| Pay-per-use (x402) | `MeteredFlow` | reader SA + budget + `PaymentEnforcer` gated charges (the SA + OPEN-delegation model in `lib/x402-pay.ts`) |
| Direct / Invoice | `DirectInvoiceFlow` | `payments.wallet` rail + `payments.invoice` (request-for-payment) |
| Escrow · deliver-then-pay | `EscrowFlow` | `PaymentEscrow` hold → release+grant entitlement (pay AFTER fulfilment) / reclaim refund |
| Marketplace split | `SplitFlow` | `buildSplitPayout` bps fan-out |
| Subscription | `SubscriptionFlow` | `payments.recurring` per-period charges in-window |
| Anonymous | `VoucherFlow` | `payments.entitlement.voucher` VOPRF blind pack + double-spend |
| Ops | `OpsFlow` | `payments.ops` idempotent log + reconciliation + export |
| Intent → fulfilment | reserved | wires intent-marketplace + agreements + fulfilment (next) |

Shared state in `src/app-context.tsx` (`useApp`: wallet/gas/fund/run); styles in
`src/ui.tsx`. Non-metered flows use the **wallet EOA as payer** (direct txs, cent-
sized amounts) so testing stays ETH-cheap. F1 keeps the SA + `redeemDelegation` model.

## Doctrine pinned here

- **OPEN delegate (`0xa11`) is a demo simplification.** Production x402 scopes
  `delegate` to the *service* SA, which redeems via its own sponsored UserOp
  (spec 272 PAY-DEL-1). The PaymentEnforcer still fully gates every charge.
- Live substrate (Base Sepolia, deployed 2026-06-02), pinned in `src/config.ts`:
  PaymentEnforcer `0xAF4827…`, PaymentEscrow `0x954Ba6…`, MockUSDC `0x8fb56f…`, ReceiptRegistry `0x366616…`.
- Addresses come from `packages/contracts/deployments-base-sepolia.json`; any
  `VITE_*` overrides them.

## Key files

- `src/lib/x402-pay.ts` — fund / approve budget / access+pay / read balance.
- `src/lib/personas.ts` — reader + provider SA deploys.
- `src/lib/wallet.ts` — viem public client + wagmi→DelegationClient signer.
- `src/lib/deploy-person.ts`, `passkey.ts`, `csrf.ts`, `session-salt.ts`,
  `chain-reads.ts` — infra copied from demo-web-pro (apps don't share libs).

## Reuse / don't rebuild

`@agenticprimitives/{delegation,payments,agent-account}` own all primitives.
This app is glue only — no caveat/mandate/enforcer logic lives here.

## Running

```bash
pnpm --filter @agenticprimitives-demo/web-payment dev   # vite
pnpm check:demo-web-payment                              # typecheck
```

Needs a little Base Sepolia ETH in the wallet for the mint + redemption gas.

## Generated files (ignore)

`dist/`, `node_modules/`, `.wrangler/`.
