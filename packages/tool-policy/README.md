# @agenticprimitives/tool-policy

Protocol-agnostic classification, risk tiers, and exact-call policy primitives. Consumable by MCP, A2A, LangGraph, Vercel AI — any tool runtime.

This package is **deliberately transport-free**: no MCP SDK, no LangChain, no Vercel imports. That's what lets a LangGraph user `pnpm add` it without buying into MCP middleware, and what lets `@agenticprimitives/mcp-runtime` use it without being the only consumer.

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

```ts
import { exactCall, matchesExactCall } from '@agenticprimitives/tool-policy';

const policy = exactCall(safeAddress, '0xa9059cbb', {
  calldataHash: '0xdeadbeef...',
  valueLimit: 0n,
});

const ok = matchesExactCall({ to, data, value }, policy);
```

## Status

Alpha track — testnet-only. Spec + API stable; do not deploy to production until the gates listed in the root [`README.md` Status section](../../README.md#status) are cleared.
