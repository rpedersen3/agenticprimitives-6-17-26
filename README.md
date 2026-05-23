# agenticprimitives

Composable primitives for building agentic web3 apps. Eight capability packages + one shared types package, each independently consumable, each backed by competitive-landscape research.

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/identity-auth`](./packages/identity-auth) | Privy-style auth (passkey / SIWE / Google) + JWT sessions + pluggable Signer interfaces |
| [`@agenticprimitives/agent-account`](./packages/agent-account) | ERC-4337 smart-account substrate: deterministic addressing, ERC-1271, UserOp building |
| [`@agenticprimitives/delegation`](./packages/delegation) | EIP-712 delegations + session lifecycle (web → agent → MCP) |
| [`@agenticprimitives/key-custody`](./packages/key-custody) | Envelope encryption + signers + HMAC (local-AES / AWS KMS / GCP KMS) |
| [`@agenticprimitives/tool-policy`](./packages/tool-policy) | Protocol-agnostic classification + risk tiers + exact-call DSL |
| [`@agenticprimitives/mcp-runtime`](./packages/mcp-runtime) | Delegation-aware middleware around the official MCP SDK |
| [`@agenticprimitives/custody`](./packages/custody) | Custody-layer SDK: CustodyPolicy ABI, action enum + arg builders, EIP-712 typed-data, custodian/trustee/recovery types |
| [`@agenticprimitives/audit`](./packages/audit) | Audit-event schema, sink interface, in-band sinks (console / memory / PII guardrail), plus the `MetricsSink` observability primitive |
| [`@agenticprimitives/types`](./packages/types) | Cross-cutting branded primitives |

See [`specs/`](./specs) for the full design. Start with [`000-product-overview.md`](./specs/000-product-overview.md) and [`100-package-boundary-doctrine.md`](./specs/100-package-boundary-doctrine.md).

## Layout

```
agenticprimitives/
├── packages/         # The nine @agenticprimitives/* packages
├── apps/             # Demo apps (web + a2a + mcp + contracts)
├── specs/            # Doctrine, per-package contracts, archive
├── docs/             # Usage guides, ADRs
└── scripts/          # CI guardrails + dev orchestration
```

## Demo

A small end-to-end demo exercises all 7 packages: EOA user (mnemonic in localStorage) signs in via SIWE → smart account provisioned → user delegates to an a2a session key → a2a calls an MCP tool that returns the user's PII, verified by the full delegation chain.

```bash
# First time only:
cd apps/contracts && bash setup.sh && cd ..

# Run the demo (Anvil + deploy + 3 apps in parallel):
pnpm dev
```

Then open http://127.0.0.1:5173. The UI currently has the three demo steps as stubs that throw `not implemented`; they wire up as the `@agenticprimitives/*` packages are implemented. See [`apps/demo-web/`](./apps/demo-web), [`apps/demo-a2a/`](./apps/demo-a2a), [`apps/demo-mcp/`](./apps/demo-mcp).

Live deploy targets: Vercel (web) + Fly.io (a2a + mcp) + Base Sepolia (contracts). Config for those lands as the demo matures.

## Status

Pre-alpha, but materially implemented. Specs and APIs are stable; the demo apps exercise the full chain (SIWE/passkey auth → smart-account deploy → custody policy + multi-sig → off-chain delegations + MCP tool calls) end-to-end on Base Sepolia. **Not production-ready** — see the in-repo audit ([`docs/architecture/product-readiness-audit.md`](./docs/architecture/product-readiness-audit.md)) for the open P0/P1 list. Appropriate for controlled internal demos and architecture review only.

## Provenance

Capabilities are extracted from [`smart-agent`](https://github.com/agentictrustlabs/smart-agent) (branch `003-intent-marketplace-proposal`), then re-shaped as standalone, dependency-minimal packages with boundaries validated against MetaMask DTK, 1claw, Coinbase AgentKit, Alchemy Account Kit, ZeroDev, Pimlico, Safe, TurnKey, Lit Protocol, Privy, MCP SDK, and A2A SDK.
