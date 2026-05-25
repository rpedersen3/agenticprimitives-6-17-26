# @agenticprimitives/identity-directory

An **evidence-backed read model** over canonical agents and their facets — the
read side of the identity stack ([ADR-0015](../../docs/architecture/decisions/0015-identity-directory-is-an-evidence-backed-read-model.md);
[spec 223](../../specs/223-identity-directory.md)).

It answers *"which agent(s) does this name / credential / OIDC subject resolve to,
and on what evidence?"* — keyed on `CanonicalAgentId` (CAIP-10), with provenance +
assurance on every association. It is **not an authority**: it accelerates
discovery; the consumer re-reads on-chain for custody decisions.

## Ports + adapters

The core declares the ports; the implementations live in
[`@agenticprimitives/identity-directory-adapters`](../identity-directory-adapters):

```
NamingPort      forward/reverse name ↔ agent (wraps agent-naming)
OnChainReadPort resolveAgent / credentialsOf — readContract only, NEVER getLogs
IndexerPort     agentsByCredential / agentsByOidcSubject — the "indexed registry" home
```

## Usage

```ts
import { createDirectory } from '@agenticprimitives/identity-directory';
import { makeAdapters } from '@agenticprimitives/identity-directory-adapters'; // (separate pkg)

const dir = createDirectory(makeAdapters({ /* viem client, naming, indexer */ }));
const r = await dir.resolveByCredential(principal); // 0 | 1 | many agents, each with evidence
```

## Doctrine (load-bearing)

- **No fallback** ([ADR-0013](../../docs/architecture/decisions/0013-no-silent-fallbacks.md)):
  one mechanism per query; a `null`/empty port result is terminal.
- **No `eth_getLogs`** ([ADR-0012](../../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md)):
  indexed reads go through `IndexerPort`.
- **Indexer proposes, on-chain confirms:** `resolveByCredential` /
  `resolveByOidcSubject` upgrade to `onchain-confirmed` only when the credential is
  in the agent's *current* on-chain set — a revoked credential is dropped.
- **Not an authority** ([ADR-0015](../../docs/architecture/decisions/0015-identity-directory-is-an-evidence-backed-read-model.md)):
  resolution output never grants custody or value.

## Convergence

`Resolution.agents.length` is the convergence cardinality the broker (spec 224)
branches on: **0** → bootstrap, **1** → the common case, **many** → disambiguate.
