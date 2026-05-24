# ADR-0012 — No `eth_getLogs` in product read paths

**Status:** Accepted (2026-05-24).
**Related:** [spec 100](../../../specs/100-package-boundary-doctrine.md),
[spec 215](../../../specs/215-agent-naming.md),
[ADR-0006](./0006-agent-naming-as-resolution-layer.md).

---

## Context

`AgentNamingClient.reverseResolve` reconstructs a human-readable name from a
on-chain namehash by scanning `NameRegistered` / `RootInitialized` logs via
`eth_getLogs`. Providers (Alchemy, Infura, QuickNode) cap block ranges per
call (~10k blocks), so the client chunks backward — but **chunking only avoids
400 errors**. It does not fix cost, latency, incomplete history, or dependence
on indexer-grade RPC behavior.

Using logs as a **default SDK read path** is the ENS-era pattern: cheap storage,
expensive reverse. We explicitly reject that for **product-facing reads** in
`packages/*`, `apps/*`, and `scripts/*` that run during normal UX (resolve,
display, policy, audit UI).

Workers (`demo-a2a`, `demo-mcp`) already follow the better shape: `readContract`
+ UserOps only.

## Decision

> **No log scans in package or app read paths.**
>
> Product-facing reads use `eth_call` / `readContract` (and batched multicall)
> only. Historical reconstruction, human-readable reverse strings, and audit
> timelines use either **on-chain stored fields** or an **explicit indexer
> service** — never inline `getLogs`, `queryFilter`, `watchContractEvent`, or
> equivalent viem/ethers helpers in hot paths.

### Allowed

| Mechanism | When |
| --- | --- |
| `readContract` / `eth_call` | Default for all package + app reads |
| On-chain stored label / name string | Reverse resolve without an indexer |
| Dedicated indexer (subgraph, worker DB, `apps/*/indexer`) | Ingest events **once** at write time; clients query HTTP/DB |
| App-local cache | Demo / session: persist `address → name` after registration |
| One-off **ops** scripts under `scripts/` | Migration, forensics, deploy debugging — not imported by packages |

### Forbidden in hot paths

- `publicClient.getLogs` / `provider.getLogs`
- `contract.queryFilter` / `queryFilter`
- `watchContractEvent` / `watchEvent` for building read models
- Unbounded `fromBlock: 0n` scans from SDK clients

Chunking log ranges **does not** make an otherwise forbidden path allowed.

### Approved alternatives for reverse name strings

The registry currently stores `labelhash` + `parent`, not plaintext `label`
([`AgentNameRegistry.sol`](../../../apps/contracts/src/naming/AgentNameRegistry.sol)).
To remove log dependence, pick one:

1. **Contract:** store `string label` (or full dotted name) in `NameRecord` or a
   `reverseName(agent)` mapping — reverse becomes O(depth) `readContract` walks.
2. **Indexer:** naming indexer keyed by `node` and `address`; SDK calls indexer
   or accepts injected `NameContext` from the app.
3. **Weaker API:** return namehash / node only from chain; human string from
   cache (document in API).

## Known exception (transitional) — RESOLVED 2026-05-24

The single transitional exception — `_reconstructName` / `_findRegisteredEvent`
/ `_findRootEvent` / `_iterChunks` in `packages/agent-naming/src/client.ts` —
**has been removed.** [spec/222](../../../specs/222-ens-aligned-reverse-resolution.md)
`reverseResolveString` landed, so `reverseResolve` is now a single view call with
no log walk and no fallback (see [ADR-0013](./0013-no-silent-fallbacks.md)).
There are now **zero** `eth_getLogs` walkers in any product read path.

If a future feature needs event history (audit feed, treasury timeline, edge
log), design an indexer first or factor shared **indexer-client** utilities —
never reintroduce an RPC log walk in a capability package.

The exit path: ENS stores the reverse string on a dedicated resolver and
returns it via a single `readContract` — no event walk required. Our
`AgentNameRegistry` stores only the namehash node, forcing the SDK into
log scans. [spec/222](../../../specs/222-ens-aligned-reverse-resolution.md)
proposes the ENS-aligned fix: add `ATL_LABEL` per node (Option A,
incremental) or a dedicated `ReverseResolver` contract (Option B, full
ENS-style). Either replaces `_reconstructName` with view-call-only reads.

## Consequences

**Positive:**

- Predictable RPC cost and provider compatibility for demos and production.
- Forces explicit read models (storage or indexer) instead of accidental ENS
  reverse dependencies.
- Aligns workers and SDK on `readContract`-first discipline.

**Negative:**

- `reverseResolve` string return remains log-backed until contract or indexer
  lands — document as technical debt, not pattern.
- Short-term indexer work for any feature that needs chain history.

## Cross-references

- [spec 100 § RPC read discipline](../../../specs/100-package-boundary-doctrine.md)
- [spec 215 §12 — read-path discipline](../../../specs/215-agent-naming.md) (acceptance criteria: §13)
- [`packages/agent-naming/docs/security.md`](../../../packages/agent-naming/docs/security.md)
