# agenticprimitives

Composable primitives for building agentic web apps. Four standalone packages, each usable on its own or together.

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/auth`](./packages/auth) | Privy-style user auth + smart-account initiation |
| [`@agenticprimitives/delegation`](./packages/delegation) | Smart-account delegation manager spanning web app → A2A agent → MCP |
| [`@agenticprimitives/kms`](./packages/kms) | Pluggable KMS abstraction for agent session keys, layered on delegation |
| [`@agenticprimitives/mcp-resources`](./packages/mcp-resources) | Delegation-aware resource access management for MCP servers |

See [`specs/`](./specs) for the technical specification and [`docs/`](./docs) for usage guides.

## Layout

```
agenticprimitives/
├── packages/         # Publishable @agenticprimitives/* packages
├── specs/            # Technical specs (product + per-capability)
├── docs/             # Usage docs / ADRs
└── scripts/          # Repo tooling
```

## Status

Pre-alpha. Specifications are being written; implementation lands package by package.

## Provenance

Capabilities are extracted from [`smart-agent`](https://github.com/agentictrustlabs/smart-agent) (branch `003-intent-marketplace-proposal`), then re-shaped as standalone, dependency-minimal packages.
