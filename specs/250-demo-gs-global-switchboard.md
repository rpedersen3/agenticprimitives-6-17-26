# Spec 250 — demo-gs: Global Switchboard skills/expertise broker

**Status:** draft, 2026-06-03.
**Owner:** `apps/demo-gs`.
**Reference pattern:** `apps/demo-jp` (the Need / Offering / Match / Agreement broker). demo-gs is a
sibling relying-app that proves the same **intent-spine primitive** powers a *skills* marketplace, not
just People-Group adoption.
**Source design:** the "Global Switchboard Solution Architecture" doc (Rich Pedersen, 2026-06-03) — the
full 23-section product/architecture brief this spec condenses to an architect-of-record.

## The primitive (identical to demo-jp)

A mission actor declares a **Need**, a service actor declares an **Offering**, the broker proposes an
explainable **IntentMatch**, and consent turns a match into an **Agreement**.

| Role | demo-jp | demo-gs |
| --- | --- | --- |
| Need owner | Adopter | **GCO** (Global Christian Org seeking a skill) — reuses **Pete / Global Church** |
| Offering owner | Facilitator | **KC Expert** (Kingdom Consultant offering skills) |
| Broker | Jill / JP | **Jane / Global Switchboard** (new operator + org, mirrors Jill/JP) |
| Context facet | People Group | **Skill + category + cause + region + language** |
| Match | Adopter↔Facilitator | GCO Need ↔ KC Offering, scored over shared skill/geo/cause anchors |
| Agreement | Adoption support | Connection / service agreement (9-state lifecycle) |
| Aggregate | PG engagement signal | Open needs by skill / region / category (public read surface) |

## v1 scope (this build — Phase 0/1, fixture-driven)

Mirrors demo-jp's **structure** (persona switcher, app-local domain + fixtures, localStorage store,
operator/member dashboards) but is **identity- and chain-decoupled** for v1 per the design's §20 Phase 0:

- **Personas:** `pete` (Global Church, a GCO — posts Needs), `jane` (Global Switchboard broker — runs
  matching + the connection board), `expert` (a KC member — publishes an Offering, accepts requests).
  Pete reuses demo-jp's deterministic EOA seed; Jane is a new deterministic seed (mirrors Jill).
- **Canonical taxonomy** (mocked): skill categories, ~30 skills, causes, passion regions — referenced by
  **`SkillRef`** (a `gcUri`/`cboxUri`, never free-text). Both Needs and Offerings cite the same concepts.
- **Deterministic, explainable matching** (`score-match.ts`): exact-skill (50) ≫ category (10) + geo +
  cause + people-group + language + availability + evidence, with policy penalties. Every score carries
  reason codes + a human "why this match" explanation. Unit-tested.
- **Agreement lifecycle** with a versioned status scheme + provenance events; contact release on accept.
- **Public signal panel:** open needs by skill / category / region; counters decrement on fulfilled.
- **Privacy tiers:** public anchor vs confidential profile/contact vs sensitive (absence) — enforced in
  the projections the broker/board surface.

### Deferred (design Phases 2–5, NOT in this build)

Real demo-sso session + scoped grants; org/person vault persistence; on-chain registries + VCs +
smart-account custody; the C-Box skill registry + GC graph adapters; the read-only Switchboard
(Pattern-A) bridge; the public read API. The store + adapters keep clean seams for these.

## Identity boundary (design §2.1)

demo-gs MUST NOT call Privy/Firebase directly. Identity, account selection, delegation, and consent are
**demo-sso's** job (the demo-jp pattern). v1 stubs an `AgentSession` projection; Phase 1 swaps in the
real demo-sso `connect-client`. demo-gs owns only: need/offering capture UX, match scoring + explanation,
the connection workflow, app-local projections + fixtures.

## Skills & Geo C-Box boundary — substrate vs domain projection

Per the Skills & Geo C-Box plan (2026-06-03), **skills and geo are reusable AP substrate; Switchboard is
a domain projection over it.** The split is a hard boundary:

- **Generic AP layer (reusable, future packages/contracts — a SEPARATE wave, not this app):** skill
  definitions + per-agent skill claims, geo features + per-agent geo claims, evidence commitments,
  visibility modes, hashes — keyed by **Smart Agent address**. Planned: ontology T-box/C-box (`skills.ttl`,
  `geo.ttl` + SHACL), `SkillDefinitionRegistry.sol`, `AgentSkillClaimRegistry.sol`, `GeoFeatureRegistry.sol`,
  `GeoClaimRegistry.sol`, then SDKs (`@agenticprimitives/agent-skills`, `@agenticprimitives/geo-features`).
  Mirrors smart-agent's definition-vs-claim separation.
- **Domain graph layer (Global.Church / Switchboard ontology — APP-local, here):** Kingdom language, faith
  **causes**, the 9-state connection **status** scheme, Creative-Access sensitivity, **people-group**
  facets, and the GCO/KC/Need/Offering/Agreement mappings. These MUST NOT become reusable
  package/contract vocabulary.

**This app is the domain projection.** `src/data/taxonomy.ts` is app-local fixtures; `SkillRef` *references*
generic anchors (`gcUri`, `cboxUri`, `chainRef`) rather than defining reusable vocabulary; `causeFacets`,
`PeopleGroupFacet`, and the faith causes are app-local. When the generic substrate lands, demo-gs's
taxonomy becomes a thin projection that resolves `SkillRef`/`GeoFacet` from `SkillDefinitionRegistry` /
`GeoFeatureRegistry` and publishes Offerings as `AgentSkillClaim`s — no schema change to the app's own
domain types. **Excluded from reusable packages forever:** Kingdom Consultant, GCO, Gospel Worker,
Tentmakers, Creative Access, Prayer Circles, faith-specific causes, people-group / reachedness terms.

## Reference: smart-agent patterns to port

From `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`): the **intent-marketplace**
Need/Offer/Match shapes + the deterministic, reason-coded scoring model (explainable matching over a
shared concept vocabulary). **DELIBERATELY DIVERGE:** smart-agent's marketplace is generic intents;
demo-gs binds Needs/Offerings to a **canonical skill taxonomy** (`SkillRef` with registry URIs) so Needs
and Offerings join on concept identity, not labels — the cross-app value (engage/JP can consume the same
skill-gap signal). Matching, lifecycle, and taxonomy stay **app-local** in `apps/demo-gs` until a second
consumer appears (design §19: extract `intent-spine` / `agent-skills` only after demo-jp + demo-gs agree).

## Validate

```bash
cd apps/demo-gs && pnpm typecheck && pnpm test && pnpm build
```
