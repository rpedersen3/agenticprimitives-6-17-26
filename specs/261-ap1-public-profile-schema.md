# AP-1 — Canonical public-profile schema (spec 261)

**Status:** draft (parallel standard; mirrors HCS-11 structure) · **Series:** AP (agenticprimitives parallel standards) · **Grounds:** [ADR-0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md), [spec 260](260-identity-architecture-doctrine.md) §I.2, [spec 257](257-credential-first-connection.md) (name-deferral) · **Mirrors / diverges from:** HCS-11 (Profiles) · **Packages:** `agent-profile`, `identity-directory`, `agent-naming`

## Abstract

AP-1 defines the **public-tier profile facet** of a canonical Smart Account identity: a small, stable,
public JSON document keyed on the SA address (CAIP-10) and carrying display metadata, the optional name
handle, social links, an optional Universal Agent ID, and a communications pointer. It deliberately
mirrors HCS-11's `BaseProfile` **field shape** so AP and HCS profiles are mutually legible, while
diverging on the points spec 260 makes load-bearing: a first-class **organization** type, a strict
**public/private split** (PII lives in the vault, never in this document), **name-deferral** (the handle
may be absent), and a **CAIP-10 anchor + back-link** instead of an all-public HCS-1 inscription.

## Motivation

ADR-0010 already decided *"HCS-11 profile → a profile anchored on the SA address (CAIP-10),"* but the
**field schema** for our public profile facet was never written. `agent-profile` / `AgentProfileResolver`
hold public attributes with no declared shape; relying apps and indexers (ADR-0030) need a stable,
documented contract to read. HCS-11 provides a precise, battle-tested profile schema; AP-1 adopts its
shape for the public tier so we get interop for free, and writes down the three divergences our doctrine
requires rather than leaving them implicit.

## Specification

### The `APProfile` document (public tier ONLY)

```jsonc
{
  "ap": "1",                                  // REQUIRED. AP-1 schema version (string).
  "type": "person",                           // REQUIRED. AgentKind: "person" | "org" | "service".
  "account": "eip155:84532:0x5b2f…c41a",      // REQUIRED. CAIP-10 canonical SA address = the back-link
                                              //   (ADR-0010 §3). The identity; everything else is a facet.
  "alias": "rp-adopt-4",                      // OPTIONAL. The public handle facet (agent-naming). MAY be
                                              //   ABSENT — name-deferral (spec 257). Never the key.
  "uaid": "uaid:…",                           // OPTIONAL. HCS-14 Universal Agent ID, DERIVED LOCALLY from
                                              //   `account` (ADR-0008). Never minted; presence is a cache.
  "display_name": "Richard Pedersen",         // OPTIONAL. Human label; mutable.
  "bio": "…",                                 // OPTIONAL. Short public description.
  "profileImage": "ipfs://… | https://…",     // OPTIONAL. URI (NOT an inscription); resolver-resolvable.
  "socials": [                                // OPTIONAL. HCS-11-compatible social links.
    { "platform": "github", "handle": "…" }   //   platform ∈ {x, twitter, github, discord, telegram,
  ],                                          //   linkedin, youtube, website}.
  "comms": {                                  // OPTIONAL. Where to reach this agent — the analog of
    "a2a": "https://rp-adopt-4.impact-agent.io"//   HCS-11 inbound/outboundTopicId. A URL, not a topic id.
  },
  "service": {                                // OPTIONAL. Present iff type == "service".
    "serviceType": "…",                       //   C-box-anchored service kind (spec 225).
    "capability": "ap2:…"                      //   Reference to an AP-2 capability descriptor (spec 262).
  }
}
```

### Rules

1. **`account` is REQUIRED and is the back-link.** An AP-1 document without a CAIP-10 `account` is invalid
   (ADR-0010 §3 — a facet with no back-link to the canonical SA is forbidden). The `account` is the
   identity; `alias`/`display_name`/etc. are mutable facets that resolve *to* it, never the key.
2. **Public tier ONLY. No PII, no contacts, no `properties` free-form blob.** Email, phone, postal
   contact, and any operational/sensitive data are NOT permitted in an AP-1 document — they live in the
   owner-keyed vault and are released only over a delegation (spec 260 §I.2; spec 247). This is the
   sharpest divergence from HCS-11, which inscribes the whole profile publicly.
3. **`alias` MAY be absent** (name-deferral, spec 257). Consumers MUST NOT treat a missing `alias` as an
   error or substitute the raw `account` address as a display name (spec 259).
4. **`type` includes `org`.** Organizations are canonical SAs with their own profile (ADR-0010); HCS-11
   has no org profile type, so this is an AP extension.
5. **Storage:** an AP-1 document is resolved from the on-chain `AgentProfileResolver` / attribute storage
   (the public anchor) and/or a `profileImage`/metadata URI — NOT an HCS-1 topic inscription. The
   directory (ADR-0030) indexes AP-1 documents for discovery; the resolver is the source of truth.
6. **Validity** is governed by the canonical SA's custody state, not the document — a rotated credential
   (ADR-0011) does not change the `account` and therefore does not invalidate the profile.

### Field crosswalk — HCS-11 `BaseProfile` ↔ AP-1

| HCS-11 `BaseProfile` | AP-1 | Note |
| --- | --- | --- |
| `accountId` (Hedera `0.0.x`) | `account` (CAIP-10) | **anchor; namespace differs** (ADR-0010 maps them) |
| `version` | `ap` | schema version |
| `type` (PERSONAL/AI_AGENT/MCP_SERVER/FLORA) | `type` (person/org/service) | **axes differ; AP adds `org`, drops Flora** |
| `alias` | `alias` | AP = separate naming-registry facet, may be absent |
| `display_name` | `display_name` | match |
| `bio` | `bio` | match |
| `profileImage` (HRL) | `profileImage` (URI) | storage differs |
| `socials[]` | `socials[]` | **adopt HCS-11 platform enum verbatim** |
| `uaid` (HCS-14) | `uaid` | derived locally (ADR-0008) |
| `inboundTopicId`/`outboundTopicId` | `comms.a2a` | URL, not topic ids |
| `aiAgent{…}` capabilities | `service.capability` → AP-2 | see spec 262 |
| `properties` (public free-form) | **(omitted)** | private → vault, not the public tier |

## Rationale / divergence (and why)

- **Public/private split** — because our subject is a *public, correlatable* address (spec 260 §I.2),
  privacy must be engineered at the access layer; an all-public profile inscription (HCS-11) is therefore
  incompatible with our model. Minimal disclosure (Cameron Law 2) is non-negotiable here.
- **`org` type + name-deferral + CAIP-10 anchor** — direct consequences of ADR-0010 / spec 257 that
  HCS-11 does not model.
- **URI/resolver storage, not HCS-1 inscription** — substrate divergence (EVM vs Hedera); the field shape
  still matches so an HCS-11 consumer can read an AP-1 document with a thin adapter.

## Reference: smart-agent patterns to port

`/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`) keeps profile/display metadata on the
identity host keyed to the canonical account — we port that "profile is a facet of the account" shape and
diverge by (i) the CAIP-10 SA anchor + mandatory back-link, (ii) the public/private split, (iii) the
`org` type, (iv) name-deferral. smart-agent has no HCS-11 `socials`/`uaid` block, so those are adopted
from HCS-11, not ported.

## Open items

- Pin the exact `socials.platform` enum + `profileImage` URI schemes against the live HCS-11
  `standards-sdk` before marking AP-1 `accepted`.
- AP-1 → JSON Schema (machine-validatable) once the resolver surface stabilizes.
