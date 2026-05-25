# @agenticprimitives/identity-directory-adapters

Port implementations for [`@agenticprimitives/identity-directory`](../identity-directory)
(spec 223 / [ADR-0015](../../docs/architecture/decisions/0015-identity-directory-is-an-evidence-backed-read-model.md)).
The composition layer that binds the directory's ports to real sources — and the
**one package allowed to import `agent-naming`** (spec 100 §4). The directory core
stays source-agnostic.

## What's here

```
makeNamingPort({ client, chainId })   wrap agent-naming + eip155 Address↔CanonicalAgentId lift
makeOnChainReadPort(readers)          assemble OnChainReadPort from { exists, confirmsCredential }
viemExists(client)                    a contract-agnostic exists (bytecode-at-address)
createInMemoryIndexer(entries)        an in-memory IndexerPort (demo + tests)
toCanonicalAgentId / addressOf        eip155 CAIP-10 glue
```

## Usage

```ts
import { createDirectory } from '@agenticprimitives/identity-directory';
import {
  makeNamingPort, makeOnChainReadPort, viemExists, createInMemoryIndexer,
} from '@agenticprimitives/identity-directory-adapters';

const dir = createDirectory({
  naming: makeNamingPort({ client: namingClient, chainId: 8453 }),
  onChain: makeOnChainReadPort({
    exists: viemExists(publicClient),
    // app-wired to the real membership getter (isCustodian/isTrustee):
    confirmsCredential: async (id, p) => publicClient.readContract({ /* … */ }),
  }),
  indexer: createInMemoryIndexer(seedEntries),
});
```

## Boundaries

- `confirmsCredential` is **app-wired** — the on-chain membership getter is
  contract- and credential-kind-specific (an EOA address vs a passkey
  `credentialIdDigest`), so this package does not guess it. It MUST reflect the
  *current* set so a revoked credential returns `false` (the directory drops it).
- The in-memory indexer is **non-authoritative** — it proposes candidates; the
  directory confirms them on-chain. The production indexer is a SPARQL/GraphDB
  adapter (spec 225 §7), landing later.
- CAIP-10 here is **eip155-only glue**; the canonical multi-namespace builder is
  `@agenticprimitives/agent-profile` (`/caip10`), kept out of this adapter's deps.
