# agenticprimitives

Composable primitives for building agentic web3 apps. **17 publishable `@agenticprimitives/*` packages**, each independently consumable, each backed by competitive-landscape research. Grouped below by concern; see `specs/100-package-boundary-doctrine.md` for the package-boundary contract.

### Auth + sessions

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/connect-auth`](./packages/connect-auth) | Privy-style auth (passkey / SIWE / Google OAuth) + JWT sessions + pluggable `Signer` interfaces |
| [`@agenticprimitives/connect`](./packages/connect) | SSO broker primitives: token mint + verify (`verifyAgentSession`, `verifyIdToken`), bound-grant flow, redirect helpers |

### Agent account + custody

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/agent-account`](./packages/agent-account) | ERC-4337 + ERC-7579 smart-account substrate: deterministic addressing, ERC-1271, UserOp building, factory mode wiring |
| [`@agenticprimitives/account-custody`](./packages/account-custody) | Custody-policy SDK: action enum + arg builders, EIP-712 typed-data, custodian/trustee/recovery types |
| [`@agenticprimitives/key-custody`](./packages/key-custody) | Pluggable KMS: envelope encryption + secp256k1 signers + HMAC (local-AES / AWS KMS / GCP KMS), per-subject derivation |

### Delegation + MCP

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/delegation`](./packages/delegation) | EIP-712 delegations + caveat evaluator + session lifecycle (web → agent → MCP) |
| [`@agenticprimitives/tool-policy`](./packages/tool-policy) | Protocol-agnostic classification + risk tiers + threshold policy + exact-call DSL |
| [`@agenticprimitives/mcp-runtime`](./packages/mcp-runtime) | `withDelegation` middleware around the official MCP SDK + JTI stores (sqlite/postgres/memory) |

### Naming + identity

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/agent-naming`](./packages/agent-naming) | Hierarchical name registry + resolver for the `.agent` TLD (forward + reverse) |
| [`@agenticprimitives/agent-profile`](./packages/agent-profile) | CAIP-10 profile resolver + AgentCard schema + on-chain profile reads |
| [`@agenticprimitives/agent-relationships`](./packages/agent-relationships) | ⚠️ EXPERIMENTAL — on-chain trust-fabric edges. Public graph; **not for confidential edges** (see package README) |

### Directory + ontology

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/identity-directory`](./packages/identity-directory) | Evidence-backed read model — composes naming + profile + relationships into a queryable directory |
| [`@agenticprimitives/identity-directory-adapters`](./packages/identity-directory-adapters) | CAIP-10 / on-chain / naming / indexer adapter implementations for `identity-directory` |
| [`@agenticprimitives/ontology`](./packages/ontology) | Hashgraph-aligned ontology (T-box / C-box) + controlled vocabularies + SHACL shapes |

### Audit + types + contracts

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/audit`](./packages/audit) | Audit-event schema + sink interface + in-band sinks (console / memory / PII guardrail) + `MetricsSink` observability primitive |
| [`@agenticprimitives/types`](./packages/types) | Cross-cutting branded primitives (`SmartAgentAddress`, `Hex`, etc.) — leaf in the dependency graph |
| [`@agenticprimitives/contracts`](./packages/contracts) | Solidity sources + ABIs + storage-layout snapshots for the on-chain primitives consumed by the other packages |

See [`specs/`](./specs) for the full design. Start with [`000-product-overview.md`](./specs/000-product-overview.md) and [`100-package-boundary-doctrine.md`](./specs/100-package-boundary-doctrine.md).

## Layout

```
agenticprimitives/
├── packages/         # The 17 publishable @agenticprimitives/* packages
├── apps/             # Demo apps (web + a2a + mcp + sso + org + jp + contracts)
├── specs/            # Doctrine, per-package contracts, archive
├── docs/             # Usage guides, ADRs, audits, runbooks
└── scripts/          # CI guardrails + dev orchestration
```

## Demo

A small end-to-end demo exercises the core flow: EOA user (mnemonic in localStorage) signs in via SIWE → smart account provisioned → user delegates to an a2a session key → a2a calls an MCP tool that returns the user's PII, verified by the full delegation chain.

```bash
# First time only:
cd apps/contracts && bash setup.sh && cd ..

# Run the demo (Anvil + deploy + 3 apps in parallel):
pnpm dev
```

Then open http://127.0.0.1:5173. The UI currently has the three demo steps as stubs that throw `not implemented`; they wire up as the `@agenticprimitives/*` packages are implemented. See [`apps/demo-web/`](./apps/demo-web), [`apps/demo-a2a/`](./apps/demo-a2a), [`apps/demo-mcp/`](./apps/demo-mcp).

Live deploy targets: Vercel (web) + Fly.io (a2a + mcp) + Base Sepolia (contracts). Config for those lands as the demo matures.

## Status

**Alpha track — testnet-only.** Specs and APIs are stable; package boundaries are enforced by CI; ~635 Foundry tests across 28 contracts; the H1–H4 + R6 hardening waves are complete. Demo apps exercise the full chain (SIWE/passkey auth → smart-account deploy → custody policy + multi-sig → off-chain delegations + MCP tool calls) end-to-end on Base Sepolia.

**Do not deploy to production yet.** Production launches are deferred pending operational steps independent of the architecture:

1. **External contracts audit** (Cyfrin / CodeHawks contest planned).
2. **Clean production governance keys** — the current testnet deployer is intentionally public so the demo stack is reproducible; production deploys MUST rotate to a fresh KMS-backed key per the [`packages/contracts/AUDIT.md`](./packages/contracts/AUDIT.md) runbook.
3. **Closure of the residual P1 items** tracked in [`docs/architecture/product-readiness-audit.md`](./docs/architecture/product-readiness-audit.md).

Suitable today for controlled internal demos, architecture review, and integration prototyping. The R6 contracts hardening wave + the SmartAgentPaymaster verifying-paymaster path + the production-strict `withDelegation` default mean the codebase is "production-pattern-correct" — the gating items are key custody + audit dossier, not implementation gaps.

## Provenance

Capabilities are extracted from [`smart-agent`](https://github.com/agentictrustlabs/smart-agent) (branch `003-intent-marketplace-proposal`), then re-shaped as standalone, dependency-minimal packages with boundaries validated against MetaMask DTK, 1claw, Coinbase AgentKit, Alchemy Account Kit, ZeroDev, Pimlico, Safe, TurnKey, Lit Protocol, Privy, MCP SDK, and A2A SDK.
