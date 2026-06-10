# ADR-0037 — This repo ships architecturally pure primitives; integration and product-UX layers are composed in external repos

**Status:** Accepted (2026-06-10).
**Related:** [ADR-0021](./0021-generic-packages-vs-white-label-apps.md) (generic packages vs white-label apps — this ADR is its inter-repo extension), [ADR-0010](./0010-smart-agent-canonical-identifier.md) (the address is the identity; external registry entries are facets), [ADR-0012](./0012-no-eth-getlogs-in-product-read-paths.md) (explicit indexer — which this ADR places *outside* the repo), [feature-analysis doc 12](../../feature-analysis/12-agent-registry-discovery-intents.md) + [doc 90](../../feature-analysis/90-prioritized-feature-gaps.md) (the gap roadmap this ADR re-routes).

---

## Context

The agent-trust market is converging fast on registries, discovery, naming, and
intent rails: ERC-8004 on mainnet, GoDaddy ANS, Hashgraph Online / HCS standards,
A2A cards, MCP Registry, OASF. Our own lab already has working integration-layer
code in sibling repos: `agentictrustlabs/agentic-trust` (ERC-8004 SDK, Veramo
DID/VC, GraphQL discovery), `agentictrustlabs/agent-indexer` (subgraphs for
mainnet/Base/Linea + EAS schemas), `agentictrustlabs/agent-explorer`,
`agentictrustlabs/oasf`, and the pattern lineage in
`agentictrustlabs/smart-agent`.

The gravitational pull is to fold that work in here — an `agent-registry`
package, an ANS bridge, an HCS publisher, an indexer service, a discovery API.
Every one of those would make this repo *bigger* and the substrate *less pure*:
integration code churns with other people's protocols, drags their dependency
trees (Veramo, graph tooling, DNS/X.509 stacks) into the dependency-minimal
package graph, and turns a primitives repo into the very "pile of integrations"
the substrate thesis argues against.

ADR-0021 already drew this line *inside* the repo (generic packages vs vertical
apps). This ADR draws the same line *around* the repo.

## Decision

The ecosystem is three rings. **This repository is Ring 0 and only Ring 0.**

| Ring | What | Where | Examples |
| --- | --- | --- | --- |
| **0 — Primitives** | Architecturally pure trust primitives: contracts + generic `@agenticprimitives/*` packages + reference demo apps that prove the primitives compose | **This repo** | accounts, custody, delegation + enforcers, naming, attestations/agreements, VC envelope, skills/geo registries, ontology, audit events, MCP/A2A authorization |
| **1 — Composable integration layers** | Code that speaks *someone else's* protocol or runs as *deployed read/sync infrastructure* | **External repos** (compose Ring 0 as npm deps) | ERC-8004 registration/sync + Veramo (`agentic-trust`), indexer + GraphQL discovery (`agent-indexer`), OASF mapping (`oasf`), ANS/DNS-AID bridges, HCS/UAID publishers, MCP Registry publication |
| **2 — Composable product/UX layers** | Hosted products, consoles, explorers, white-label verticals | **External repos** | `agent-explorer`, trust-site products, admin/treasury dashboards, registrar flows |

**Dependency direction is absolute: Ring 1 and Ring 2 import Ring 0. Ring 0
never knows Ring 1 or Ring 2 exist.** No package or contract in this repo may
import an integration SDK, reference an external-layer repo, or special-case a
foreign protocol's shapes.

### The litmus test (what belongs in Ring 0)

Code belongs in this repo iff **it defines or enforces trust semantics anchored
on the Smart Agent address** — identity, custody, authority, names, claims,
agreements, evidence — in a protocol-agnostic form. Two corollaries:

1. **Primitives expose extension points, not integrations.** The right Ring 0
   response to ERC-8004 is *not* an 8004 client — it is making sure our
   attestation/profile/card primitives are **expressive enough to be projected
   into 8004 by a Ring 1 layer**: SA-signed (ERC-1271) profile/card payloads,
   attestation schemas that can carry reputation/validation semantics, complete
   indexable events (FG-AUD-4), stable read interfaces. Same for ANS (a
   cross-proof is an attestation; the DNS publication is Ring 1), HCS (UAID is
   a facet; the topic publisher is Ring 1), and OASF (skill IDs are Ring 0;
   the taxonomy mapping is Ring 1).
