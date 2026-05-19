# Spec 204 — `@agenticprimitives/tool-policy`

**Capability:** Protocol-agnostic classification, risk tiers, and exact-call policy. The decision engine that any tool runtime (MCP, A2A, LangGraph, Vercel AI) can consume.
**Status:** v0 draft · 2026-05-19
**Reference implementation:** `smart-agent/scripts/{check-route-classification,check-person-mcp-classification}.ts`, `smart-agent/scripts/lib/person-mcp-classification-parser.ts`, classification tags scattered through `smart-agent/apps/{web,person-mcp,org-mcp,people-group-mcp}/src/`.

> **Why a separate package from `mcp-runtime`:** the agent-protocol-SDKs research showed unanimously that policy/classification is protocol-agnostic. Splitting lets LangGraph, A2A, and Vercel AI tool-runtimes adopt our classification model without buying into MCP-specific middleware. Widens adoption surface significantly.

---

## 1. Goal

A standalone library that owns three things every mature agent system needs and that nobody packages well today:

1. **A classification taxonomy** for tool calls (`delegation-verified` / `service-only` / `bootstrap` / `dev-only`), enforced at the boundary, not just hinted at like MCP's tool annotations.
2. **A risk-tier vocabulary** (`low` / `medium` / `high` / `critical`) consumed by delegation issuance (session TTL clamps) and runtime enforcement (require-consent gates).
3. **An exact-call policy DSL** for high-risk operations: "this delegation may call exactly this target/selector/calldata-hash and nothing else."

This package is **purely declarative and protocol-agnostic**. It does not perform any transport. It does not own delegation mechanics. It returns decisions; consumers enforce.

---

## 2. The classification taxonomy

Mirrors the `@sa-*` JSDoc tags smart-agent uses today, hoisted into a typed value so non-JSDoc consumers can declare classification at runtime.

```ts
export interface ToolClassification {
  '@sa-tool': 'delegation-verified' | 'service-only' | 'bootstrap' | 'dev-only';
  '@sa-auth': 'session-token' | 'service-hmac' | 'none' | 'none-with-csrf';
  '@sa-validation'?: 'shape-check' | 'json-schema' | 'none-no-body' | 'none-path-params' | 'wallet-action-canonical';
  '@sa-risk-tier'?: RiskTier;
  '@sa-owner'?: string;
  '@sa-rate-limit'?: string;
  '@sa-prod-gate'?: 'enabled' | 'disabled';
}

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';
```

Smart-agent ref: `scripts/check-person-mcp-classification.ts:1-95` (the lint that enforces every callable has these tags).

---

## 3. Risk tiers — semantics

| Tier | Meaning | Default session TTL clamp | Typical caveat requirements |
| --- | --- | --- | --- |
| `low` | Read-only data; no state change | 7 days | timestamp only |
| `medium` | Mutating but bounded (profile updates, etc.) | 7 days | timestamp + mcp-tool-scope |
| `high` | Value-moving, irrevocable, or external | 1 day | timestamp + mcp-tool-scope + value-cap + data-scope |
| `critical` | Admin / governance / recovery | 1 hour or one-shot | timestamp + exact-call-policy + (often human-in-the-loop) |

Risk tier is a hint to delegation issuance for what caveats to demand; runtime enforcement reads tier + classification to decide whether the caveats present are sufficient.

Smart-agent ref: `apps/web/src/lib/auth/session-grant-defaults.ts` (the `maxRisk` field).

---

## 4. Exact-call policy DSL

For `critical` operations, a delegation should authorize **exactly one call** — a specific target contract, function selector, and (optionally) calldata hash. Anything else rejects.

```ts
export interface ExactCallPolicy {
  target: Address;
  selector: Hex;            // 4 bytes
  calldataHash?: Hex;       // 32 bytes; if set, calldata must match exactly
  valueLimit?: bigint;
}

export function exactCall(target: Address, selector: Hex, opts?: { calldataHash?: Hex; valueLimit?: bigint }): ExactCallPolicy;

export function matchesExactCall(call: { to: Address; data: Hex; value: bigint }, policy: ExactCallPolicy): boolean;
```

This is consumed by `delegation`'s `CallDataHashEnforcer` caveat builder when constructing exact-call delegations.

Smart-agent ref: `packages/sdk/src/delegation.ts:150-155` (the `CallDataHashEnforcer` caveat).

---

## 5. The decision engine

