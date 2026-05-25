# Spec 226 — HCS Alignment & the AP-⟨n⟩ Standards Series

**Status:** v0 / planned (2026-05-25).
**Owner:** cross-cutting (standards layer). No package; a thin alignment layer
over existing `specs/2XX-*.md`.
**Related ADRs:** 0008 (CAIP-10 `nativeId`), 0010 (canonical SA), 0011
(credential recovery), 0012 (no `eth_getLogs`), 0013 (no fallback), 0016
(CanonicalAgentId), 0018 (ontology).
**Related specs:** [217 (profile)](./217-agent-profile.md),
[223 (directory)](./223-identity-directory.md), [225 (ontology)](./225-ontology.md),
[206 (audit)](./206-audit.md), [215 (naming)](./215-agent-naming.md),
[216 (relationships)](./216-agent-relationships.md).
**Source:** HCS family verified live against
[hol.org/docs/standards](https://hol.org/docs/standards/) on 2026-05-25 (SDK
`@hashgraphonline/standards-sdk`). Most non-original HCS standards are **Draft** —
we align to moving targets; pin versions when implementing.

---

## 0. How to read this

- **AP-⟨n⟩** mirrors **HCS-⟨n⟩** by the same number where a parallel exists
  (AP-11 ↔ HCS-11). Capabilities HCS doesn't number use a **free AP number ≥ 50**
  (e.g. AP-50 Delegation), keeping the low numbers reserved for HCS parallels.
- Each AP standard is a **thin header over an implementing `specs/2XX`** — it does
  NOT re-specify; it points + states alignment/divergence.
- **Divergences are not bugs.** They are substrate-forced (EVM/ERC-4337/CAIP-10,
  no `getLogs`, no fallback) and registered in §3. We align with HCS where the
  substrate allows and call out every difference with its reason.

## 1. Standards index (crosswalk)

| HCS | Scope | Our analog (spec) | Aligned? | Key divergence |
|---|---|---|---|---|
| HCS-1 | File data on a topic | resource addressing (217) | partial | content-URI + keccak hash, not chunked topic storage |
| HCS-2 | Topic registries | identity-directory (223) | concept | indexed=replay conflicts with no-getLogs → IndexerPort |
| HCS-3 | Recursion / HRL | resource locator (217) | partial | `(metadataUri, metadataHash)`, consume HRL never mint |
| HCS-10 | OpenConvAI agent comms | demo-a2a | low | no inbound/outbound/connection topic topology |
| HCS-11 | Profile metadata | agent-profile (217) | **partial (~70%)** | `uaid` required→our `nativeId`; memo discovery→naming+mirror+indexer |
| HCS-13 | Schema registry | ontology (225) | concept | SHACL/OWL artifacts, not on-topic schemas |
| HCS-14 | Universal Agent ID (UAID) | CAIP-10 `nativeId` (ADR-0008) | **aligned (one-way)** | we expose nativeId; never mint UAIDs |
| HCS-15 | Account/key separation | credential recovery (221, ADR-0011) | spirit | custody-quorum, not Hedera key lists |
| HCS-16 | Flora multi-party | MultisigProfile (217) + custody (207/209) | concept | members+threshold; no comms/txn/state topics |
| HCS-20 | Auditable points | audit (206) | concept (diff axis) | event schema + sink, not a points ledger |
| HCS-26 | Skills registry | profile capabilities (217 v2) | concept | free-text now; codelist later |
| HCS-27 | ANS transparency log | directory evidence (223) | concept | provenance/assurance model |

## 2. AP-⟨n⟩ per-standard header (fixed shape)

```
### AP-⟨n⟩ — ⟨Title⟩   (Parallels HCS-⟨n⟩)
**Status:** Draft | Adopted
**Implements:** specs/2XX-*.md            # the real spec; do not duplicate it
**Parallels:** HCS-⟨n⟩ (title) — ⟨URL⟩
**Abstract:** one paragraph.
**Motivation:** why we align.
**Specification:** point to the implementing spec.
**Differs from HCS-⟨n⟩ in:** bulleted divergences, each with its cause/ADR.
**Reference:** SDK, ADRs, smart-agent analog.
```

