# @agenticprimitives/mcp-runtime

Delegation-aware authorization middleware around the official MCP TypeScript SDK. Eliminates the ~65% code duplication observed across smart-agent's three mature MCP servers (`person-mcp`, `org-mcp`, `people-group-mcp`).

This package is the **decision layer**, not the SDK. The official `@modelcontextprotocol/sdk` already provides tool/resource/prompt registration, transports, and OAuth 2.1+PKCE+RFC-9728+RFC-8707 plumbing (mandated by the 2026-03-15 MCP spec). We add the bridge to `@agenticprimitives/delegation` + `@agenticprimitives/tool-policy`.

See [`spec.md`](./spec.md) → [`specs/205-mcp-runtime.md`](../../specs/205-mcp-runtime.md).

## Quick start

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server';
import { withDelegation, createSqliteJtiStore } from '@agenticprimitives/mcp-runtime';

const config = {
  audience: 'urn:mcp:server:person',
  chainId: 31337,
  rpcUrl: process.env.RPC_URL!,
  delegationManager: process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`,
  enforcerMap,
  jtiStore: createSqliteJtiStore(db, 'token_usage'),
};

const server = new McpServer({ name: 'person-mcp', version: '0.1.0' });

server.registerTool({
  name: 'get_profile',
  inputSchema: { type: 'object', properties: { token: { type: 'string' } } },
  handler: withDelegation(config, async ({ principal }) => {
    return db.profiles.findUnique({ where: { ownerAddress: principal } });
  }),
});
```

The handler no longer touches auth. The wrapper performs: HMAC envelope check → session-key signature → EIP-712 hash → on-chain `isRevoked` → ERC-1271 verify → caveat eval (fail-closed) → JTI usage tracking → `tool-policy.evaluatePolicy` → hand `{ principal, grants? }` to the inner handler.

## Cross-delegation

**Removed from the public surface in H7-B.8** (XPKG-002 / EXT-024 closure). The previous `withCrossDelegation` was a stub that unconditionally rejected. Per spec 100 §6, experimental capability lives behind a `./experimental` subpath; when cross-delegation work resumes it lands there. See [`docs/audits/2026-05-packages-contracts-production-readiness.md`](../../docs/audits/2026-05-packages-contracts-production-readiness.md) (PKG-mcp-runtime-001).

## Status

Alpha track — testnet-only. Spec + API stable; do not deploy to production until the gates listed in the root [`README.md` Status section](../../README.md#status) are cleared.