```ts
export interface PolicyContext {
  toolName: string;
  classification: ToolClassification;
  delegation?: Delegation;                // peer type from @agenticprimitives/delegation
  caveatContext?: CaveatContext;          // peer type
  callerKind: 'user-session' | 'agent-session' | 'service';
  callDetails?: { to: Address; data: Hex; value: bigint };  // for exact-call checks
}

export type PolicyDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'requires-consent'; promptId: string; risk: RiskTier };

export function evaluatePolicy(ctx: PolicyContext): PolicyDecision;
```

`evaluatePolicy` is the single function downstream runtimes call. It returns a discriminated decision; consumers wire it to their transport layer (MCP error response, A2A task rejection, LangGraph interrupt, etc.).

### Decision rules (informal)
1. If `classification['@sa-auth'] === 'none'` and `callerKind !== 'service'` → deny.
2. If `classification['@sa-tool'] === 'service-only'` and `callerKind !== 'service'` → deny.
3. If `classification['@sa-tool'] === 'delegation-verified'` and no `delegation` → deny.
4. If `classification['@sa-risk-tier'] === 'critical'` and no exact-call match → require-consent.
5. Else allow.

These rules are stable; consumers extend via composition rather than monkey-patching.

---

## 6. The lint helper

Smart-agent's classification check scripts work by parsing JSDoc tag blocks. We re-expose the parser as a callable:

```ts
export async function lintClassification(opts: {
  srcDir: string;
  requiredTags: string[];          // ['@sa-tool', '@sa-auth', '@sa-validation']
  optionalTags?: string[];
  tagBlockPattern?: RegExp;
}): Promise<{
  passed: boolean;
  errors: Array<{ file: string; line: number; missing: string[] }>;
}>;
```

Consumers wire this into their CI. `mcp-runtime` re-exports it with MCP-specific defaults via its `/lint` subpath.

Smart-agent ref: `scripts/lib/person-mcp-classification-parser.ts:1-250`.

---

## 7. Public API

```ts
// Taxonomy
export type RiskTier;
export type ToolClassification;
export function declareTool<T>(def: T, classification: ToolClassification): T & { _classification: ToolClassification };

// Exact-call DSL
export type ExactCallPolicy;
export function exactCall(target: Address, selector: Hex, opts?): ExactCallPolicy;
export function matchesExactCall(call, policy: ExactCallPolicy): boolean;

// Decision engine
export type PolicyContext, PolicyDecision;
export function evaluatePolicy(ctx: PolicyContext): PolicyDecision;

// Risk-tier helpers
export function clampTtlForRiskTier(requestedTtl: number, risk: RiskTier): number;
export function requiredCaveatsForRiskTier(risk: RiskTier): string[];

// Lint
export async function lintClassification(opts): Promise<LintResult>;
```

---

## 8. What this package does NOT own

- Transport (MCP / A2A / LangChain are runtime packages).
- Delegation mechanics (`delegation`).
- Storage (consumers wire their own audit table).
- Risk-tier ENFORCEMENT — this package decides; consumers enforce.
- UI for consent prompts (`requires-consent` returns a `promptId`; consumer renders).

---

## 9. Test plan (v0)

- Unit: classification declaration round-trip; risk-tier TTL clamp boundaries; exact-call matcher (target, selector, calldata variants).
- Decision engine: golden table of `(classification, callerKind, delegation, riskTier) → decision`.
- Lint: golden tests for each `@sa-*` tag combination; detection of missing required tags; clean exit on full classification.

---

## 10. Why protocol-agnostic matters (and how to keep it that way)

This package MUST NOT depend on `@modelcontextprotocol/sdk`, A2A SDKs, LangChain, or any specific transport. It depends only on `@agenticprimitives/types` and (optionally, as type-only imports) on `@agenticprimitives/delegation`. Adding a runtime dep on a transport package is a doctrine violation — file an issue to remove it.

This guarantees a LangGraph user (who has no MCP server) can `pnpm add @agenticprimitives/tool-policy` and get value, exactly as much as an MCP server author can.

---

## 11. Smart-agent file index

| Concern | File | Lines |
| --- | --- | --- |
| Classification scripts | `scripts/check-route-classification.ts` | 1–71 |
| Person-MCP classification | `scripts/check-person-mcp-classification.ts` | 1–95 |
| Classification parser | `scripts/lib/person-mcp-classification-parser.ts` | 1–250 |
| Risk-tier in sessions | `apps/web/src/lib/auth/session-grant-defaults.ts` | 41–86 |
| Exact-call (CallDataHashEnforcer) | `packages/sdk/src/delegation.ts` | 150–155 |
| Tool classification examples | `apps/person-mcp/src/tools/profile.ts` | 1–100 |
