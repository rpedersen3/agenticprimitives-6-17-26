# @agenticprimitives/identity-directory

**Fast lookups that cannot mint trust.** Every identity system eventually grows a directory — and most directories quietly become a second authority: a cache that sessions get issued against, an index whose stale row revives a revoked credential. This package is the read side of the identity stack built so that failure mode is structurally impossible. It answers *"which agent(s) does this name / credential / OIDC subject resolve to, and on what evidence?"* — every association carries provenance and an assurance level, the indexer only ever *proposes*, and on-chain state *confirms*. The output accelerates discovery; it never grants custody or value ([ADR-0015](../../docs/architecture/decisions/0015-identity-directory-is-an-evidence-backed-read-model.md), [spec 223](../../specs/223-identity-directory.md)).

Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

Everything keys on `CanonicalAgentId` (CAIP-10) — because the address IS the identity, and names, credentials, and OIDC subjects are facets the directory resolves *back to* that anchor.

## Ports + adapters

The core declares the ports; the implementations live in [`@agenticprimitives/identity-directory-adapters`](../identity-directory-adapters):

```
NamingPort      forward/reverse name ↔ agent (wraps agent-naming)
OnChainReadPort exists / confirmsCredential — readContract only, NEVER getLogs
IndexerPort     agentsByCredential / agentsByOidcSubject — the "indexed registry" home
```

The core imports no source SDK — only `types`, `audit`, and `ontology`. That firewall is what keeps the read model honest about where each piece of evidence came from.

## Usage

```ts
import { createDirectory } from '@agenticprimitives/identity-directory';
import { makeAdapters } from '@agenticprimitives/identity-directory-adapters'; // (separate pkg)

const dir = createDirectory(makeAdapters({ /* viem client, naming, indexer */ }));
const r = await dir.resolveByCredential(principal); // 0 | 1 | many agents, each with evidence
```

Queries: `resolveByName`, `resolveByCredential`, `resolveByOidcSubject`, `agent`. Each result is a `Resolution` of `AgentWithEvidence` — provenance, `Assurance` ordering (`ASSURANCE_ORDER`, `compareAssurance`, `maxAssurance`), and block numbers, not bare addresses.

## How it's different

The competing category is **indexers and directory products** — subgraph-style indexes, registry crawlers, identity-resolution APIs. They optimize for recall; this package optimizes for *not being lied to*:

- **Indexer proposes, on-chain confirms.** `resolveByCredential` / `resolveByOidcSubject` upgrade to `onchain-confirmed` only when the credential is in the agent's *current* on-chain set. A revoked credential is dropped — a poisoned or stale index entry can never, by itself, resolve.
- **Evidence is the product.** A typical directory returns matches; this one returns matches with provenance and assurance on every association, so the consumer (e.g. the session broker, spec 224) can branch on what kind of proof it is holding.
- **No silent fallbacks, no log walks.** One mechanism per query; an empty port result is terminal, never an excuse to escalate to a different, weaker mechanism ([ADR-0013](../../docs/architecture/decisions/0013-no-silent-fallbacks.md)). Indexed reads go through `IndexerPort` only — no `eth_getLogs` in product read paths ([ADR-0012](../../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md)).
- **Explicitly not an authority.** Resolution output is never the gate for custody or value; consumers re-read on-chain for those decisions. Most directory products cannot make that promise because nothing in their architecture enforces it. Here it is the design.

## Convergence

`Resolution.agents.length` is the convergence cardinality the broker (spec 224) branches on: **0** → bootstrap, **1** → the common case, **many** → disambiguate.

## Validation

```bash
pnpm --filter @agenticprimitives/identity-directory typecheck
pnpm --filter @agenticprimitives/identity-directory test
pnpm check:forbidden-terms
```

## Status

Testnet/pilot-ready. Production launch is gated on the public checklist in the root [`README.md`](../../README.md#status--honest-version) — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml). Note the production SPARQL/GraphDB indexer adapter is roadmap (spec 225 §7); today's reference indexer is in-memory, in the adapters package.

## License

UNLICENSED (internal monorepo, not published).
