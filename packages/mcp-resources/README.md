# @agenticprimitives/mcp-resources

Delegation-aware resource access management for MCP servers. Eliminates the boilerplate that smart-agent's `person-mcp`, `org-mcp`, and `people-group-mcp` each duplicated (~500 lines each of identical auth-pipeline code).

See [`spec.md`](./spec.md) for the full contract.

## Quick start

```ts
import { withDelegation, createSqliteJtiStore } from '@agenticprimitives/mcp-resources';

const config = {
  audience: 'urn:mcp:server:person',
  chainId: 31337,
  rpcUrl: process.env.RPC_URL!,
  delegationManager: process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`,
  enforcerMap,
  jtiStore: createSqliteJtiStore(db, 'token_usage'),
};

export const getProfileTool = {
  name: 'get_profile',
  inputSchema: { type: 'object', properties: { token: { type: 'string' } } },
  handler: withDelegation(config, async ({ principal }) => {
    return db.profiles.findUnique({ where: { ownerAddress: principal } });
  }),
};
```

## Status

Pre-alpha. Spec stable.