### AP-11 — Agent Profile (Parallels HCS-11)
**Implements:** [spec 217](./217-agent-profile.md). **Differs in:** (a) identifier
is CAIP-10 `nativeId`, **not** the HCS-11-required `uaid` (ADR-0008 — UAID is
consumer-derived); (b) discovery is naming `metadata-uri` + on-chain `ProfileMirror`
+ indexer, not account-memo→HRL (ADR-0012, no fallback ADR-0013); (c) `type` /
`capabilities` are strings + on-chain hash, not int codelists (provide a static
int↔string transcode map); (d) `inboundTopicId`/`outboundTopicId` have **no
analog** (no ordered-topic substrate) — closest is the A2A HTTPS endpoint +
verification method; (e) verification recovers via **ERC-1271 against the SA**,
not a Hedera key (maps `dns→dns-txt`, `signature→signed-url`, `challenge→
http-challenge`, `vp→verifiable-presentation`). **Profile is hash-pinned + custody-
gated → stronger than HCS-11 memo mutability (§4).**

### AP-14 — Canonical Agent ID (Parallels HCS-14)
**Implements:** ADR-0008 + ADR-0016 + [spec 225](./225-ontology.md). `CanonicalAgentId`
IS CAIP-10 and namespace-plural by construction. A Hedera agent's
`hedera:mainnet:0.0.x` is a **first-class subject** the directory can hold + link
as evidence — **addressable, not custodied** (our custody/auth/recovery is
EVM-only: ERC-4337, ERC-1271). **Differs in:** we never mint UAIDs; consumers wrap
our `nativeId` per HCS-14. This is the keystone other AP standards reference.

### AP-2 — Identity Directory / Registry (Parallels HCS-2)
**Implements:** [spec 223](./223-identity-directory.md). Adopts HCS-2's registry
**concept**; **rejects** its read mechanism. HCS-2 *indexed* (replay all topic
messages) → our **`IndexerPort`** (an explicit indexer/SPARQL store, ADR-0012);
HCS-2 *non-indexed/latest-wins* → current on-chain state via `readContract`.
Provenance + assurance replace "trust the consensus-ordered replay."

### AP-13 — Schema / Ontology (Parallels HCS-13)
**Implements:** [spec 225](./225-ontology.md) + ADR-0018/0009. SHACL/OWL artifacts
(T-box/C-box) + the on-chain `ShapeRegistry`, not on-topic message schemas.

### AP-10 — A2A Messaging (Parallels HCS-10)  — *divergence declaration*
**Implements:** demo-a2a. **Differs in:** no inbound/outbound/connection topic
mesh; A2A is HTTPS request/response + delegation tokens + ERC-1271. On record so
the gap is explicit; revisit only if we adopt an ordered-messaging substrate.

### AP-20 — Auditable trail (Parallels HCS-20)
**Implements:** [spec 206](./206-audit.md). Align the audit-trail half now
(append-only event schema + sink; auditability from on-chain tx ordering + the
sink contract). Defer the points-ledger half (`deploy/mint/burn/transfer`) until
points ship.

**Later / optional:** AP-15 (↔HCS-15 account/key split → ADR-0011), AP-16 (↔HCS-16
Flora → MultisigProfile), AP-26 (↔HCS-26 skills → 217 v2), AP-19 (↔HCS-19 privacy).
**Our-own (≥50):** AP-50 Delegation, AP-51 Custody policy, AP-52 Tool policy.

## 3. Divergence register (grouped by substrate cause)

**A — EVM storage + indexer, not HCS topics:** no chunked-file topics (HCS-1 →
content-URI+hash); no HRL minting (HCS-3 → `(uri,hash)`, consume-only); registry
reads are `readContract`+indexer not message replay (HCS-2, ADR-0012); profile
discovery is naming+mirror+indexer not memo→HRL (HCS-11).

