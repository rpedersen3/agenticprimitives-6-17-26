# @agenticprimitives/tool-policy — Claude guide

## What this package owns
- The classification taxonomy: `@sa-tool`, `@sa-auth`, `@sa-validation`, `@sa-risk-tier`, `@sa-owner`, `@sa-rate-limit`, `@sa-prod-gate`.
- Risk tiers (`low`/`medium`/`high`/`critical`) + TTL clamp + required-caveats lookups.
- `declareTool()` runtime metadata attachment.
- Exact-call DSL (`exactCall`, `matchesExactCall`).
- The decision engine: `evaluatePolicy(ctx) → { decision, ... }`.
- `lintClassification()` — JSDoc tag block parser/checker (subpath: `/lint`).

## What this package does NOT own
- **Any protocol transport.** No imports from MCP SDK, A2A SDK, LangChain, Vercel AI — this is a protocol-agnostic primitive.
- Delegation mechanics → `@agenticprimitives/delegation` (only `Delegation` is referenced as a type, optional).
- Storage, audit persistence (consumers wire).
- Risk-tier ENFORCEMENT — this package decides; consumers enforce via their runtime (mcp-runtime, future a2a-runtime, etc.).

## Read these first (in order)
1. `capability.manifest.json` — boundary (note the long `forbiddenImports` list — that's intentional)
2. `src/index.ts` — public API
3. `../../specs/204-tool-policy.md` — the contract
4. `src/classification.ts`, `src/decision.ts`, `src/exact-call.ts`

## Stable public exports
- **Taxonomy:** `RiskTier`, `ToolClassification`, `declareTool`
- **Exact-call DSL:** `ExactCallPolicy`, `exactCall`, `matchesExactCall`
- **Decision engine:** `PolicyContext`, `PolicyDecision`, `evaluatePolicy`
- **Risk-tier helpers:** `clampTtlForRiskTier`, `requiredCaveatsForRiskTier`
- **Lint:** `lintClassification` (also at `@agenticprimitives/tool-policy/lint`)

## Allowed imports
`@agenticprimitives/types`. **No transport packages.** If you need a runtime concept, it's a doctrine violation.

## Forbidden imports
- `apps/*`
- `identity-auth`, `agent-account`, `key-custody`, `mcp-runtime`
- `@modelcontextprotocol/sdk`, `@a2aproject/a2a-js`, `langchain`, `@vercel/ai`
- (Optionally, type-only import of `Delegation` from `delegation` is permitted — but it must be `import type`, not runtime.)

## Security invariants (DO NOT BREAK)
- Decision engine MUST be deterministic — same context → same decision. No clocks, no random, no side effects.
- Unknown classification fields → fail-closed (deny). No "permissive by default" for novel tags.
- Exact-call matcher MUST compare calldata exactly (byte-identical) when `calldataHash` is set — no partial match shortcuts.

## Validate the package
```bash
pnpm --filter @agenticprimitives/tool-policy typecheck
pnpm --filter @agenticprimitives/tool-policy test
```

## Common task routing
- Adding a new risk tier → `src/risk-tier.ts` + decision rules in `src/decision.ts`.
- Adding a classification tag → `src/classification.ts` (type) + lint rules in `src/lint.ts`.
- Adding a decision rule → `src/decision.ts`; must include a golden test row.

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
