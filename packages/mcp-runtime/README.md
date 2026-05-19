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

```ts
import { withCrossDelegation } from '@agenticprimitives/mcp-runtime';

server.registerTool({
  name: 'get_delegated_profile',
  handler: withCrossDelegation(config, async ({ dataPrincipal, grants }) => {
    // dataPrincipal = the user whose data is being read
    // callerPrincipal = the agent reading it
    // grants = DataScopeGrant[] filtered to this audience
    return db.profiles.findUnique({ where: { ownerAddress: dataPrincipal } });
  }),
});
```

## Status

Pre-alpha. Spec stable.
