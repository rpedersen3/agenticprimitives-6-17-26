# 06 — Naming, profiles, directory & social graph

**Focus area:** mapping addresses/agents to names, profiles, relationship graphs, and discoverable records.
**AP packages in scope:** `agent-naming`, `agent-profile`, `identity-directory`, `identity-directory-adapters`, `agent-relationships`, `related-agents`, `contracts` (`AgentNameRegistry`, resolvers, `PermissionlessSubregistry`, `AgentRelationship`).
**AP capability today:** `.agent` naming protocol with forward/reverse resolution (eth_getLogs-free, round-trip enforced reverse); profile records + predicate resolvers; relationship edges (propose/confirm/activate/revoke); identity-directory adapters.
**Known gaps (from contract audits):** no on-chain label normalization (homoglyph/mixed-case/zero-width squatting — the TS normalizer is bypassable by direct callers, P0); decorative expiry (names never actually expire/reclaim); subregistry front-running + sybil squatting; forward resolution can return an owner-asserted address that doesn't reverse-resolve.

> **Agent registry, discovery & intents** (ERC-8004, GoDaddy ANS, DNS-AID, Hashgraph Online/HCS, agentic-trust, A2A agent cards, intent protocols) are covered in [12 — Agent registry, discovery & intents](12-agent-registry-discovery-intents.md). This doc covers naming-as-protocol; 12 covers registry/discovery-as-trust-infrastructure. HCS-11 profiles + HCS-14 UAID + HCS-27 ANS transparency logs are naming-adjacent facets handled there.

