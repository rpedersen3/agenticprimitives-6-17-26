# 09 — Agent payments, treasury & commerce

**Focus area:** agents paying and getting paid — machine-payable APIs, agent commerce protocols, treasury funding/management, streaming/recurring payments.
**AP packages in scope:** treasury concepts in `agent-account` (treasury IS an SA address per ADR-0010), `delegation` (spend caveats), `SmartAgentPaymaster` (gas economics); intent-marketplace lineage from smart-agent branch `003-intent-marketplace-proposal`.
**AP capability today:** treasury-as-Smart-Agent (canonical address, custody tiers, spend enforcers per-call); delegated spend authority via ValueEnforcer caveats; gas sponsorship. **No payment rails, invoicing, streaming, or commerce protocol support yet.**

> Gap layers: `[Contracts]` Solidity surface · `[SDK]` TS packages/backends · `[UX]` product surface (**deferred**). See [index](index.md#gap-layers-every-gap-is-classified-into-exactly-one).

---

## Category verdict at a glance

| Product | Type | Tags | Verdict |
| --- | --- | --- | --- |
| x402 (Coinbase) | Open protocol | PAY MCP | **Integrate** (HTTP 402 machine payments) |
| Coinbase AgentKit / CDP Wallet API | Commercial + OSS | PAY WALLET AA | Compete-adjacent + interop |
| Stripe Agentic Commerce (ACP, w/ OpenAI) | Commercial + open spec | PAY | Track + interop (fiat side) |
| Google AP2 (Agent Payments Protocol) | Open spec | PAY DELEG | **Conform-watch** (mandates ≈ AP delegations) |
| Skyfire | Commercial | PAY AUTH | Track (agent KYA + spend identity) |
| Payman | Commercial | PAY POLICY | Track (agent-to-human payouts) |
| Circle (USDC, CCTP, Wallets) | Commercial | PAY VAULT | Integrate (stablecoin rails) |
| Superfluid / Sablier | OSS protocol | PAY TREASURY | Integrate option (streaming pay) |
| Safe + Den / treasury ops | OSS + commercial | TREASURY CUSTODY | Adopt patterns (see 02) |
| Request Network / Request Finance | OSS + commercial | PAY AUDIT | Track (invoicing/AP-AR) |

---

## Deep dives — primary overlap products

### x402 — integrate

- **Identity:** Coinbase-led open protocol reviving HTTP 402: per-request stablecoin micropayments for APIs/MCP tools; growing OSS middleware ecosystem.
- **Overlap with AP:** AP MCP tools are exactly the resource x402 monetizes; AP delegations scope *who may spend*, x402 settles *the payment*.
- **AP lacks:**
  - `[SDK]` x402 middleware in `mcp-runtime` (price-gated tools: 402 challenge → pay → retry); payer-side support so AP agents can consume paid APIs under spend caveats; settlement records into audit evidence.
- **x402 lacks:** authority model (any key can pay — no delegation/custody semantics); identity binding; consent provenance. AP delegation + x402 settlement is a natural composition.
- **Verdict:** integrate — "delegation-scoped x402 payments" is a differentiated combination nobody ships today.

### Google AP2 — conform-watch

- **Identity:** Agent Payments Protocol — open spec (with 60+ partners) for agent-initiated payments built on signed **mandates** (intent/cart mandates) that prove user authorization to merchants/issuers; complements A2A + MCP.
- **Overlap with AP:** AP2 mandates are conceptually AP delegations (user-signed, scoped spend authority) — but expressed as W3C-VC-style payloads in payment networks.
- **AP lacks:**
  - `[SDK]` mandate issuance/verification compat (map AP delegation + caveats → AP2 mandate shape); A2A payment-extension support.
- **AP2 lacks:** on-chain enforcement (mandates are attestations, not enforced caveats); custody tiers; canonical agent identity.
- **Verdict:** conform-watch. If AP2 wins agent-commerce, AP should be the *strongest implementation* of its mandate concept (cryptographically enforced, not just signed).

### Coinbase AgentKit / CDP — compete-adjacent + interop

- **Feature inventory:** wallet provisioning for agents (CDP Wallet API, MPC), AgentKit framework adapters (LangChain etc.), x402 integration, onramps, faucets, gasless sends.
- **AP lacks:**
  - `[SDK]` turnkey agent-wallet provisioning DX (one call → funded testnet wallet); framework-adapter breadth; fiat onramp hooks.
- **AgentKit lacks:** custody tiers/quorum recovery; delegation chains; canonical identity; open contracts (CDP custody is Coinbase infra).
- **Verdict:** compete-adjacent on agent wallets (same critique as MetaMask Agent Wallet, doc 02); interop on x402.

### Superfluid / Sablier + Request — integrate option / track

- **Streaming (Superfluid/Sablier):** continuous/vesting payment streams. AP composition: stream into an agent treasury, with delegated draw-down under caveats. `[Contracts]` AP lacks stream-aware spend enforcers; `[SDK]` stream lifecycle management.
- **Request Network/Finance:** invoicing, AP/AR, payroll on-chain with audit trails. `[SDK]` AP lacks invoice/receipt artifacts binding payments to agreements (`agreements` package is the natural anchor). Track.

---

## Compact entries

| Product | Overlap with AP | AP lacks (layer) | Verdict |
| --- | --- | --- | --- |
| Stripe ACP | Fiat agentic checkout | `[SDK]` ACP interop for fiat-side agent commerce | Track + interop |
| Skyfire | Agent spend identity (KYA) | `[SDK]` know-your-agent verification exchange | Track |
| Payman | Agent→human payouts w/ policy | `[SDK]` payout workflow patterns | Track |
| Circle | USDC/CCTP rails | `[SDK]` stablecoin treasury ops + cross-chain transfer | Integrate |
| Safe + Den | Treasury multisig ops | see doc 02 (transaction service) | Adopt patterns |

---

## Focus-area gap rollup — by layer

### `[Contracts]` gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| Cumulative/periodic spend budget enforcer (per-day/per-month caps — prerequisite for real agent payments) | AP2 mandates, MetaMask Guard Mode, (= FG-DELEG-1) | FG-DELEG-1 | **P1** |
| Stream-aware treasury enforcers (draw-down caveats) | Superfluid, Sablier | FG-PAY-4 | P3 |

### `[SDK]` / package gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| x402 integration: price-gated MCP tools + payer-side spend under caveats | x402, Coinbase | FG-PAY-1 | P1 |
| Payment ↔ audit-evidence binding (settlement records, receipts tied to agreements) | Request, x402 | FG-PAY-2 | P1 |
| AP2 mandate compat (delegation → mandate mapping; A2A payment extension) | Google AP2 | FG-PAY-3 | P2 |
| Stablecoin treasury ops (USDC, CCTP cross-chain) | Circle | FG-PAY-5 | P2 |
| Agent-wallet provisioning DX (one-call funded wallet) | Coinbase AgentKit | FG-PAY-6 | P2 |

### `[UX]` gaps — **deferred (recorded, not current focus)**

| Gap | Evidence |
| --- | --- |
| Treasury funding/top-up flows; spend dashboards | Safe, Stackup, Den |
| Invoice/payout operator surfaces | Request Finance, Payman |

**Substrate advantages to preserve:** treasury IS a Smart Agent (custody tiers + spend caveats on the same canonical address — no payment product has this); delegation-scoped spending; payments that can be bound to on-chain agreements/attestations.
