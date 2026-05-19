# agenticprimitives

Composable primitives for building agentic web3 apps. Six capability packages + one shared types package, each independently consumable, each backed by competitive-landscape research.

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/identity-auth`](./packages/identity-auth) | Privy-style auth (passkey / SIWE / Google) + JWT sessions + pluggable Signer interfaces |
| [`@agenticprimitives/agent-account`](./packages/agent-account) | ERC-4337 smart-account substrate: deterministic addressing, ERC-1271, UserOp building |
| [`@agenticprimitives/delegation`](./packages/delegation) | EIP-712 delegations + session lifecycle (web → agent → MCP) |
| [`@agenticprimitives/key-custody`](./packages/key-custody) | Envelope encryption + signers + HMAC (local-AES / AWS KMS / GCP KMS) |
| [`@agenticprimitives/tool-policy`](./packages/tool-policy) | Protocol-agnostic classification + risk tiers + exact-call DSL |
| [`@agenticprimitives/mcp-runtime`](./packages/mcp-runtime) | Delegation-aware middleware around the official MCP SDK |
| [`@agenticprimitives/types`](./packages/types) | Cross-cutting branded primitives |

See [`specs/`](./specs) for the full design. Start with [`000-product-overview.md`](./specs/000-product-overview.md) and [`100-package-boundary-doctrine.md`](./specs/100-package-boundary-doctrine.md).

## Layout

```
agenticprimitives/
├── packages/         # The seven @agenticprimitives/* packages
├── specs/            # Doctrine, per-package contracts, archive
├── docs/             # Usage guides, ADRs
└── scripts/          # CI guardrails (stubs in v0)
```

## Status

Pre-alpha. Specifications and skeletons in place; implementation lands package by package. No working code yet — these are scaffolds with declared public APIs.

## Provenance

Capabilities are extracted from [`smart-agent`](https://github.com/agentictrustlabs/smart-agent) (branch `003-intent-marketplace-proposal`), then re-shaped as standalone, dependency-minimal packages with boundaries validated against MetaMask DTK, 1claw, Coinbase AgentKit, Alchemy Account Kit, ZeroDev, Pimlico, Safe, TurnKey, Lit Protocol, Privy, MCP SDK, and A2A SDK.
