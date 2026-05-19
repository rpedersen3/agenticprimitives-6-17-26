# ADR-0004 — `mcp-runtime` is middleware on the official MCP SDK, not a replacement

**Status:** accepted (2026-05-19)

## Context

Smart-agent's three mature MCP servers (`person-mcp`, `org-mcp`, `people-group-mcp`) each contain ~500 lines of near-identical verify-delegation pipeline. The natural reflex is to extract this into "our MCP framework." The agent-protocol-SDK research showed the official `@modelcontextprotocol/sdk` already covers most of what a framework would: tool/resource/prompt registration, transports (stdio + Streamable HTTP), OAuth 2.1 + PKCE + RFC-9728 + RFC-8707 (mandated by the 2026-03-15 spec). FastMCP and FastMCP-TS exist as ergonomics frameworks on top.

The gap the official SDK does NOT fill:
1. Authorization that **decides** (not just verifies a token) — bridging session-key + delegation chain + caveat eval + classification → allow/deny/consent.
2. JTI/nonce replay protection (genuinely absent from the spec).
3. Classification metadata as enforced policy (the SDK has hints; we want enforcement).
4. Audit hooks with delegation-chain context.

## Decision

`@agenticprimitives/mcp-runtime` is **delegation-aware middleware** that wraps the official MCP SDK, not a competing implementation. It:

- Declares `@modelcontextprotocol/sdk` as a peer dependency, not a regular dependency.
- Provides `withDelegation` / `withCrossDelegation` handler wrappers that consume `delegation` + `tool-policy` and produce final decisions.
- Owns the JTI replay layer (`createSqliteJtiStore`, `createPostgresJtiStore`, `createMemoryJtiStore`).
- Bridges policy decisions to MCP tool error responses.

It does NOT:
- Reimplement tool/resource/prompt registration.
- Reimplement transports.
- Reimplement OAuth 2.1 / PKCE plumbing.
- Define the classification taxonomy (that's `tool-policy`'s job).
- Define caveat semantics (that's `delegation`'s job).

## Consequences

- A consumer's MCP server uses the standard SDK API for everything except authorization. Familiar and migratable.
- Upgrades to the MCP SDK (new transports, spec changes) land in the SDK; we ride the upgrade by bumping the peer-dep range.
- Our value-add is narrow and defensible. The package stays small.
- The cost: `mcp-runtime` is meaningful only paired with the MCP SDK. Anyone wanting a pure-policy library uses `tool-policy` alone.

## To reverse this

The reversal case is: the MCP SDK drops a capability we need, or its API churn becomes a tax. At that point you'd consider forking or wrapping more. We're nowhere close — the SDK is healthy and the boundaries are clear.

## References

- [`specs/100-package-boundary-doctrine.md`](../../../specs/100-package-boundary-doctrine.md) §6 (what stays in apps)
- [`specs/205-mcp-runtime.md`](../../../specs/205-mcp-runtime.md) §10 (non-goals: no MCP SDK bundling, no transport, no OAuth plumbing)
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