**B — ERC-4337 SA vs Hedera account:** no A2A topic topology (HCS-10/16);
verification via ERC-1271 against the SA, not a Hedera key (HCS-11); `base_account`
≡ canonical SA (HCS-15, ADR-0010); `hedera:*` CanonicalAgentIds are addressable
but not custodied (ADR-0016).

**C — No `eth_getLogs` (ADR-0012):** cannot implement HCS-2 indexed semantics by
scanning a stream; audit timelines/reverse strings come from stored fields or an
explicit indexer.

**D — No silent fallback (ADR-0013):** one mechanism per read; HCS-style
"try latest else replay all" is a forbidden fallback. Empty is the answer.

**E — CanonicalAgentId is CAIP-10 (ADR-0016):** SSO subject + directory key +
profile `nativeId` are one CAIP-10 string spanning `eip155:*` + `hedera:*`.

**F — Credentials rotate, identity persists (ADR-0011):** no stored `uaid`
(consumer-derived); identity survives credential rotation (closer to HCS-15 than
HCS-11's account-bound profile); profile writes are custody-gated (ERC-1271 →
quorum), not single-key memo edits.

## 4. Doctrine conflicts (surfaced, not silently adopted)

1. **HCS-2 indexed-replay vs ADR-0012.** HCS-2 *indexed* = "read all topic
   messages" = the topic-stream equivalent of a log scan. **Rejected.** AP-2 maps
   indexed→`IndexerPort`, latest-wins→`readContract`. We adopt the registry
   *concept*, reject the *read mechanism*.
2. **HCS-11 memo-as-identity vs ADR-0010/0011.** HCS-11 hangs the profile off a
   mutable account memo; identity ≈ account+memo. **Rejected.** Our identity is
   the immutable SA address; the profile pointer is a hash-pinned, custody-gated
   facet. This is *stronger* (tamper-evident + quorum-gated) — a deliberate,
   security-positive divergence, not a gap.

**Non-conflict:** HCS-14's CAIP-10 `nativeId` requirement *agrees* with ADR-0008 —
the alignment lever. The only HCS-11 field we refuse is required `uaid`.

## 5. Authoring priority

1. **AP-11** (drives an HCS-11 alignment pass on spec 217 — highest value).
2. **AP-14** (keystone; already decided in ADR-0008/0016 — cheapest).
3. **AP-2** (alongside spec 223; formalizes the no-getLogs divergence).
4. **AP-13** (alongside spec 225).
5. **AP-10** (divergence declaration), **AP-20** (audit half).
6. Later: AP-15/16/26/19; our-own AP-50+.

## 6. Reference: smart-agent patterns + advisor sources

- smart-agent already adopts HCS-14/CAIP-10 (`packages/agent-naming/records`,
  ADR-0008) and the on-chain ontology/SHACL stack (ADR-0009) — AP-13/AP-14 ride
  on existing alignment, not greenfield.
- Live HCS sources: HCS-11 ([doc](https://hol.org/docs/standards/hcs-11/) +
  [SDK](https://hashgraphonline.com/docs/libraries/standards-sdk/hcs-11/)),
  HCS-14 ([doc](https://hol.org/docs/standards/hcs-14/)), HCS-2/3/10/20 under
  [hol.org/docs/standards](https://hol.org/docs/standards/), CAIP-10
  ([chainagnostic](https://chainagnostic.org/CAIPs/caip-10)).
- The `hcs-standards-advisor` agent ([docs/agents](../docs/agents/hcs-standards-advisor.md))
  is the standing consult for keeping these rows current as HCS drafts evolve.

## 7. HCS-11 alignment pass on spec 217 (action items)

(a) add static int↔string maps for `type` + `capabilities` + a `toHcs11()/fromHcs11()`
transcoder note; (b) align `socials` to `[{platform,handle}]` + add optional
`profileImage`/`properties`; (c) write the explicit "`uaid`→`nativeId`;
`inboundTopicId`/`outboundTopicId`→no analog; memo→naming+mirror+indexer"
divergence text into spec 217 §10. Tracked, not yet applied.
