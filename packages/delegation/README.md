# @agenticprimitives/delegation

**One delegation model, everywhere — permissions, never keys.**

When an agent acts for a human, most stacks hand it a key and hope. This package hands it a delegation instead: an EIP-712 signed grant from a Smart Agent, constrained by caveats that on-chain enforcers actually check — time windows, value caps, allowed targets and methods, quorums — and revocable on-chain at any moment. The same primitive spans the whole stack: a web app session, an agent-to-agent call, and an MCP tool invocation all verify against the same `Delegation` struct. "This session may call these two tools until tomorrow, and I can kill it instantly" is one signed object, not three products.

The package also owns session lifecycle: `SessionManager` binds a delegation to its session-signing key, with the private key envelope-encrypted via `@agenticprimitives/key-custody` before it ever touches storage. Verification is fail-closed by design — an unknown enforcer is a rejection, not a warning — and minted tokens carry JTI replay protection. Because the principal is the Smart Agent address, not a credential, every delegation survives the issuer's credential rotation; and because custody is firewalled from delegation, no delegate can ever escalate into account control ([ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)).

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

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

`principal` is the verified delegator's Smart Agent address — every downstream action is attributable to a canonical on-chain identity, not an API key.

## How it's different

The closest neighbors are MetaMask's Delegation Toolkit and the session-key features in smart-account SDKs — both real, both well-built, and the caveat-enforcer shape here deliberately mirrors the ERC-7710 direction so the models stay interoperable. The differences are scope and posture. Session keys typically live and die inside one wallet stack and one transport; this delegation crosses transports — the token a browser session mints is the token an MCP server or A2A endpoint verifies, against the same on-chain enforcer registry. And the evaluator's posture is fail-closed as a hard invariant: unknown enforcer means reject, with no permissive default to quietly widen authority. Custody operations are structurally excluded — a delegation here cannot rotate credentials or change account control, ever, because that path doesn't exist in this package.

## Status

**Alpha track — testnet-only.** Spec + API stable; do not deploy to production until the gates listed in the root [`README.md` Status section](../../README.md#status) are cleared — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).
