# 02 — Smart accounts & account abstraction

**Focus area:** ERC-4337/7579 smart accounts, module ecosystems, session keys, batching, wallet SDKs, agent wallets.
**AP packages in scope:** `agent-account`, `account-custody`, `contracts` (`AgentAccount.sol`, factory, CustodyPolicy module), `delegation`.
**AP capability today:** UUPS ERC-4337 + ERC-7579 modular `AgentAccount` (thin core; policy as modules per spec 209); multi-custodian (EOA + passkey PIA); ERC-1271/6492; own multi-sig (Safe packing ported, no runtime deps); CREATE2 factory with unified custody init.

> Gap layers: `[Contracts]` Solidity surface · `[SDK]` TS packages/backends · `[UX]` product surface (**deferred**). See [index](index.md#gap-layers-every-gap-is-classified-into-exactly-one).

---

## Category verdict at a glance

| Product | Type | Tags | Verdict |
| --- | --- | --- | --- |
| **MetaMask Agent Wallet + `mm` CLI + agent-skills** (EAP 2026-06-08) | Commercial + OSS skills | AA WALLET POLICY MCP PAY | **Compete** (agent-wallet category) + adopt patterns |
| MetaMask Smart Accounts Kit / Delegation Framework | Commercial + OSS | AA DELEG POLICY PAYMASTER | **Compete + partner** (closest conceptual overlap) |
| Safe{Wallet} / Safe{Core} | OSS + ecosystem | AA CUSTODY POLICY RECOVERY TREASURY | **Partner** (anchor, not just competitor) |
| Zodiac / Roles Modifier | OSS | POLICY DELEG TREASURY | Adopt patterns (role DSL) |
| ZeroDev / Kernel | Commercial + OSS | AA DELEG PAYMASTER POLICY | Adopt patterns (SDK simplicity) |
| Biconomy | Commercial | AA PAYMASTER DELEG WALLET | Track |
| Alchemy Account Kit | Commercial | AA PAYMASTER WALLET POLICY | Adopt patterns (reliability, ergonomics) |
| Pimlico / permissionless.js / Alto | Commercial + OSS | AA PAYMASTER | **Integrate** (see 05) |
| Gelato | Commercial | PAYMASTER AA | Integrate (see 05) |
| Stackup | Commercial | AA TREASURY POLICY PAY | Adopt patterns (finance ops) |
| Rhinestone | Commercial ecosystem | AA POLICY DELEG | **Partner** (ERC-7579 module ecosystem) |
| Etherspot | Commercial SDK | AA PAYMASTER | Track |
| thirdweb Engine / AA | Commercial | AA WALLET PAYMASTER MCP | Track |
| Particle Network | Commercial | AUTH WALLET AA PAYMASTER | Track (chain abstraction) |
| Candide | OSS/service | AA PAYMASTER | Track (standards reference) |
| Ambire | OSS wallet | AA WALLET | Track (UX reference) |

---

## Deep dives — primary overlap products

### MetaMask Agent Wallet + `mm` CLI + agent-skills — compete + adopt patterns (NEW)

- **Identity:** launched into Early Access 2026-06-08 (Consensys); self-custodial agent trading wallet driven by a CLI (`npm i -g @metamask/agentic-cli`) plus open-source skills (`MetaMask/agent-skills` on GitHub, installed via `npx skills add MetaMask/agent-skills`). GA expected summer 2026.
- **Feature inventory:** agent-specific wallet with two custody modes — **server wallet** (keys in a TEE, async signing with `pollingId`) or **bring-your-own mnemonic**; **Guard Mode** policy (spend limits, network/recipient allowlists, 24h caps, 2FA step-up for out-of-policy actions) vs **Beast Mode** (unrestricted); mandatory transaction security pipeline — Blockaid threat scanning, MEV protection, simulation (soon), with safe transactions backed up to $10k; full DeFi reach (swaps, perps, prediction markets, LP) across EVM chains, Solana, Hyperliquid; **framework-agnostic skills distribution** (Claude Code, Codex, Cursor, OpenClaw, Hermes) with structured-JSON output for LLM parsing.
- **Overlap with AP:** the single most direct *agent-wallet* competitor. Its Guard Mode policy ≈ AP CustodyPolicy tiers + caveats; server-wallet TEE custody ≈ AP `key-custody` production path; async signing model ≈ AP session signing; CLI+skills distribution overlaps how AP would expose `mcp-runtime`/`a2a` to agent frameworks.
- **AP lacks:**
  - `[Contracts]` nothing it has that AP's contracts don't — but note its security is wallet/policy-layer, not on-chain account-level (AP's custody quorum lives in the account itself).
  - `[SDK]` a first-class **CLI** (`mm`-equivalent) for agents to drive Smart Agent accounts; **framework-agnostic skills packages** distributed via the Vercel Skills registry (`npx skills add ...`) for Claude Code/Cursor/Codex/etc.; structured-JSON command output contract; an integrated threat-scan/simulation/MEV-protection pipeline (Blockaid-style) on the signing path; server-wallet async-signing ergonomics with polling.
  - `[UX]` (deferred) the onboarding mode-picker (`mm init`), Guard/Beast operating-mode selection surface.
- **MetaMask Agent Wallet lacks:**
  - `[Contracts]` canonical on-chain identity (the wallet is a trading instrument, not an identity anchor); on-chain custody quorum/trustee recovery; naming/attestation/relationship registries; delegation chains redeemable on-chain.
  - `[SDK]` delegation that spans app → MCP/A2A → on-chain with caveats + JTI replay; audit-evidence artifacts; agent-to-agent identity (A2A).
- **Verdict:** **compete** in the agent-wallet category, but the durable split is clear — MetaMask Agent Wallet is a *trading* wallet with policy guardrails; AP is an *identity + delegation substrate*. Strategic moves: (1) ship an AP agent **CLI + skills** package to match distribution (FG-SDK-1, now elevated); (2) adopt the threat-scan/simulation pipeline pattern on the signing path; (3) position AP as the identity/delegation layer that could sit *under* trading wallets rather than competing on DeFi execution. Their skills repo is the distribution-channel template to mirror.

### MetaMask Smart Accounts Kit / Delegation Framework — compete + partner

- **Identity:** commercial kit over OSS DeleGator contracts; the ERC-7710 (delegation) + ERC-7715 (permission request) reference ecosystem.
- **Feature inventory:** programmable DeleGator smart accounts; off-chain EIP-712 delegations with caveat enforcers; permission-request flows rendered in MetaMask UI; gas abstraction; session-style scoped grants.
- **Overlap with AP:** deepest in the catalog — AP's `DelegationManager` + enforcers consciously follow the DeleGator pattern; `AgentAccount` follows its upgradeable-account authorization model.
- **AP lacks:**
  - `[Contracts]` ERC-7710/7715 wire-compatibility so AP delegations are redeemable/recognizable by the reference framework's contracts.
  - `[SDK]` an ERC-7715 permission-request builder/parser; mainstream wallet distribution reach.
  - `[UX]` (deferred) wallet-rendered human-readable permission consent screens.
- **MetaMask DF lacks:**
  - `[Contracts]` custody-tier policy (T1–T6 quorum/timelock); naming/attestation registries bound to the account.
  - `[SDK]` MCP/A2A resource authorization (delegation stops at on-chain calls); audit evidence; A2A agent identity.
- **Verdict:** compete on agent-native scope; partner on standards — track ERC-7710/7715 wire compat so AP grants can be requested/rendered by mainstream wallets. Highest-leverage interop bet in the series.

### Safe{Wallet} / Safe{Core} — partner

- **Feature inventory:** battle-tested M-of-N multisig; module + guard system; transaction service (off-chain queue/sign/execute coordination); Safe Apps; recovery modules; treasury tooling; large-TVL operational credibility.
- **Overlap with AP:** `AgentAccount` multi-custodian quorum ≈ Safe owners/threshold; AP deliberately ports Safe signature packing without runtime deps.
- **AP lacks:**
  - `[Contracts]` module-ecosystem breadth + external audit/operational-maturity signals (table stakes).
  - `[SDK]` a **transaction service** — off-chain proposal queue with signature collection, simulation, and history for pending multi-custodian actions.
  - `[UX]` (deferred) treasury UI; module marketplace.
- **Safe lacks:**
  - `[Contracts]` ERC-4337-native UX (adapter-based); passkey custodians as first-class on-chain credentials; custody-tier recovery (T6 trustee lifeline).
  - `[SDK]` delegation caveats for tool access; agent identity semantics.
- **Verdict:** partner. Support "Safe as external custodian of an AgentAccount" and emulate the transaction-service pattern (FG-SDK-6).

### ZeroDev / Kernel — adopt patterns

- **Feature inventory:** Kernel modular account (most-deployed ERC-7579 account); session keys with policy scoping; one-call account creation SDK; paymaster integration; chain abstraction.
- **AP lacks:**
  - `[SDK]` SDK simplicity benchmark (account + sponsor + send in ~10 lines); session-key DX (create/scope/revoke); multi-chain deployment tooling.
- **Kernel lacks:** `[Contracts]` custody tiers, trustee recovery, canonical identity; `[SDK]` MCP authorization, audit evidence.
- **Verdict:** adopt SDK ergonomics as the bar for `agent-account` client APIs.

### Rhinestone — partner

- **Feature inventory:** ERC-7579 module registry + module security attestations; module SDK; marketplace ambitions; omnichain intent execution.
- **AP lacks:**
  - `[SDK]` a module registry with security attestations + third-party module distribution channel.
- **Rhinestone lacks:** `[Contracts]` the agent-trust modules themselves (custody tiers, delegation enforcers) — which AP has.
- **Verdict:** partner — publish AP modules into the 7579 ecosystem; consume their module-attestation pattern for AP module governance.

### Alchemy Account Kit — adopt patterns

- **Feature inventory:** Modular Account (7579), Gas Manager policies, HA bundler infra, embedded account flows, policy dashboard.
- **AP lacks:**
  - `[SDK]` reliability/SLA posture; UserOp observability.
  - `[UX]` (deferred) hosted policy dashboard with per-app/user spend limits.
- **Verdict:** adopt API ergonomics; integrate bundler/paymaster interfaces (05).

---

## Compact entries — remaining products

| Product | Overlap with AP | AP lacks (layer) | Verdict |
| --- | --- | --- | --- |
| Zodiac / Roles Modifier | `tool-policy`, custody tiers | `[Contracts]` composable role DSL with call-scoping (target/selector/param) | Adopt patterns |
| Biconomy | `agent-account` + paymaster | `[SDK]` multichain gasless UX breadth | Track |
| Stackup | Treasury ops on AA | `[UX]` finance-operations product | Adopt patterns (09) |
| Etherspot | `agent-account` SDK | `[SDK]` cross-chain tx orchestration | Track |
| thirdweb | Broad SDK + Engine | `[SDK]` server-side tx API breadth | Track |
| Particle | Chain abstraction | `[SDK]` universal accounts across chains | Track |
| Candide | AA standards | `[Contracts]` OSS 4337 conformance reference | Track |
| Ambire | Smart wallet UX | `[UX]` consumer batching/UX | Track |

---

## Focus-area gap rollup — by layer

### `[Contracts]` gaps — active

| Gap | Evidence | Roadmap ID |
| --- | --- | --- |
| ERC-7715/7710 wire-compat so AP grants interop with reference framework contracts + wallets | MetaMask DF | FG-CON-STD-1 |
| External contract audit + operational-credibility signals (bug bounty, TVL track record) | Safe (table stakes) | FG-SEC-1 |
| Module registry + security attestation for AP's 7579 modules | Rhinestone | FG-CON-STD-2 |

### `[SDK]` / package gaps — active

| Gap | Evidence | Roadmap ID |
| --- | --- | --- |
| **Agent CLI + framework-agnostic skills packages** (mirror `mm` CLI + `agent-skills` distribution via Skills registry) | MetaMask Agent Wallet | FG-SDK-1 (**elevated**) |
| Threat-scan / simulation / MEV-protection pipeline on the signing path | MetaMask Agent Wallet (Blockaid) | FG-SDK-7 |
| Server-wallet async-signing ergonomics (polling model) | MetaMask Agent Wallet | FG-SDK-8 |
| Transaction service / pending multi-custodian action coordination | Safe | FG-SDK-6 |
| Session-key DX parity (create/scope/revoke in a few lines) | ZeroDev, Biconomy | FG-SDK-9 |
| Multi-chain deployment + chain-abstraction story | Particle, ZeroDev | FG-SDK-10 |

### `[UX]` gaps — **deferred (recorded, not current focus)**

| Gap | Evidence |
| --- | --- |
| Onboarding mode-picker + operating-mode (Guard/Beast-style) selection | MetaMask Agent Wallet |
| Treasury UI + module marketplace surface | Safe, Rhinestone |
| Hosted gas/sponsorship policy dashboard | Alchemy |

**Substrate advantages to preserve:** thin ERC-7579 core with custody tiers (no competitor has T1–T6 + trustee recovery); on-chain passkey custodians; own multi-sig with zero runtime deps; co-designed contracts + TS packages; delegation that extends past the chain into MCP/A2A.