2. **Deployed infrastructure is never Ring 0.** Indexers, discovery APIs,
   registry-sync daemons, transparency-log services: ADR-0012's "explicit
   indexer" is `agent-indexer`, not a package here. Ring 0 ships the events
   and ABIs the indexer consumes — nothing more.

### Learn-from, don't merge-in

ERC-8004, Hashgraph Online/HCS, and the sibling repos remain **first-class
study objects** (the "always check smart-agent first" rule generalizes to the
whole lab). Their patterns shape primitive *design* — but their conformance
code lands in Ring 1. Porting prior art (e.g. `erc8004-sdk`, `privacy-creds`
circuits, discovery flows) means porting it **into the appropriate external
repo**, not into this one. The one exception stays as-is: porting *primitive*
patterns (custody math, intent-commitment structs, zk circuit designs) into
Ring 0 packages when they pass the litmus test.

## The marketing half of the rule

Positioning follows architecture (mirrored in
[`docs/marketing/messaging-brief.md`](../../marketing/messaging-brief.md)):

- This repo is marketed as **the substrate** — "the primitives everything else
  composes" — never as a hub of integrations. Breadth-of-integrations is
  explicitly *not* our claim; coherence-of-primitives is.
- **Sibling-lab repos are internal reference points only** — idea sources and
  pattern lineage named in ADRs, CLAUDE.md, and architecture/feature-analysis
  docs so agents know where to look. They are NEVER named in marketing
  materials or READMEs — not as proof points, not as an ecosystem catalog.
- READMEs and docs in this repo may *name* standards (ERC-8004, ANS, HCS,
  OASF) as interop targets the primitives are designed to be projected into,
  but never promise in-repo bridges and never point at specific external
  implementations.

## Consequences

1. **The gap roadmap re-routes by venue.** Of [doc 90](../../feature-analysis/90-prioritized-feature-gaps.md):
   FG-REG-1/3/6/8 (8004 sync, ANS/DNS-AID/HCS bridges), FG-DIR-1 (discovery
   API), FG-AUD-1 (indexer), FG-ONT-3 (OASF mapping), FG-VC-4's Veramo half →
   **Ring 1 (external)**. What stays here is their Ring 0 prerequisites:
   SA-signed card/profile primitive (FG-REG-2's signing half), event
   completeness (FG-AUD-4), attestation schema expressiveness (FG-VC-2),
   skill-claim hardening (FG-ONT-1, NEW-SKILL-1), enforcer/delegation
   semantics (FG-DELEG-1).
2. **Dependency hygiene is enforceable.** Integration-SDK imports
   (`@veramo/*`, `@hashgraphonline/*`, graph/ponder tooling, ANS/X.509 stacks,
   8004 client SDKs) are forbidden in `packages/*`; candidates for the
   forbidden-imports gate alongside the ADR-0021 checks.
3. **This repo gets smaller pressure, not bigger.** "Where does this code go?"
   gains a third answer: not `packages/`, not `apps/` — **another repo**.
4. **Risk accepted:** external layers can lag or drift from the primitives.
   Mitigation: Ring 1 repos pin published `@agenticprimitives/*` versions, and
   Ring 0 treats "a Ring 1 layer couldn't express X" as a primitive-design bug
   to fix here (more expressive schema/event/interface), never as a reason to
   absorb the integration.

## Drift triggers — STOP and route

- "Add an ERC-8004 / ANS / HCS / OASF client package" → **STOP.** Ring 1;
  external repo. Ring 0 only grows the attestation/card/event surface they consume.
- "Ship the indexer / discovery API in `packages/`" → **STOP.** `agent-indexer`.
- "Import Veramo / graph tooling / an integration SDK in a package" → **STOP.**
- "Market the repo's integration breadth" → **STOP.** Market primitive
  coherence; integrations are the ecosystem's proof, not our feature list.
