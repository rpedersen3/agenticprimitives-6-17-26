# @agenticprimitives/tool-policy

**One delegation model, everywhere — and this is the layer that decides.**

Agents are getting tool access faster than anyone is deciding what those tools should be allowed to do. The usual answer is an OAuth scope string or an API key with a prayer attached — coarse, transport-bound, and silent about risk. This package is the missing decision layer: a classification taxonomy (`@sa-tool`, `@sa-auth`, `@sa-validation`, `@sa-risk-tier` and friends), risk tiers with TTL clamps and required-caveat lookups, an exact-call DSL for byte-precise on-chain calls, and a deterministic decision engine — `evaluatePolicy(ctx)` returns `allow`, `deny`, or `requires-consent`, the same answer for the same input, every time. Unknown classification fields fail closed.

It is **deliberately transport-free**: no MCP SDK, no LangChain, no Vercel AI imports ([ADR-0003](../../docs/architecture/decisions/0003-tool-policy-protocol-agnostic.md)). A LangGraph user can `pnpm add` it without buying into MCP middleware, and `@agenticprimitives/mcp-runtime` consumes it without being the only consumer. This package decides; your runtime enforces.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

See [`spec.md`](./spec.md) → [`specs/204-tool-policy.md`](../../specs/204-tool-policy.md).

## Quick start

```ts
import { declareTool, evaluatePolicy } from '@agenticprimitives/tool-policy';

const getProfileTool = declareTool(
  { name: 'get_profile', inputSchema: { /* ... */ }, handler: /* ... */ },
  {
    '@sa-tool': 'delegation-verified',
    '@sa-auth': 'session-token',
    '@sa-validation': 'shape-check',
    '@sa-risk-tier': 'low',
  },
);

const decision = evaluatePolicy({
  toolName: 'get_profile',
  classification: getProfileTool._classification,
  delegation,             // from @agenticprimitives/delegation
  callerKind: 'user-session',
});

if (decision.decision === 'deny') throw new Error(decision.reason);
if (decision.decision === 'requires-consent') /* prompt user */;
```

## Exact-call policy

When "roughly this kind of call" is not good enough, pin the exact one:

```ts
import { exactCall, matchesExactCall } from '@agenticprimitives/tool-policy';

const policy = exactCall(safeAddress, '0xa9059cbb', {
  calldataHash: '0xdeadbeef...',
  valueLimit: 0n,
});

const ok = matchesExactCall({ to, data, value }, policy);
```

When `calldataHash` is set, matching is byte-identical — no partial-match shortcuts.

## How it's different

OAuth scopes and general-purpose policy engines (OPA-style) are the incumbents here, and both have a gap this package targets. Scopes are static strings granted at consent time; they know nothing about risk tiers, value limits, or the delegation a caller actually holds. Policy engines are powerful but generic — you bring your own identity model, your own risk taxonomy, and your own integration glue per transport. This package ships the agent-tooling-specific layer pre-built: a risk taxonomy designed for tool calls, decisions that compose with `Delegation` objects from `@agenticprimitives/delegation` (consumed type-only — no runtime coupling), and a deterministic, side-effect-free engine you can golden-test. The decision an MCP server enforces is the same decision a LangGraph or A2A runtime would get, because the policy layer never learned what transport it lives in.

## Validate

```bash
pnpm --filter @agenticprimitives/tool-policy typecheck
pnpm --filter @agenticprimitives/tool-policy test
```

## Status

**Alpha track — testnet-only.** Spec + API stable; do not deploy to production until the gates listed in the root [`README.md` Status section](../../README.md#status) are cleared — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).
