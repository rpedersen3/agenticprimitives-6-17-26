# @agenticprimitives/delegation

EIP-712 smart-account delegations spanning web app → agent → MCP. **Now also owns session lifecycle** — `SessionManager` binds a delegation to its session-signing key, persisted via `@agenticprimitives/key-custody` envelope encryption.

See [`spec.md`](./spec.md) → [`specs/202-delegation.md`](../../specs/202-delegation.md) for the full contract: 8 on-chain enforcers, 3 off-chain sentinels, token envelope, cross-delegation, two session variants.

## Quick start

Browser (issuance):
```ts
import { DelegationClient, buildMcpToolScopeCaveat, encodeTimestampTerms, buildCaveat } from '@agenticprimitives/delegation';

const client = new DelegationClient({ signer, smartAccount, chainId, delegationManager });
const delegation = await client.issueDelegation({
  delegate: sessionKeyAddress,
  caveats: [
    buildCaveat(enforcers.timestamp, encodeTimestampTerms(now, now + 86400)),
    buildMcpToolScopeCaveat(['get_profile', 'update_profile']),
  ],
});
```

Node (session lifecycle):
```ts
import { SessionManager } from '@agenticprimitives/delegation';

const sessions = new SessionManager({ keyCustody, store, accountClient });
const { sessionId, sessionKeyAddress } = await sessions.init(userAccount, chainId);
// ... user signs delegation, posts back ...
await sessions.package(sessionId, signedDelegation);
```

Node (token mint + verify):
```ts
import { mintDelegationToken, verifyDelegationToken } from '@agenticprimitives/delegation';

const { token } = await mintDelegationToken(claims, sessionAccount.signMessage);
// At the MCP:
const result = await verifyDelegationToken(token, { chainId, delegationManager, rpcUrl, audience, enforcerMap, jtiStore });
if ('error' in result) throw new Error(result.error);
const { principal, grants } = result;
```

## Status

Pre-alpha. Spec stable.