> Gap layers: `[Contracts]` Solidity surface · `[SDK]` TS packages/backends · `[UX]` product surface (**deferred**). See [index](index.md#gap-layers-every-gap-is-classified-into-exactly-one).

---

## Category verdict at a glance

| Product | Type | Tags | Verdict |
| --- | --- | --- | --- |
| ENS | Open protocol | NAME PROFILE DIR | **Integrate + adopt** (resolver maturity, namespace governance) |
| Unstoppable Domains | Commercial protocol | NAME PROFILE | Adopt patterns (mainstream UX) |
| SPACE ID | Commercial/protocol | NAME DIR | Track (cross-chain resolution) |
| Lens Protocol | Open social | PROFILE DIR VC | Adopt patterns (composable profile records) |
| Farcaster | Open social | PROFILE DIR | **Partner** (agent discovery/distribution) |
| Ceramic / ComposeDB | Open network | PROFILE DIR VAULT VC | Integrate option (off-chain mutable records) |
| SpruceID / DIDKit | OSS/commercial | AUTH VC PROFILE | **Integrate** (DID/VC/SIWE compat) |
| Bonfida / SNS | Protocol | NAME PROFILE | Track (non-EVM) |
| Handshake | Protocol | NAME | Track (root governance reference) |
| CyberConnect / Cyber | Protocol | PROFILE DIR VC | Track (graph discovery) |
| Talent Protocol | Commercial/protocol | PROFILE VC | Track (reputation UX) |

---

## Deep dives — primary overlap products

### ENS — integrate + adopt

- **Identity:** the dominant decentralized naming protocol; OSS contracts + broad wallet/dapp resolver support.
- **Feature inventory:** hierarchical names, forward + reverse resolution, text records, the resolver interface every wallet understands, on-chain + off-chain (CCIP-Read) resolution, namespace governance, registrar economics (registration/renewal/expiry/grace).
- **Overlap with AP:** `agent-naming` is conceptually an ENS-shaped registry for `.agent`. AP reverse resolution + resolvers mirror ENS patterns.
- **AP lacks:**
  - `[Contracts]` **on-chain label normalization** — ENS learned this the hard way (ENSIP-15); AP normalizes only in the TS SDK, leaving direct callers free to squat homoglyphs/mixed-case (P0). **Real registrar economics** — registration/renewal/expiry/grace; AP expiry is decorative. ENS-compatible resolver interface (so AP names resolve in any ENS-aware client via compatible resolver / CCIP-Read).
  - `[SDK]` namespace governance tooling + processes.
- **ENS lacks:**
  - `[Contracts]` binding of names to a custody/delegation model and agent identity; names-as-facets-of-a-canonical-SA-address semantics; attestation/relationship integration.
- **Verdict:** integrate (resolver compatibility) + adopt (normalization, registrar economics, governance). ENS is the maturity benchmark for the entire naming package.

### Farcaster — partner

- **Feature inventory:** decentralized social identity (fid), hubs, casts, frames/mini-apps, increasingly an agent surface.
- **Overlap with AP:** `agent-profile` + `identity-directory` discovery; agent cards.
- **AP lacks:**
  - `[SDK]` a distribution/discovery surface — somewhere agents and agent cards are actually found and interacted with (see also doc 12 for registry-based discovery). AP has the identity, not the social distribution.
- **Farcaster lacks:**
  - `[Contracts]` custody/delegation/attestation depth.
- **Verdict:** partner — publish Smart Agent profiles/cards as Farcaster-discoverable, use frames as an interaction surface for agent actions.

### SpruceID / DIDKit — integrate

- **Feature inventory:** DID methods, SIWE reference implementation, VC issuance/verification libraries, decentralized identity standards tooling.
- **Overlap with AP:** SIWE in `connect-auth`; DID representation of the SA (did:ethr per ADR-0010); VC compat (see 07).
- **AP lacks:**
  - `[SDK]` broad DID-method interop and standards-conformant VC tooling; SIWE edge-case hardening reference.
- **Verdict:** integrate as the standards-compat library for DID/VC/SIWE so AP identities interoperate with the wider SSI ecosystem.

### Lens / Ceramic / ComposeDB — adopt / integrate option

- **Lens:** composable profile + social graph records, profile-as-NFT, modules. Adopt the composable profile-record DX for `agent-profile`.
- **Ceramic/ComposeDB:** decentralized mutable, identity-indexed data streams with composable schemas. Integration option for off-chain mutable profile/data where on-chain storage is wrong (high-churn profile fields, indexable streams) — complements `identity-directory-adapters`.

---

## Compact entries

| Product | Overlap with AP | AP lacks | Verdict |
| --- | --- | --- | --- |
| Unstoppable Domains | `agent-naming` UX | Mainstream naming purchase/branding UX; multi-chain identity marketing | Adopt patterns |
| SPACE ID | Cross-chain naming | Cross-chain name resolution + namespace tooling | Track |
| Bonfida / SNS | Naming (Solana) | Non-EVM naming (only if AP expands) | Track |
| Handshake | Root naming | DNS-root governance model | Track |
| CyberConnect | `agent-relationships` graph | Graph-based agent discovery + reputation | Track |
| Talent Protocol | `agent-profile` + reputation | Public reputation scoring UX | Track (07) |

---

## Focus-area gap rollup — by layer

### `[Contracts]` gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| On-chain label normalization (charset enforcement at `AgentNameRegistry` + `PermissionlessSubregistry`) | ENS (ENSIP-15) | FG-NAME-1 | **P0** |
| Registrar economics: real expiry/renewal/grace + reclaim | ENS | FG-NAME-2 | P1 |
| Anti-squatting: commit-reveal + sybil/cost barrier on subregistry | ENS, (internal audit SUB-1/2) | FG-NAME-3 | P1 |
| ENS-compatible resolver interface (CCIP-Read) | ENS | FG-NAME-4 | P1 |
| Round-trip-verified forward resolution (no unverified owner fallback) | (internal audit RES-1) | FG-NAME-5 | P2 |

### `[SDK]` / package gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| DID/VC/SIWE standards-compat library | SpruceID/DIDKit | FG-STD-4 | P1 |
| Agent discovery/distribution surface (cards findable + interactive; registry publication → doc 12) | Farcaster, ERC-8004, GoDaddy ANS | FG-DIR-1 | P2 |
| Off-chain mutable profile/indexable streams | Ceramic/ComposeDB | FG-DIR-2 | P2 |
| Namespace governance tooling | ENS DAO | FG-NAME-6 | P2 |

### `[UX]` gaps — **deferred (recorded, not current focus)**

| Gap | Evidence |
| --- | --- |
| Mainstream naming purchase/branding UX | Unstoppable Domains |
| Public reputation/profile presentation | Talent Protocol, Lens |

**Substrate advantages to preserve:** names/profiles/relationships as facets of one canonical SA address; eth_getLogs-free reverse resolution with round-trip enforcement; relationship edges with explicit two-step consent; the `.agent` protocol owned by the substrate.
