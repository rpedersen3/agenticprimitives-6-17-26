# @agenticprimitives/delegation

EIP-712 smart-account delegations with on-chain + off-chain caveats. Issue, mint, verify, and revoke delegation tokens that span web app → agent → MCP server.

See [`spec.md`](./spec.md) for the full contract, including the eight on-chain enforcers, three off-chain sentinels, and the cross-delegation flow.

## Quick start

```ts
import { DelegationClient, buildMcpToolScopeCaveat, encodeTimestampTerms, buildCaveat } from '@agenticprimitives/delegation';

const client = new DelegationClient({ walletClient, smartAccount, chainId, delegationManager });

const delegation = await client.issueDelegation({
  delegate: sessionKeyAddress,
  caveats: [
    buildCaveat(enforcers.timestamp, encodeTimestampTerms(now, now + 86400)),
    buildMcpToolScopeCaveat(['get_profile', 'update_profile']),
  ],
});
```

On the MCP side:

```ts
import { verifyDelegationToken } from '@agenticprimitives/delegation';

const result = await verifyDelegationToken(token, { chainId, delegationManager, rpcUrl, audience, enforcerMap, jtiStore });
if ('error' in result) throw new Error(result.error);
const { principal, grants } = result;
```

## Status

Pre-alpha. Spec stable.
