# @agenticprimitives/identity-directory-adapters — Claude guide

## The composition layer (the only new naming consumer)
Implements the ports declared by [`identity-directory`](../identity-directory)
(spec 223 §5). This is the **one package allowed to import `agent-naming`**
(spec 100 §4 / [ADR-0015](../../docs/architecture/decisions/0015-identity-directory-is-an-evidence-backed-read-model.md));
the directory *core* stays source-agnostic. Apps + the `connect` broker wire these
adapters into `createDirectory`.

## What this package owns
- **`makeNamingPort({ client, chainId })`** — wraps an `agent-naming` read client
  (`resolveName`/`reverseResolve`) + the eip155 `Address ↔ CanonicalAgentId` lift.
- **`makeOnChainReadPort(readers)`** + **`viemExists(client)`** — `exists` is a
  contract-agnostic bytecode-at-address check; `confirmsCredential` (the
  `isCustodian`/`isTrustee` membership check) is **app-wired** because the getter
  is contract- + credential-kind-specific.
- **`createInMemoryIndexer(entries)`** — an in-memory `IndexerPort` for demo/tests.
- **`toCanonicalAgentId` / `addressOf` / `EIP155_NAMESPACE`** — eip155-only CAIP-10
  glue (the canonical multi-namespace builder is `agent-profile`'s, kept out of
  this adapter's deps).

## What this package does NOT own
- The ports / domain model / resolution logic → `identity-directory` (core).
- OIDC verification → `connect-auth`. Session minting → `connect`.
- The canonical multi-namespace CAIP-10 builder → `agent-profile` (`/caip10`).
- The production SPARQL/GraphDB indexer → a later adapter (spec 225 §7); this
  ships the in-memory one only.
- Custody / credential rotation → `account-custody`.

## Vocabulary
**Owns:** `makeNamingPort`, `makeOnChainReadPort`, `viemExists`,
`createInMemoryIndexer`, `NamingReads`, `OnChainReaders`, `IndexerEntry`,
`toCanonicalAgentId`, `addressOf`. **"adapter"** = a port implementation; it adds
no policy of its own. See [`docs/architecture/vocabulary-map.md`](../../docs/architecture/vocabulary-map.md).
**Does not use:** `Delegation`, `Caveat`, `evaluatePolicy`, `withDelegation`, `SessionManager`.

## Read these first (in order)
1. `capability.manifest.json` — boundary (types + identity-directory + agent-naming + viem).
2. `../../specs/223-identity-directory.md` — the ports' contract.
3. `../identity-directory/src/types.ts` — the port interfaces these implement.
4. `src/naming.ts` / `src/onchain.ts` / `src/indexer.ts`.

## Stable public exports
`toCanonicalAgentId`, `addressOf`, `EIP155_NAMESPACE`, `makeNamingPort`
(+ `NamingReads`), `makeOnChainReadPort` / `viemExists` (+ `OnChainReaders`),
`createInMemoryIndexer` (+ `IndexerEntry`).

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/identity-directory`,
`@agenticprimitives/agent-naming`, `viem`.

## Forbidden imports
- `apps/*`
- `agent-profile` / `agent-relationships` (use only `agent-naming`; the CAIP-10
  glue here is eip155-local, NOT agent-profile's builder).
- Every other `@agenticprimitives/*` (audit, ontology, connect-auth, delegation, …).

## Drift triggers — STOP and route
- "Add resolution/convergence logic here" — **STOP.** That is the directory core;
  adapters only translate a source into a port.
- "Guess the on-chain custodian getter / hardcode an ABI call for
  `confirmsCredential`" — **STOP.** It is contract-specific; accept it as an
  injected reader (the app wires the real getter).
- "Import `agent-profile` for `buildCaip10Address`" — **STOP.** This adapter is
  eip155-only; use the local glue. agent-profile is out of the dep set (spec 100 §4).
- "Add a `try naming catch onchain` fallback" — **STOP.** Each port is one
  mechanism; the core never escalates (ADR-0013).

## Before you write code
- [ ] Is the change a port implementation (naming / on-chain / indexer)?
- [ ] Did I keep authority on-chain — `confirmsCredential` reflects the CURRENT
      set so a revoked credential returns false (audit P1-3)?
- [ ] Did I avoid importing anything beyond types / identity-directory /
      agent-naming / viem?
- [ ] Is the indexer treated as NON-authoritative (proposes only)?

## Security invariants (DO NOT BREAK)
- **On-chain stays authoritative.** The in-memory indexer only PROPOSES; the
  directory confirms via `OnChainReadPort` (spec 223 §7). A poisoned/stale index
  entry can never, by itself, authorize.
- **`confirmsCredential` is current.** Wire it to a live membership read; never to
  a cached/event-derived list that could revive a revoked credential.
- **No getLogs / no fallback.** `readContract`/getCode reads only; one mechanism
  per port (ADR-0012/0013).

## Validate the package
```bash
pnpm --filter @agenticprimitives/identity-directory build   # core dist (vitest resolution)
pnpm --filter @agenticprimitives/identity-directory-adapters typecheck
pnpm --filter @agenticprimitives/identity-directory-adapters test
pnpm check:forbidden-terms
```

## Common task routing
- New source for an existing port → a new `make<Port>FromX` factory in the port's file.
- Production indexer (SPARQL/GraphDB) → a new `src/sparql-indexer.ts` adapter.
- New port → add the interface in `identity-directory` core FIRST, then implement here.

## Capabilities this package participates in
- **Identity resolution / knowledge graph** — the source-binding half of the
  directory capability (pairs with `identity-directory` core + `agent-naming`).
- Index: [`docs/architecture/cross-cutting-capabilities.md`](../../docs/architecture/cross-cutting-capabilities.md).

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
