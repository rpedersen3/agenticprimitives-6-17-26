# Architecture Decision Records (ADRs)

Short docs (≤ 400 words each) recording **load-bearing** boundary decisions. Each ADR captures the **context**, the **decision**, and its **consequences** — so an agent thinking about reversing the decision can re-derive whether the original constraints still hold.

The drift mode this prevents: an agent doesn't know *why* a boundary is where it is, decides it looks suboptimal, and "refactors" it away — silently breaking the constraint the boundary was protecting.

## Index

- [`0001-split-identity-auth-and-agent-account.md`](./0001-split-identity-auth-and-agent-account.md) — why auth + smart-account is 2 packages, not 1.
- [`0002-session-lifecycle-in-delegation.md`](./0002-session-lifecycle-in-delegation.md) — why `SessionManager` lives in `delegation`, not `key-custody`.
- [`0003-tool-policy-protocol-agnostic.md`](./0003-tool-policy-protocol-agnostic.md) — why `tool-policy` cannot import MCP / A2A / LangChain.
- [`0004-mcp-runtime-as-middleware.md`](./0004-mcp-runtime-as-middleware.md) — why `mcp-runtime` is middleware on the official MCP SDK, not a replacement.
- [`0005-monorepo-with-product-boundaries.md`](./0005-monorepo-with-product-boundaries.md) — why we're a monorepo of independently-consumable packages, not a polyrepo and not a single SDK.
- [`0012-no-eth-getlogs-in-product-read-paths.md`](./0012-no-eth-getlogs-in-product-read-paths.md) — no `eth_getLogs` in package/app read paths; use `readContract` or an indexer.
- [`0013-no-silent-fallbacks.md`](./0013-no-silent-fallbacks.md) — one mechanism per read/auth path; empty is an answer, never a trigger to escalate to a second, more expensive path.

## Status discipline

Every ADR is one of:
- **proposed** — under discussion; the decision is not yet binding.
- **accepted** — binding; new code must respect it.
- **superseded by [ADR-N]** — replaced; the linked ADR is the new binding one.

To revisit an accepted ADR, write a new ADR that supersedes it. Don't edit the original — agents reading commit history need to see why the change happened.
