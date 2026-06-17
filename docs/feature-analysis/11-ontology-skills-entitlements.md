# 11 — Ontology, skills, semantic data & entitlements

**Focus area:** structured vocabularies, skill/capability description, semantic validation, and entitlement/licensing models for agents.
**AP packages in scope:** `ontology` (`OntologyTermRegistry`, `ShapeRegistry`, `AttributeStorage`), `agent-skills` (`SkillDefinitionRegistry`), `geo-features`, `tool-policy` (entitlement checks), planned `entitlements`; app `demo-bible-ontology` (vertical consumer).
**AP capability today:** on-chain ontology term + shape registries (SHACL-flavored validation against caller-supplied stores); skill definition registry with self-claims; attribute storage base (auth delegated to subclasses); geo feature registry. Generic by doctrine (ADR-0021) — verticals consume via apps.

> Gap layers: `[Contracts]` Solidity surface · `[SDK]` TS packages/backends · `[UX]` product surface (**deferred**). See [index](index.md#gap-layers-every-gap-is-classified-into-exactly-one).

---

## Category verdict at a glance

| Product | Type | Tags | Verdict |
| --- | --- | --- | --- |
| W3C SHACL / SHEX + RDF toolchain | Open standard | ONTO | **Conform** (validation semantics) |
| Schema.org / JSON-LD | Open standard | ONTO PROFILE | **Conform** (publish AP vocabularies as JSON-LD) |
| OASF (Open Agent Schema Framework, Cisco/AGNTCY) | OSS standard | ONTO DIR MCP | **Conform-watch** (agent capability taxonomy) |
| A2A agent-card skills field | Open standard | ONTO DIR | Conform (skill advertisement transport) |
| MCP tool schemas (JSON Schema) | Open standard | ONTO MCP | Conform (already in runtime) |
| Verifiable skill claims (EAS-attested capabilities) | Pattern | ONTO VC | Build (AP-native, see 07) |
| Hashgraph Online HCS-26 skills registry + HCS-14 UAID skills enum | Open standard | ONTO DIR | Conform-watch (versioned skill packages, DNS domain proof; see 12) |
| LinkedIn Skills Graph / ESCO / O*NET | Commercial / public taxonomies | ONTO | Track (human-skill taxonomies) |
| License/entitlement managers (Stigg, LaunchDarkly ent., Keygen) | Commercial | POLICY ONTO | Adopt patterns (entitlement checks) |
| Ceramic/ComposeDB (semantic streams) | OSS | ONTO PROFILE | Integrate option (see 06) |

---

## Deep dives

### W3C semantic stack (SHACL/SHEX, JSON-LD, schema.org) — conform

- **Overlap with AP:** `ShapeRegistry` is SHACL-flavored already; profiles/attestations want JSON-LD export for interop.
- **AP lacks:**
  - `[SDK]` JSON-LD context + schema.org-aligned vocabulary publication for AP entities (agent, skill, attestation, relationship); SHACL conformance tests against the on-chain shape encoding; an off-chain validator that matches on-chain `ShapeRegistry` semantics exactly (one mechanism, ADR-0013).
- **Verdict:** conform — semantic interop is what makes AP registries consumable by non-AP systems.

### OASF + A2A skills — conform-watch

- **Identity:** OASF (AGNTCY/Cisco, Linux Foundation orbit) defines agent capability/skill taxonomies + record schemas; A2A agent cards carry a `skills` array consumed by orchestrators for routing.
- **Overlap with AP:** `SkillDefinitionRegistry` + `agent-skills` package is AP's on-chain analog.
- **AP lacks:**
  - `[SDK]` mapping layer from `SkillDefinitionRegistry` terms → A2A card `skills` entries → OASF taxonomy IDs, so AP-declared skills are discoverable/routable by external orchestrators (MuleSoft Agent Fabric, AGNTCY directory).
- **They lack:** verifiable claims — taxonomies describe, they don't attest. AP can bind skill claims to attestations (doc 07) for *verified* capability.
- **Verdict:** conform-watch; the win is "AP skills are verifiable, theirs are self-asserted."

### Entitlement managers (Stigg, Keygen, feature-flag entitlements) — adopt patterns

- **Feature inventory:** plan/feature entitlement models, usage metering, license keys, entitlement checks at runtime.
- **Overlap with AP:** `tool-policy` already gates tools; agreements/attestations can encode purchased entitlements.
- **AP lacks:**
  - `[SDK]` an entitlement vocabulary + check API ("does subject hold entitlement E under agreement A?") layered on agreements/attestations; resource/action/field/purpose/classification matching for delegated vault reads; usage metering tied to delegated tool calls (pairs with x402, doc 09, and vault doc 13).
- **Verdict:** adopt patterns — entitlements-as-attestations is a natural substrate extension; don't build a billing product.

---

## Focus-area gap rollup — by layer

### `[Contracts]` gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| Skill claims upgradeable from self-claim to attested (issuer-verified skill records) | OASF self-assertion weakness | FG-ONT-1 | P2 |

### `[SDK]` / package gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| JSON-LD/schema.org vocabulary publication + SHACL conformance | W3C stack | FG-ONT-2 | P2 |
| Skill mapping: registry → A2A card skills → OASF taxonomy | OASF, A2A | FG-ONT-3 | P2 |
| Entitlement check API over agreements/attestations + usage metering | Stigg, Keygen | FG-ONT-4 | P2 |
| Entitlement credential/check package for vault resource/action/field/purpose/classification access | W3C VC/status lists; delegated vault doc 13 | FG-ENT-5 | **P1** |
| Off-chain validator matching on-chain shape semantics | SHACL tooling | FG-ONT-5 | P3 |

### `[UX]` gaps — **deferred (recorded, not current focus)**

| Gap | Evidence |
| --- | --- |
| Vocabulary/taxonomy browser + skill directory | OASF explorer ambitions |

**Substrate advantages to preserve:** on-chain shape/term registries (rare); skills bound to canonical identity + attestable; generic core with verticals at the app layer (ADR-0021) — the Bible-ontology demo proves the pattern without polluting packages.
