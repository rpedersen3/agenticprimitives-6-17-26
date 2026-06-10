# ADR-0034 — Async A2A transport is its own package, with the Durable Object as an adapter

**Status:** accepted (2026-06-09) · **Spec:** [269](../../../specs/269-async-delegation-authorized-a2a.md) · **Supersedes the placement note in:** [spec 245](../../../specs/245-a2a-task-adoption-in-mcp-runtime.md) (A2A Task in `mcp-runtime/a2a`)

## Context

Spec 245 sketched the async A2A Task substrate as a subpath of `mcp-runtime` (`mcp-runtime/a2a`), and `packages/fulfillment` re-exports `Task`/`Message`/`Artifact` from there. We're now building the runtime for real (spec 269) as a reusable primitive — any claimed agent talks to any other. Two placement questions:

1. Where does the A2A runtime live — `mcp-runtime` or a new package?
2. Where does the Cloudflare `TaskStoreDO` live — in the package or in the app?

## Decision

1. **A new package `@agenticprimitives/a2a`.** Agent-to-agent task transport is NOT the MCP tool-call layer; putting it in `mcp-runtime` would couple sovereign-agent messaging to MCP middleware and invert the boundary (`mcp-runtime` is already high in the graph). The A2A runtime depends on `fulfillment` (Task types), `delegation` (auth + caveats), and `types` — a clean mid-graph leaf. `mcp-runtime` becomes a CONSUMER (the receiving-side `withDelegation` gate + the a2a→mcp delivery leg), not the owner.

2. **The package is transport-agnostic; the Durable Object is an adapter.** Per ADR-0021 + the boundary doctrine, generic packages must not couple to a single runtime (Cloudflare). So:
   - `@agenticprimitives/a2a` owns the runtime over a **`TaskStore` PORT**, the JSON-RPC handlers, the `SkillHandler` interface + dispatcher, the `A2aWireAdapter` client, the delegation-auth gate, and the scoped-grant caveat builders. No `@cloudflare/workers-types` in the core.
   - The Cloudflare **`TaskStoreDO`** (a `DurableObjectState`-backed `TaskStore` + `alarm()` driver) ships as a thin **`@agenticprimitives/a2a/cloudflare`** subpath (Cloudflare-types only) — exactly the `identity-directory` ↔ `identity-directory-adapters` pattern. Apps without Workers supply a different `TaskStore` (sqlite/pg/memory).

## Consequences

- `fulfillment`'s CLAUDE.md re-export note ("`Task` from `mcp-runtime/a2a`") is corrected to point at `@agenticprimitives/a2a`.
- The boundary scan + dependency-graph gate gain a new node: `types ← fulfillment ← a2a`, plus `a2a → delegation` (type + verify) and the documented `a2a/cloudflare` Cloudflare edge.
- A Worker agent imports `createA2aAgent` (core) + registers the `TaskStoreDO` class from `a2a/cloudflare` in its wrangler config. Non-Worker consumers never load the Cloudflare subpath.

## Alternatives rejected

- **Keep it in `mcp-runtime/a2a` (spec 245 literal).** Couples A2A to MCP; the runtime isn't MCP-shaped; rejected per the stakeholder "first-class primitive, no migration constraints" directive.
- **Ship the DO from the core package.** Violates ADR-0021 (Cloudflare coupling in a generic package); breaks non-Worker reuse.
