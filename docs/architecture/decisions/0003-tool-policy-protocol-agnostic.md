# ADR-0003 — `tool-policy` is protocol-agnostic

**Status:** accepted (2026-05-19)
**Supersedes:** initial scaffold that placed classification + risk tiers inside `mcp-resources`

## Context

The first scaffold put classification metadata (`@sa-tool`, `@sa-auth`, `@sa-risk-tier`) and exact-call policy inside `mcp-resources` because that's where smart-agent uses them today. The agent-protocol-SDK research argued this was over-coupled: classification is a protocol-agnostic primitive that LangGraph, Vercel AI, A2A, and MCP all need independently.

Signals:
- The official `@modelcontextprotocol/sdk` already provides tool annotations (`readOnlyHint`, `destructiveHint`, …) but treats them as **non-enforced hints**. A real risk-tier system is the gap.
- **LangGraph** has `ToolRuntime` with runtime context injection. It does authorization in code, not declaration. Could use a declarative classification model.
- **Vercel AI SDK 6** ships `needsApproval: true` per-tool. Same idea, simpler. A classification taxonomy generalizes this.
- **MCP, A2A, and framework tool calls** all share the question "is this caller authorized for this call?" — but they each have different transports.

## Decision

`@agenticprimitives/tool-policy` is a standalone package. It imports `@agenticprimitives/types` and **nothing else** from the agentic primitives world. It cannot import MCP SDK, A2A SDK, LangChain, or Vercel AI.

This is enforced two ways:
1. `capability.manifest.json:forbiddenImports` lists the protocol SDKs.
2. CI script `scripts/check-package-boundaries.ts` lints imports.

The package exposes: `RiskTier`, `ToolClassification`, `declareTool`, `exactCall` / `matchesExactCall`, `evaluatePolicy`, `clampTtlForRiskTier`, `requiredCaveatsForRiskTier`, `lintClassification`. None of these mention a transport.

## Consequences

- A LangGraph consumer can `pnpm add @agenticprimitives/tool-policy` without pulling MCP SDK, viem, or anything else they don't use.
- `mcp-runtime` consumes `tool-policy` (one-directional dep). A future `a2a-runtime` consumes the same `tool-policy`. Same classification model, different transports.
- New policy rules added to the decision engine apply to every consumer transparently.
- The cost: anytime classification needs transport-specific behavior, it lives in the runtime package (e.g., `mcp-runtime` decides how to turn a `requires-consent` decision into an MCP error response). That's the right place.

## To reverse this

You'd need to show that protocol-agnostic policy generated significantly more friction than it solved. Concretely: if the decision engine had to be specialized per transport in 3+ places, the abstraction has failed. Document the cases and write a superseding ADR.

## References

- [`specs/100-package-boundary-doctrine.md`](../../../specs/100-package-boundary-doctrine.md) §S5 (framework adapters as separate)
- [`specs/204-tool-policy.md`](../../../specs/204-tool-policy.md) §10 (why protocol-agnostic matters)
- Agent-protocol-SDKs research (in conversation; not yet a written research note)
