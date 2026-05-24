# @agenticprimitives/agent-naming

ENS-v2-style hierarchical naming for Smart Agents.

Smart Agents get human-readable names like `alice.agent`,
`acme.agent`, `treasury.acme.agent`. Names route to on-chain Smart
Agent addresses (forward resolution), Smart Agents route back to
their primary name (reverse resolution), and per-name records expose
machine-readable endpoints (`a2a-endpoint`, `mcp-endpoint`,
`display-name`, etc.) so service discovery doesn't hardcode URLs.

## Status

**Phase 1** — pure SDK + spec + API skeleton. Read methods on the
client throw `NS Phase 2`; write methods throw `NS Phase 4`. The
shape is locked so demos can be written against it before contracts
deploy.

See [`specs/215-agent-naming.md`](../../specs/215-agent-naming.md)
for the full design + the phase plan.

## Install

This package is workspace-internal in the agenticprimitives monorepo
and not yet published.

## Usage

```ts
import {
  AGENT_TLD,
  normalizeAgentName,
  namehash,
  labelhash,
  AgentNamingClient,
  type AgentNameRecords,
} from '@agenticprimitives/agent-naming';

// Pure helpers — work in browser, Worker, Node.
normalizeAgentName('  ALICE.AGENT  ');   // 'alice.agent'
labelhash('alice');                      // 0x...
namehash('treasury.acme.agent');         // 0x...

// Client (Phase 2+).
const naming = new AgentNamingClient({
  rpcUrl: 'https://base-sepolia.g.alchemy.com/v2/...',
  chainId: 84532,
  registry: '0x...',           // AgentNameRegistry deployment
  universalResolver: '0x...',  // AgentNameUniversalResolver deployment
});

const addr = await naming.resolveName('alice.agent');
const name = await naming.reverseResolve('0x...');
const records: AgentNameRecords = await naming.getRecords('treasury.acme.agent');
```

## Records subpath

```ts
import { encodeRecords, decodeRecords, PREDICATE } from '@agenticprimitives/agent-naming/records';

const pairs = encodeRecords({
  addr: '0x...',
  agentKind: 'org',
  displayName: 'Acme Construction',
  a2aEndpoint: 'https://demo-a2a.example/',
});
// → [['addr', '0x...'], ['agent-kind', 'org'], …]

const records = decodeRecords({ addr: '0x...', 'agent-kind': 'person' });
// → { addr: '0x...', agentKind: 'person' }
```

Unknown predicate keys are dropped on decode (fail-closed read) and
rejected on encode (fail-loud write).

## Custody subpath

```ts
import { buildRotateNameOwnerCall, buildRotateNameResolverCall } from '@agenticprimitives/agent-naming/custody';
```

Pure encoded call builders that compose with the `@agenticprimitives/custody`
schedule/apply ceremony **without** importing the custody package (the
package-boundary doctrine — spec 215 § 3).

## Security invariants

- Name normalization is deterministic. Two strings that normalize
  identically produce identical namehashes.
- Reverse resolution requires round-trip verification.
- No raw passkey material in records (only `credentialIdDigest`, a
  hash).
- Write methods require the name owner's signature (verified via
  ERC-1271 on the owning Smart Agent).
- Fail-closed on unknown predicates.

See `AUDIT.md` for the package audit + open findings.

## License

UNLICENSED (internal monorepo, not published).
