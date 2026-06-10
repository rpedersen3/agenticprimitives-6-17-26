# 05 — Paymasters, bundlers, relayers & gas abstraction

**Focus area:** making transactions invisible or sponsored — ERC-4337 bundling, verifying/ERC-20 paymasters, relayer APIs, EIP-7702 tooling.
**AP packages in scope:** `contracts` (`SmartAgentPaymaster.sol`), `agent-account` client helpers, production deploy operations.
**AP capability today:** verifying paymaster (full-UserOp + chainId + EntryPoint replay binding, KMS-signed sponsorship signatures), allowlist fallback, governance pause gate.
**Known gaps (from contract audits):** governance staticcall in validation violates ERC-7562 (compliant bundlers may drop sponsored ops); paymaster deposit drainable by `Ownable` owner without timelock; empty `_postOp` = no per-sender spend accounting.

> Gap layers: `[Contracts]` Solidity surface · `[SDK]` TS packages/backends · `[UX]` product surface (**deferred**). See [index](index.md#gap-layers-every-gap-is-classified-into-exactly-one).

---

## Category verdict at a glance

| Product | Type | Tags | Verdict |
| --- | --- | --- | --- |
| Pimlico / permissionless.js / Alto | Commercial + OSS | PAYMASTER AA | **Integrate** (primary infra candidate) |
| Alchemy Gas Manager / Bundler | Commercial | PAYMASTER AA POLICY | Integrate (compat) + adopt policy UX |
| Biconomy Paymasters | Commercial | PAYMASTER AA | Track |
| Gelato Gasless / Relay | Commercial | PAYMASTER RELAY AA | Integrate option (chain coverage, EIP-7702) |
| ZeroDev Paymasters | Commercial | PAYMASTER AA | Track |
| Stackup | Commercial | PAYMASTER TREASURY | Track (finance ops reference) |
| Candide | OSS/service | PAYMASTER AA | Track (OSS conformance reference) |
| thirdweb Engine | Commercial | PAYMASTER RELAY AA | Track |

---

## Deep dives — primary overlap products

### Pimlico (permissionless.js, Alto bundler) — integrate

- **Identity:** the leading independent ERC-4337 infra provider; OSS tooling (permissionless.js TS library, Alto bundler) + commercial bundler/paymaster APIs.
- **Feature inventory:** hosted bundler with high reliability; verifying paymaster + ERC-20 paymaster (pay gas in tokens); sponsorship policies (per-app limits); permissionless.js — the de-facto TS standard for 4337 account interaction; multi-chain coverage.
- **Overlap with AP:** `SmartAgentPaymaster` duplicates the verifying-paymaster role; `agent-account` client helpers overlap permissionless.js account actions.
- **AP lacks:**
  - `[Contracts]` ERC-20 gas-payment paymaster variant; ERC-7562-compliant validation (current violation).
  - `[SDK]` bundler-client integration parity with permissionless.js; reliability SLAs; mempool/reputation handling discipline.
  - `[UX]` (deferred) sponsorship policy dashboard with per-app/user budgets.
- **Pimlico lacks:**
  - `[Contracts]` identity-aware sponsorship (decisions keyed to Smart Agent identity/custody tier/delegation context).
  - `[SDK]` audit-evidence trail binding sponsorship to delegations.
- **Verdict:** integrate — keep `SmartAgentPaymaster` for identity-aware sponsorship decisions but make it bundler-compatible (fix ERC-7562) and support Pimlico-style infra as transport. AP must never become a bundler company.

### Alchemy Gas Manager — integrate compat + adopt patterns

- **Feature inventory:** gas sponsorship policies (spend rules per app/user/time), bundler API with HA, dashboard for budgets/alerts, integrated with Account Kit.
- **AP lacks:**
  - `[SDK]` declarative sponsorship spend rules + budget telemetry API (policy is currently code/config).
  - `[UX]` (deferred) the operator-facing policy dashboard.
- **Verdict:** support Alchemy-compatible interfaces; adopt the policy/limits UX for the AP operations console (FG-OPS-1).

### Gelato Gasless / Relay — integrate option

- **Feature inventory:** sponsored transactions across 50+ chains, ERC-4337 + EIP-7702 support, relayer APIs with SLA, private RPC, rollup-as-a-service.
- **AP lacks:**
  - `[Contracts]` EIP-7702 story (delegating EOAs into smart-account behavior — relevant for onboarding existing EOA users as Smart Agent custodians).
  - `[SDK]` chain coverage breadth.
- **Verdict:** integration option; track EIP-7702 closely — it changes the "external EOA custodian" onboarding path.

---

## Compact entries

| Product | Overlap with AP | AP lacks | Verdict |
| --- | --- | --- | --- |
| Biconomy | Sponsorship UX | Multichain gasless breadth | Track |
| ZeroDev Paymasters | Kernel-adjacent sponsorship | — (only relevant if Kernel interop lands) | Track |
| Stackup | Paymaster + finance ops | Spend accounting/accounting export around sponsorship | Track (09) |
| Candide | OSS 4337 stack | Conformance test reference | Track |
| thirdweb Engine | Server-side tx API | Managed relay backend ergonomics | Track |

---

## Focus-area gap rollup — by layer

### `[Contracts]` gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| ERC-7562-compliant validation (move pause out of validation storage reads) | Pimlico/Alto, all compliant bundlers | FG-SEC-10 | **P0** (blocks sponsored ops in prod) |
| Paymaster owner = governance timelock; deposit withdrawal protections | (internal audit PM-2) | FG-SEC-11 | P0 (deploy ceremony item) |
| Per-sender spend budgets + `_postOp` accounting (anti gas-griefing) | Alchemy Gas Manager | FG-PM-1 | P1 |
| ERC-20 gas payment option | Pimlico, Biconomy | FG-PM-2 | P2 |
| EIP-7702 support for EOA-custodian onboarding | Gelato, MetaMask | FG-STD-3 | P2 |

### `[SDK]` / package gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| Declarative sponsorship rules + budget telemetry API | Alchemy Gas Manager | FG-OPS-1 (part) | P1 |
| Bundler-client integration parity (permissionless.js-grade) | Pimlico | FG-PM-3 | P1 |

### `[UX]` gaps — **deferred (recorded, not current focus)**

| Gap | Evidence |
| --- | --- |
| Sponsorship policy dashboard (budgets, alerts, per-app rules) | Alchemy, Pimlico |

**Substrate advantages to preserve:** identity-aware sponsorship (the paymaster can key decisions to Smart Agent identity + delegation context — no generic paymaster can); replay-hardened sponsorship signatures; governance pause integration (once 7562-compliant).
