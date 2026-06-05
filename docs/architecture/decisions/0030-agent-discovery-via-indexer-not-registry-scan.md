# ADR-0030 — Agent discovery is an indexer over canonical anchors, not an on-chain registry scan

**Status:** accepted (2026-06-05) · **Reconciles:** HCS-10 (OpenConvAI) public agent registry ↔ [ADR-0012](0012-no-eth-getlogs-in-product-read-paths.md) (no `eth_getLogs` in product read paths) · **Builds on:** [ADR-0010](0010-smart-agent-canonical-identifier.md) · **Surfaced by:** the [spec 260](../../../specs/260-identity-architecture-doctrine.md) ↔ HCS crosswalk · **Implements via:** AP-3 ([spec 263](../../../specs/263-ap3-agent-discovery.md) — *to be drafted*) · **Packages:** `identity-directory`, `agent-naming`

## Context

The HCS ↔ spec-260 crosswalk found that **HCS-10 ships a standard public agent-discovery registry**
(an HCS-2 topic written with `register` / `delete` / `migrate` ops, each entry carrying
`accountId, inboundTopicId, outboundTopicId, operatorId, registryTopicId, metadata`). That registry is
exactly the capability agenticprimitives lacks a written standard for: *"find the agents / services that
match this query."* Our nearest analogs today are name resolution (`agent-naming`) and the SSO-wave
`identity-directory` — there is no canonical, queryable agent directory.

The tension: a naïve port of HCS-10's registry to EVM would be "scan the chain for registration events,"
which is precisely what **ADR-0012 forbids** in product read paths (`eth_getLogs` caused the 429 storm;
the last log-walker was removed). So we cannot "just mirror the HCS-10 registry."

## Decision

**Agent/service discovery is served by an EXPLICIT indexer that projects canonical on-chain anchors into
a queryable directory — never by an inline chain log-scan in a product read path.**

1. **The canonical record is always the on-chain anchor**, never the directory entry. An agent's
   existence + identity is its deployed Smart Account (ADR-0010); its name is the `agent-naming`
   registry record; its public profile is the AP-1 profile facet (spec 261); its skill/geo claims point
   at the on-chain definition registries. The directory is a **cache/index over that canonical state**,
   rebuildable from chain by the indexer, and **must carry the back-link** to the canonical SA (ADR-0010
   §3) on every entry.
2. **The registration lifecycle mirrors HCS-10's `register` / `delete` / `migrate`** — but as **indexed
   events** the indexer ingests (e.g. a profile publish, a name claim, a service-card update,
   a deactivation), not as a registry the product reads by scanning logs. The *write* is the canonical
   on-chain action; the *index* is the derived, queryable projection.
3. **Product read paths query the indexer/directory API**, and verify specifics with `readContract`
   (ADR-0012-compliant) — they never call `eth_getLogs`. The indexer service MAY use logs/backfill
   off the hot path (it is the explicit indexer ADR-0012 names as the sanctioned mechanism), but the
   browser/Worker product paths hit the directory, not the chain history.
4. **One mechanism per read path** (ADR-0013): discovery has exactly one source — the directory. An
   empty result is an answer; it does not trigger a fall-back chain scan.

## Consequences

- We get HCS-10's discovery capability **without** violating ADR-0012, and with a stronger integrity
  story: the directory is a rebuildable projection of canonical on-chain identity, not an authoritative
  parallel ledger that can drift.
- **Divergence from HCS-10 (deliberate):** HCS-10's registry IS the discovery source (an append-only
  HCS-2 topic); ours is a derived index whose source of truth is the SA + naming + profile anchors. We
  diverge because (a) ADR-0012, and (b) ADR-0010 makes the SA — not a registry entry — the identity.
- The directory must publish freshness/lag semantics (it is eventually consistent with chain) and must
  never be treated as authority for custody/authorization decisions — those read the chain directly.
- **AP-3 (a future `specs/263`) specifies the directory schema + the register/update/deactivate
  lifecycle + the indexer contract.** This ADR records the *decision* (indexer, not scan); AP-3 records
  the *shape*. Until AP-3 lands, `identity-directory` remains the seam and discovery stays name-first.

## What to cite

- The need + HCS analog: HCS-10 registry ops (`standards-sdk/src/hcs-10/types.ts` `Registration`,
  `HCSMessage.op` `register`/`delete`/`migrate`); spec 260 §VI crosswalk row "Discovery registry."
- The constraint: ADR-0012 (no `eth_getLogs` in product read paths) + ADR-0013 (one mechanism).
- The canonical-anchor rule: ADR-0010 §3 (every facet back-links to the SA).
