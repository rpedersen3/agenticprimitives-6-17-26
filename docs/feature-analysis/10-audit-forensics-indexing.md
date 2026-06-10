# 10 — Audit, forensics, observability & indexing

**Focus area:** evidence trails of agent actions, chain-history indexing, agent observability/tracing, compliance reporting.
**AP packages in scope:** audit discipline in `mcp-runtime` + `demo-mcp` (`apps/demo-mcp/docs/audit/guide.md`), `attestations`/`agreements` (on-chain anchors); ADR-0012 (no `eth_getLogs` in product read paths → indexer required).
**AP capability today:** per-tool-call audit evidence in demo-mcp (token, caveats, decision, JTI); on-chain anchors for agreements/attestations; explicit doctrine that chain history must come from an indexer or app cache — **but no indexer exists yet**.

> Gap layers: `[Contracts]` Solidity surface · `[SDK]` TS packages/backends · `[UX]` product surface (**deferred**). See [index](index.md#gap-layers-every-gap-is-classified-into-exactly-one).

---

## Category verdict at a glance

| Product | Type | Tags | Verdict |
| --- | --- | --- | --- |
| The Graph / subgraphs | OSS + network | AUDIT DIR | **Integrate** (canonical indexer answer) |
| Ponder | OSS | AUDIT | **Integrate option** (TS-native indexer, fits stack) |
| Envio / HyperIndex | Commercial + OSS | AUDIT | Track (fast EVM indexing) |
| Dune | Commercial | AUDIT | Track (analytics, not product reads) |
| Tenderly | Commercial | AUDIT | Adopt patterns (simulation + alerting) |
| LangSmith / LangFuse | Commercial + OSS | AUDIT MCP | **Integrate** (agent tracing — correlate with AP evidence) |
| OpenTelemetry GenAI conventions | Open standard | AUDIT | **Conform** (trace schema) |
| Blockaid / Hypernative | Commercial | AUDIT POLICY | Integrate option (threat detection feed, see 02) |
| Arkham / Chainalysis / TRM | Commercial | AUDIT | Track (compliance/forensics vendors) |

---

## Deep dives

### The Graph / Ponder — integrate (the ADR-0012 closure)

- **Why:** ADR-0012 bans `eth_getLogs` in product reads; reverse strings now come from on-chain storage, but *history* (delegation redemptions, custody changes, attestation timelines, name transfers) has no home. An indexer is the missing piece of AP's own doctrine.
- **AP lacks:**
  - `[SDK]` a maintained indexer package/subgraph set for AP contracts (events → queryable API); entity schemas per registry (names, attestations, delegations, custody changes); app-cache invalidation story.
- **Choice:** Ponder is TS-native and fits the monorepo + strict-TS doctrine; The Graph wins for public/decentralized consumption. Either closes the gap; both can share schema.

### LangSmith / LangFuse + OTel GenAI — integrate + conform

- **Feature inventory:** LLM/agent tracing (spans per tool call, token usage, eval), session replay, structured logging; OTel GenAI semantic conventions standardize the schema.
- **Overlap with AP:** AP audit evidence answers *was this allowed and by whom*; tracing answers *what happened operationally*. They must correlate (trace ID ↔ JTI ↔ evidence record).
- **AP lacks:**
  - `[SDK]` OTel-conformant trace emission in `mcp-runtime` with evidence-record correlation IDs; LangFuse/LangSmith export adapters; eval harness hooks.
- **They lack:** authorization semantics — no concept of grants, caveats, custody. Evidence ≠ tracing; AP keeps the former and federates the latter.

### Tenderly — adopt patterns

- **AP lacks:** `[SDK]` pre-flight transaction simulation for agent-initiated ops (pairs with the Blockaid-style pipeline gap, doc 02 FG-SDK-7); alerting on contract events (custody changes, recovery initiations — "your trustee quorum just changed" is a security feature).

---

## Compact entries

| Product | Overlap with AP | AP lacks (layer) | Verdict |
| --- | --- | --- | --- |
| Envio | Indexing speed | `[SDK]` alt indexer backend | Track |
| Dune | Ecosystem analytics | `[SDK]` public analytics dashboards (marketing, not product) | Track |
| Blockaid / Hypernative | Threat intel | `[SDK]` threat feed into policy decisions | Integrate option |
| Arkham / TRM / Chainalysis | Compliance screening | `[SDK]` sanctions/risk screening hook in spend paths | Track (enterprise pull) |

---

## Focus-area gap rollup — by layer

### `[Contracts]` gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| Event completeness review (every state change emits an indexable event with enough fields) | The Graph schema needs | FG-AUD-4 | P2 |

### `[SDK]` / package gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| **AP indexer (Ponder/subgraph) for all registries — closes ADR-0012's open half** | The Graph, Ponder | FG-AUD-1 | **P1** |
| OTel GenAI-conformant tracing + evidence correlation (trace ↔ JTI ↔ grant) | OTel, LangFuse | FG-AUD-2 | P1 |
| Security alerting on custody/recovery/name events | Tenderly | FG-AUD-3 | P2 |
| Compliance screening hook (sanctions/risk) for spend paths | TRM, Chainalysis | FG-ENT-4 | P3 |

### `[UX]` gaps — **deferred (recorded, not current focus)**

| Gap | Evidence |
| --- | --- |
| Audit/forensics explorer (timeline of an agent's grants + actions) | EAS explorer, Dune |
| Trace/replay viewer for agent sessions | LangSmith |

**Substrate advantages to preserve:** authorization-grade evidence (grant → caveat → decision → action chain) that observability vendors don't have; on-chain anchors making evidence tamper-evident; ADR-0012/0013 discipline (one mechanism per read path).
