# @agenticprimitives/tool-policy — Claude guide

## What this package owns
- Classification taxonomy: `@sa-tool`, `@sa-auth`, `@sa-validation`, `@sa-risk-tier`, `@sa-owner`, `@sa-rate-limit`, `@sa-prod-gate`.
- Risk tiers (`low`/`medium`/`high`/`critical`) + TTL clamp + required-caveats lookups.
- `declareTool()` runtime metadata attachment.
- Exact-call DSL (`exactCall`, `matchesExactCall`).
- The decision engine: `evaluatePolicy(ctx) → { decision, ... }`.
- `lintClassification()` — JSDoc tag block parser/checker (subpath: `/lint`).

## What this package does NOT own
- **Any protocol transport.** No imports from MCP SDK, A2A SDK, LangChain, Vercel AI — this package is protocol-agnostic per [ADR-0003](../../docs/architecture/decisions/0003-tool-policy-protocol-agnostic.md).
- Delegation mechanics → [`delegation`](../delegation) (only `Delegation` referenced as a type-only import).
- Storage, audit persistence (consumers wire).
- Risk-tier **enforcement** — this package decides; consumers enforce via their runtime ([`mcp-runtime`](../mcp-runtime), future `a2a-runtime`, etc.).

## Vocabulary
**Owns:** `RiskTier`, `ToolClassification`, `PolicyContext`, `PolicyDecision`, `ExactCallPolicy`, `@sa-*` tag names.
**Disambiguation:** "**tool**" here is a classified tool definition (transport-agnostic). In [`mcp-runtime`](../mcp-runtime) "tool" is a specific MCP tool registered with the SDK. We're the abstract one. See [`docs/architecture/vocabulary-map.md`](../../docs/architecture/vocabulary-map.md).
**Does not use:** `@modelcontextprotocol`, `a2a-js`, `langchain`, `@vercel/ai` (these are protocol-specific — see ADR-0003), `withDelegation`, `DelegationClient`, `SessionManager`, `A2AKeyProvider`, envelope encryption, `JTI`, `passkey`, `JWT`, `OAuth`. See `capability.manifest.json:forbiddenTerms`.

## Read these first (in order)
1. `capability.manifest.json` — boundary (note the long `forbiddenImports` list; that's intentional)
2. `src/index.ts` — public API
3. `../../specs/204-tool-policy.md` — the contract
4. `../../docs/architecture/decisions/0003-tool-policy-protocol-agnostic.md` — why protocol-agnostic matters
5. `src/classification.ts`, `src/decision.ts`, `src/exact-call.ts`

## Stable public exports
**Taxonomy:** `RiskTier`, `ToolClassification`, `declareTool`
**Exact-call DSL:** `ExactCallPolicy`, `exactCall`, `matchesExactCall`
**Decision engine:** `PolicyContext`, `PolicyDecision`, `evaluatePolicy`
**Risk-tier helpers:** `clampTtlForRiskTier`, `requiredCaveatsForRiskTier`
**Lint:** `lintClassification` (also at `@agenticprimitives/tool-policy/lint`)

## Allowed imports
`@agenticprimitives/types`. **Nothing else.** If you need a runtime concept, it's a doctrine violation.

## Forbidden imports
- `apps/*`
- `identity-auth`, `agent-account`, `key-custody`, `mcp-runtime`
- `@modelcontextprotocol/sdk`, `@a2aproject/a2a-js`, `langchain`, `@langchain/*`, `ai`, `@vercel/ai`
- Type-only import of `Delegation` from `delegation` is permitted, but it MUST be `import type` (not runtime).

## Drift triggers — STOP and route
- "Import `@modelcontextprotocol/sdk` or any A2A/LangChain/Vercel package" — **HARD STOP.** Doctrine violation. [ADR-0003](../../docs/architecture/decisions/0003-tool-policy-protocol-agnostic.md). If you need transport behavior, it lives in [`mcp-runtime`](../mcp-runtime) (or a future `a2a-runtime`).
- "Add a delegation primitive, builder, or verifier" — **STOP.** Belongs in [`delegation`](../delegation). We consume `Delegation` as a type.
- "Implement transport — write to a response, set a header" — **STOP.** We return decisions; consumers enforce.
- "Add KMS, envelope encryption, or HMAC" — **STOP.** Belongs in [`key-custody`](../key-custody).
- "Add an auth method, session, or JWT" — **STOP.** Belongs in [`identity-auth`](../identity-auth).

## Before you write code
- [ ] Is the change about classification taxonomy, risk tiers, the decision engine, or exact-call policy?
- [ ] Am I about to import a transport-specific package? (If yes, STOP — wrong package.)
- [ ] Is the decision engine still **deterministic** (same input → same output; no clocks, no random, no I/O)?
- [ ] If I'm adding a decision rule, does it fail-closed for unknown classification fields?
- [ ] Did I update `specs/204-tool-policy.md` if the public API or decision rules changed?

## Security invariants (DO NOT BREAK)
- **Decision engine MUST be deterministic.** No clocks, random, or side effects. Tests rely on this.
- **Unknown classification fields → fail-closed (deny).** No permissive defaults for novel tags.
- **Exact-call matcher MUST compare calldata exactly (byte-identical) when `calldataHash` is set.** No partial-match shortcuts.

## Validate the package
```bash
pnpm --filter @agenticprimitives/tool-policy typecheck
pnpm --filter @agenticprimitives/tool-policy test
pnpm check:forbidden-terms
```

## Common task routing
- Adding a new risk tier → `src/risk-tier.ts` + decision rules in `src/decision.ts` + golden table update.
- Adding a classification tag → `src/classification.ts` (type) + lint rules in `src/lint.ts`.
- Adding a decision rule → `src/decision.ts`; must include a golden test row.

## Capabilities this package participates in
- **Multi-sig + threshold policy** — see [spec 207](../../specs/207-smart-account-threshold-policy.md) + [demo guide](../../apps/demo-web-pro/docs/multi-sig/guide.md). This package owns the risk-tier taxonomy (T1 Read / T2 Write / T3 Value / T4 Admin / T5 Critical / T6 Recovery) as first-class exports + `evaluatePolicy(classification)` returning a `{ tier, requiresQuorum, requiresUv, requiresAcceptedOnChain }` decision that callers compose with `delegation.verifyDelegationToken`.
- Index of cross-cutting capabilities: [`docs/architecture/cross-cutting-capabilities.md`](../../docs/architecture/cross-cutting-capabilities.md).

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
