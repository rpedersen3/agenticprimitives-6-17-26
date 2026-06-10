# @agenticprimitives/identity-directory-adapters

**The binding layer that keeps the directory honest.** [`identity-directory`](../identity-directory) can promise "indexer proposes, on-chain confirms" only because its core never touches a real data source — it declares ports, and this package implements them. That separation is enforced, not aspirational: this is the **one package allowed to import `agent-naming`** (spec 100 §4 / [ADR-0015](../../docs/architecture/decisions/0015-identity-directory-is-an-evidence-backed-read-model.md)), so every naming read in the identity stack flows through one auditable seam. Adapters translate sources into ports and add no policy of their own.

Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

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

## How it's different

The competing pattern is the **monolithic indexer/resolver SDK** — one client that talks to every source and bakes resolution policy into the data access. The cost shows up later: you cannot swap a source, cannot audit which mechanism answered a query, and the index silently becomes authoritative. The ports-and-adapters split here means:

- **Sources are swappable.** Naming, on-chain reads, and the indexer are independent factories; a new source for an existing port is one new factory, not a rewrite.
- **Authority placement is visible in the types.** `confirmsCredential` is a live on-chain membership check, the indexer is a proposer — the interfaces make it impossible to confuse the two.
- **No adapter ever escalates.** Each port is one mechanism; there is no `try naming, catch → on-chain` fallback anywhere ([ADR-0013](../../docs/architecture/decisions/0013-no-silent-fallbacks.md)), and reads are `readContract`/`getCode` only — never `eth_getLogs` ([ADR-0012](../../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md)).

## Boundaries

- `confirmsCredential` is **app-wired** — the on-chain membership getter is contract- and credential-kind-specific (an EOA address vs a passkey `credentialIdDigest`), so this package does not guess it. It MUST reflect the *current* set so a revoked credential returns `false` (the directory drops it). Never wire it to a cached or event-derived list that could revive a revoked credential.
- The in-memory indexer is **non-authoritative** — it proposes candidates; the directory confirms them on-chain. The production indexer is a SPARQL/GraphDB adapter (spec 225 §7), landing later.
- CAIP-10 here is **eip155-only glue**; the canonical multi-namespace builder is `@agenticprimitives/agent-profile` (`/caip10`), deliberately kept out of this adapter's dependency set.

## Validation

```bash
pnpm --filter @agenticprimitives/identity-directory build   # core dist (vitest resolution)
pnpm --filter @agenticprimitives/identity-directory-adapters typecheck
pnpm --filter @agenticprimitives/identity-directory-adapters test
pnpm check:forbidden-terms
```

## Status

Testnet/pilot-ready. Production launch is gated on the public checklist in the root [`README.md`](../../README.md#status--honest-version) — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml). The shipped indexer is the in-memory reference (demo + tests); the production SPARQL/GraphDB adapter is roadmap.

## License

UNLICENSED (internal monorepo, not published).
