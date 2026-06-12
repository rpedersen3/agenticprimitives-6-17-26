# demo-web-payment — Claude guide

## What this app is

The **x402 pay-per-use** demo (spec 272). One story end-to-end:

> A reader Person Smart Agent pays USDC into a provider's treasury Smart Agent
> to access a priced service — each charge gated on-chain by the
> `PaymentEnforcer`.

Wallet-only (no passkey): the connected wagmi wallet custodies the reader SA,
signs the payment delegation, and submits the redemption tx. Person deploys are
gasless via demo-a2a `direct-deploy`.

## The flow (4 steps, `src/App.tsx`)

1. **Deploy personas** — reader SA (wallet custodian) + provider treasury SA
   (ephemeral demo EOA custodian) via `lib/personas.ts` → `deploy-person`.
2. **Fund** — `MockUSDC.mint(readerSA, …)` (permissionless faucet).
3. **Approve budget** — reader signs ONE OPEN payment delegation
   (`buildPaymentMandateCaveats`: PaymentEnforcer + timestamp/targets/methods,
   per-charge + session caps, treasury-scoped) → repeated capped charges.
4. **Access + pay** — `x402.buildRedemptionCalldata` → wallet submits
   `DelegationManager.redeemDelegation`; the DM runs the PaymentEnforcer and
   moves USDC reader → treasury. Receipt = settlement tx hash + balance delta
   (no `eth_getLogs` — ADR-0012).

## Doctrine pinned here

- **OPEN delegate (`0xa11`) is a demo simplification.** Production x402 scopes
  `delegate` to the *service* SA, which redeems via its own sponsored UserOp
  (spec 272 PAY-DEL-1). The PaymentEnforcer still fully gates every charge.
- Live substrate (Base Sepolia, deployed 2026-06-02), pinned in `src/config.ts`:
  PaymentEnforcer `0xAF4827…`, MockUSDC `0x8fb56f…`, ReceiptRegistry `0x366616…`.
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
