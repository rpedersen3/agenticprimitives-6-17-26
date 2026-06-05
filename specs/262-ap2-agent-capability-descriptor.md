# AP-2 — Agent capability descriptor + HCS-11 ↔ A2A crosswalk (spec 262)

**Status:** draft (parallel standard; mirrors HCS-11 structure) · **Series:** AP · **Grounds:** [spec 260](260-identity-architecture-doctrine.md) Part 0 "Agent / A2A host", [AP-1 / spec 261](261-ap1-public-profile-schema.md) · **Mirrors / crosswalks:** HCS-11 `AIAgentDetails`/`AIAgentCapability` ↔ A2A AgentCard · **Apps/packages:** demo-a2a (agent-card), `mcp-runtime`, `tool-policy`

## Abstract

AP-2 defines a **capability descriptor** for an agent/service identity and a **crosswalk** between two
existing vocabularies that both describe "what an agent can do": HCS-11's numeric `AIAgentCapability`
enum and the A2A **AgentCard** `skills` schema we already serve at
`/.well-known/agent-card.json`. AP-2's goal is interop: an agenticprimitives agent should be describable
in HCS-11 terms (so it could be listed in / discovered by an HCS-10 registry) and an HCS-11 agent's
capabilities should map onto our A2A AgentCard, **without** adopting a second on-chain vocabulary.

## Motivation

The spec-260 ↔ HCS crosswalk found that HCS-11 and A2A are *parallel capability descriptors* with no
bridge. HCS-11 uses a fixed numeric enum (`AIAgentCapability`, ~19 values such as `TEXT_GENERATION=0` …
`WORKFLOW_AUTOMATION=18`); A2A uses a structured `skills` array (id, name, description, tags,
input/output modes). Today an AP agent published as an A2A AgentCard cannot be expressed as an HCS-11
`aiAgent` block and vice-versa. AP-2 is the cheapest concrete interop win and a prerequisite for AP-3
(discovery) listing AP agents alongside HCS-10 agents.

## Specification

### The AP-2 descriptor

The **canonical capability surface is the A2A AgentCard** (we already serve and consume it). AP-2 does
NOT introduce a new on-chain capability registry. An AP-2 descriptor is:

```jsonc
{
  "ap2": "1",                                 // REQUIRED. AP-2 version.
  "account": "eip155:84532:0x…",              // REQUIRED. CAIP-10 back-link (ADR-0010) — same as AP-1.
  "agentCard": "https://<handle>.impact-agent.io/.well-known/agent-card.json", // REQUIRED. The A2A card.
  "hcs11Capabilities": [0, 7, 18],            // OPTIONAL. The HCS-11 AIAgentCapability codes this agent
                                              //   claims, DERIVED from its A2A skills via the crosswalk
                                              //   below — a projection for HCS interop, not a new source.
  "interaction": "manual" | "autonomous"      // OPTIONAL. Maps to HCS-11 AIAgentType.
}
```

Rules:
1. **The A2A AgentCard `skills` are the source of truth** for capability. `hcs11Capabilities` is a
   *derived projection* for HCS-11/HCS-10 consumers, computed via the crosswalk — never hand-maintained
   in parallel (one mechanism, ADR-0013).
2. **Back-link required** (`account`, ADR-0010 §3); an AP-2 descriptor references the AP-1 profile's
   `service.capability` (spec 261).
3. **No vertical vocabulary.** Capability terms are generic substrate (text generation, data analysis,
   workflow automation, …). Domain/vertical skills (faith causes, people-groups, Kingdom language) are an
   **app-local projection over** the generic capability/skill substrate, never part of AP-2 (ADR-0021;
   matches the agent-skills/geo-features C-box doctrine).

### Crosswalk — HCS-11 `AIAgentCapability` ↔ A2A AgentCard skill tags

The mapping is **tag-based**: each HCS-11 capability code corresponds to one or more A2A skill `tags`.
The representative mapping below MUST be pinned against the live HCS-11 `standards-sdk`
`AIAgentCapability` enum before AP-2 is marked `accepted` (the enum values are SDK-defined; only the two
endpoints `TEXT_GENERATION=0` and `WORKFLOW_AUTOMATION=18` are confirmed here).

| HCS-11 `AIAgentCapability` (code) | A2A skill tag(s) | Notes |
| --- | --- | --- |
| `TEXT_GENERATION` (0) | `text-generation`, `drafting` | confirmed endpoint |
| `IMAGE_GENERATION` | `image-generation` | pin code |
| `CODE_GENERATION` | `code` | pin code |
| `DATA_ANALYSIS` | `analysis`, `matching` | our match workers project here |
| `KNOWLEDGE_RETRIEVAL` | `retrieval`, `search`, `directory` | discovery (AP-3) |
| `TRANSLATION` | `translation`, `language` | |
| `WORKFLOW_AUTOMATION` (18) | `automation`, `orchestration` | confirmed endpoint |
| … (remaining enum values) | … | **pin from standards-sdk** |

### Derivation direction

- **AP → HCS-11:** read the A2A AgentCard `skills[].tags`, map each tag to its HCS-11 capability code via
  the table, emit the deduplicated `hcs11Capabilities[]`. This lets an AP agent be registered in an
  HCS-10 registry with a valid HCS-11 `aiAgent` block.
- **HCS-11 → AP:** read the `AIAgentCapability` codes, map to A2A skill tags, surface as advisory skills
  on our side (the authoritative card stays the agent's own A2A AgentCard).

## Rationale / divergence

- **We do not add a numeric on-chain capability enum.** The A2A AgentCard is richer (descriptions, I/O
  modes, examples) and already in use; AP-2 is a *bridge*, not a replacement. HCS-11's enum is coarser, so
  the AP→HCS direction is lossy-but-valid; the HCS→AP direction is advisory.
- **Generic-only** (ADR-0021): vertical skill taxonomies stay app-local; AP-2 carries only reusable
  capability terms, exactly as HCS-11's enum is domain-neutral.

## Reference: smart-agent patterns to port

`/home/barb/smart-agent` describes agent capabilities via its A2A/agent-card surface; we port that
(AgentCard as the capability source of truth) and add only the HCS-11 crosswalk projection. smart-agent
has no HCS-11 numeric enum, so the crosswalk table is HCS-derived, not ported. The generic-vs-vertical
split (capability substrate vs domain projection) follows the existing `agent-skills`/`geo-features`
C-box doctrine (memory `project_demo_gs_global_switchboard`).

## Open items

- Pin the full `AIAgentCapability` enum + finalize the tag map against `standards-sdk`.
- Define the A2A skill `tags` vocabulary we standardize on (the left-to-right map needs a stable tag set).
