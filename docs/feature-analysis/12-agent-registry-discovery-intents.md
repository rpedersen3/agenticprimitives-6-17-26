# 12 — Agent registry, discovery & intents

**Focus area:** how agents are registered, found, verified, and how work is expressed as intents and matched to agents. The fastest-moving category in the analysis — most entrants shipped 2025–2026.

> **Strategic frame ([ADR-0038](../architecture/decisions/0038-many-registries-hypothesis-registry-building-primitives.md), 2026-06-10):** this document's per-product verdicts ("conform + register", "bridge") are **tactics**, not the strategy. We reject the assumption that ERC-8004, ANS, or HCS becomes "the" registry; the operating hypothesis is **hundreds of registry implementations, mostly vertical** (healthcare, travel, commerce, …), many with their own contracts. The substrate's strategic answer is a Ring 0 **registry kit** (FG-REG-10/11: generic SA-anchored registry contracts, discovery/registry SDK, published card + binding-proof standards) that those registries are *built from* — drawing concepts from ERC-8004/HCS as design inputs. The products below remain interop targets (via external layers, ADR-0037) and pattern sources.
**AP packages in scope:** `agent-naming` (`.agent` protocol), `agent-profile`, `identity-directory` + adapters, `attestations` (verification), `agent-relationships`; intent-marketplace lineage from smart-agent branch `003-intent-marketplace-proposal`.
**AP capability today:** canonical SA address as the identity anchor with names/profiles/ERC-8004 entries/ANS handles as *facets* (ADR-0010, spec 220); on-chain name registry + resolvers; directory adapters; relationship graph. **No ERC-8004 registration flow, no DNS-based discovery publication, no intent marketplace implementation yet.**

> Gap layers: `[Contracts]` Solidity surface · `[SDK]` TS packages/backends · `[UX]` product surface (**deferred**). See [index](index.md#gap-layers-every-gap-is-classified-into-exactly-one).

---

## Category verdict at a glance

| Product | Type | Tags | Verdict |
| --- | --- | --- | --- |
| **ERC-8004 (Trustless Agents)** — live on mainnet 2026-01-29 | Open standard | DIR NAME VC AUDIT | **Conform + register** (the on-chain registry standard) |
| **GoDaddy Agent Name Service (ANS)** | Commercial + IETF draft + OSS | NAME DIR AUTH | **Bridge** (DNS/PKI agent identity) |
| Infoblox DNS-AID | Open standard effort | DIR | Conform-watch (DNS-based capability discovery) |
| 8004scan / agent explorers | OSS/commercial | DIR AUDIT | Track (be listed, verify rendering) |
| A2A agent cards (`/.well-known/agent-card.json`) | Open standard | DIR PROFILE | **Conform** (already partial via demo-a2a) |
| MCP Registry | Open registry | DIR MCP | Conform (publish AP MCP servers; see 08) |
| MuleSoft Agent Fabric / enterprise agent registries | Commercial | DIR POLICY | Track (enterprise distribution via ANS) |
| AGNTCY (Cisco/Linux Foundation) agent directory | OSS | DIR ONTO | Conform-watch (OASF records; see 11) |
| **Hashgraph Online / HCS standards** (hol.org) | DAO + open standards (Apache-2.0) + hosted Registry Broker | DIR NAME PROFILE VC MCP | **Bridge** (UAID/HCS-11 facet, Registry Broker listing) |
| **agentic-trust** (agentictrustlabs) | OSS (MIT) sibling lab | DIR VC MCP DELEG | **Converge + port** (ERC-8004 SDK, Veramo, trust graph) |
| **smart-agent** (agentictrustlabs) | OSS sibling — AP's pattern lineage | DIR CUSTODY VC ONTO | **Lineage — port deliberately** |
| ERC-7683 (cross-chain intents, Across/Uniswap) | Open standard | PAY DELEG | Adopt patterns (intent settlement) |
| CoW Protocol / UniswapX | OSS protocol | PAY | Adopt patterns (solver/auction mechanics) |
| Anoma | Protocol | DELEG PAY | Track (generalized intent machine) |

---

## Deep dives — primary overlap products

### ERC-8004 "Trustless Agents" — conform + register

- **Identity:** Ethereum standard, mainnet singletons live 2026-01-29. Three registries: **Identity** (ERC-721 handle; `tokenURI` → agent registration file, typically `/.well-known/agent-card.json`, CAIP-10 addressing), **Reputation** (on-chain feedback signals), **Validation** (TEE attestation / zkML / staking verification hooks).
- **Overlap with AP:** AP doctrine already names ERC-8004 entries as a *facet* of the canonical SA address (ADR-0010). Identity Registry ≈ thin pointer layer above AP's richer identity; Reputation/Validation ≈ AP `attestations`.
- **AP lacks:**
  - `[SDK]` a registration/sync flow: deploy SA → mint ERC-8004 identity → keep `agentURI` pointing at the AP-generated agent card; reputation/validation adapters mapping AP attestations into 8004 signals; CAIP-10 multi-chain identity handling.
  - `[Contracts]` nothing required — 8004 registries are external singletons; AP should *consume*, not fork. (Optional: an attestation-backed validator contract pluggable into the Validation Registry.)
- **ERC-8004 lacks:** custody/recovery (the ERC-721 owner key is a single point of failure — an AP SA as owner fixes this); enforcement (registration ≠ authority); rich relationship/agreement semantics.
- **Verdict:** conform + register. "Every Smart Agent is an ERC-8004 agent whose identity token is owned by a custody-tiered SA" is a strictly stronger story than raw 8004. Be visible on 8004scan.

### GoDaddy Agent Name Service (ANS) — bridge

- **Identity:** DNS+PKI agent identity/naming/verification; co-authored IETF draft; open API (AgentNameRegistry.org) + standards site; X.509 agent certificates with lifecycle (enroll/renew/revoke); protocol-agnostic adapters (A2A, MCP); enterprise traction (Salesforce MuleSoft Agent Fabric integration, Feb 2026).
- **Overlap with AP:** direct naming-layer competitor-and-complement to `.agent`. ANS answers "who is this agent" with DNS/PKI; AP answers it with on-chain custody-anchored identity. ADR-0010 already lists "ANS handles" as a facet.
- **AP lacks:**
  - `[SDK]` an ANS bridge: register/verify ANS records for Smart Agents (agent's domain identity ↔ SA address binding, attested on-chain); DNS-record publication tooling; X.509 ↔ SA-key cross-proof so a cert-verified agent can prove it IS a given SA.
  - `[UX]` (deferred) registrar-grade enrollment experience.
- **ANS lacks:** decentralized trust root (registrar/CA hierarchy); custody/recovery semantics; on-chain enforcement; delegation. A revoked cert says nothing about on-chain authority.
- **Verdict:** bridge, don't fight. DNS/PKI is how *enterprises* will verify agents; on-chain is how *value/authority* moves. The dual-rooted agent (ANS-verified + SA-anchored, mutually attested) is a differentiated position no one ships.

### Infoblox DNS-AID — conform-watch

- **Identity:** open standards effort: publish agent capabilities/endpoints in DNS for discovery; complementary to ANS (ANS = who, DNS-AID = what/where).
- **AP lacks:** `[SDK]` DNS-AID record publication for AP agents (capability/endpoint discovery via DNS) alongside agent cards.
- **Verdict:** conform-watch; cheap to adopt once records stabilize, rides the same bridge work as ANS.

### A2A agent cards + MCP Registry — conform

- **Overlap:** `demo-a2a` serves cards; doc 08 covers transport conformance.
- **AP lacks:** `[SDK]` *signed* agent cards (card contents attested by the SA so a card can't be spoofed for a known agent — ties ERC-8004 `agentURI`, ANS identity, and A2A cards into one verifiable bundle); MCP Registry publication.
- **Verdict:** conform; the signed-card bundle is the convergence point of this whole doc.

### Hashgraph Online / HCS standards — bridge

- **Identity:** Hashgraph Online DAO (≈9 Hedera-ecosystem orgs, est. Nov 2024; hol.org). Ships the HCS standards (now "Hiero Consensus Standards", Apache-2.0), `@hashgraphonline/standards-sdk`, and a hosted **Registry Broker** — cross-protocol agent discovery claiming coverage of A2A, **ERC-8004**, Virtuals, x402, NANDA.
- **Feature inventory (agent-relevant standards):** **HCS-10 OpenConvAI** (agent registration/discovery + secure A2A over topics, HIP-991 fee-gated inboxes for spam economics); **HCS-11** profiles; **HCS-14 UAID** (universal cross-protocol agent ID, deterministic or DID-based, explicitly models EVM agents via CAIP-10/`did:pkh`); **HCS-26** skills registry (versioned skill packages, DNS TXT domain proof); **HCS-25** composite trust score; **HCS-19** privacy-compliance records (ISO/IEC TS 27560); **HCS-27** ANS transparency log; HCS-2 topic registries + HCS-1/3 file storage underneath.
- **Architecture vs AP:** schemas over ordered pub/sub topics, *no contract enforcement* — validity is interpreted client-side by indexers; flat ~$0.0001/message fees; fair per-topic total ordering. AP/ERC-8004 enforce state transitions in-contract. Notably, HCS's indexer-only read model is what ADR-0012 pushes AP toward anyway.
- **Overlap with AP:** AP doctrine already names "HCS topics" as a facet of the canonical SA address (CLAUDE.md/ADR-0010). HCS-11 ≈ `agent-profile`; HCS-26 ≈ `agent-skills`; HCS-10 registry ≈ directory; HCS-25 ≈ attestation-derived reputation; HCS-27 ≈ `.agent` transparency concerns.
- **AP lacks:**
  - `[SDK]` UAID (HCS-14) issuance/resolution for Smart Agents (the natural alignment point — UAID models EVM agents); HCS-11 profile publication + HCS-10 registry listing so AP agents are discoverable on Hedera surfaces (Moonscape, Registry Broker); fee-gated inbox *pattern* (spam economics for agent contact); transparency-log checkpointing for the `.agent` namespace (HCS-27 pattern).
- **Hashgraph Online lacks:**
  - `[Contracts]` enforcement — no on-chain authority; a malformed/unauthorized message is merely ignored by indexers. No custody, no quorum, no delegation redemption, no recovery. HCS-25 trust scores are methodology, not cryptographic attestation.
  - `[SDK]` EVM-native account/delegation semantics (UAID bridges identity, not authority).
- **Verdict:** bridge — same posture as GoDaddy ANS: publish AP agents into their discovery surfaces (UAID + HCS-11 + Registry Broker) as facets, adopt the fee-gated-inbox and transparency-log patterns, and keep authority/custody on the contract layer where they have nothing. Their adoption claims are self-reported; treat as early-stage.

### agentic-trust (agentictrustlabs) — converge + port

- **Identity:** MIT-licensed TS monorepo (374 commits; agentic-trust-admin.vercel.app). Packages: `@agentic-trust/core` (AgenticTrustClient, A2A protocol, **Veramo DID integration**, ERC-8004 reputation, session-package smart-account delegation), `agentic-trust-sdk` (ERC-8004 extensions), `erc8004-sdk` (Viem/Ethers adapters). Apps: web client + provider (A2A endpoint, `/.well-known/agent.json`). Sibling lab to AP.
- **Feature inventory:** GraphQL agent discovery (search by `supportedTrust`, `a2aSkills`, OASF skill IDs); ERC-8004 Identity/Reputation/Validation registry clients on multi-chain testnets (Sepolia/Base/Optimism); **trust graph** = Validator ↔ Agent ↔ Reviewer with stake-secured validations, slashing, leaderboards, vertical validator pools; relational VCs with selective disclosure; ENS integration; session packages for AA delegation.
- **Overlap with AP:** large and *complementary* — it builds exactly the ERC-8004/Veramo/discovery layer AP marked as gaps (FG-REG-1, FG-VC-4, FG-DIR-1), while AP owns the custody/delegation/enforcement layer it treats lightly (private-key + session-package singletons vs AP custody tiers).
- **AP lacks:**
  - `[SDK]` working ERC-8004 registry clients + Viem/Ethers adapters (theirs is portable prior art for FG-REG-1); Veramo-based DID/VC integration in practice (FG-VC-4); GraphQL discovery API with skill/trust filtering (FG-DIR-1); validator/reviewer reputation-graph model; A2A `/.well-known/agent.json` provider scaffold.
  - `[Contracts]` validator staking/slashing economics for validation pools (if AP ever wants economically-secured validation).
- **agentic-trust lacks:**
  - `[Contracts]` custody (env-var private keys, session packages — no tiers/quorum/recovery); canonical-identity doctrine (identity is registry entries, not a custody-protected SA); enforcement of delegations on-chain via caveats.
  - `[SDK]` audit-evidence discipline; tool-level authorization (MCP gating).
- **Verdict:** converge + port. Same org family — the right outcome is one stack: port its `erc8004-sdk`/Veramo/discovery work to close AP's FG-REG-1/FG-VC-4/FG-DIR-1 instead of rebuilding, and re-root its agents on AP custody (SA-owned 8004 tokens, ADR-0010). Its trust-graph + validator-pool design is the candidate architecture for FG-REG-5.

### smart-agent (agentictrustlabs) — lineage, port deliberately

- **Identity:** the repo AP's patterns are explicitly ported from (CLAUDE.md; local `/home/barb/smart-agent`, branch `003-intent-marketplace-proposal`). TS + Solidity; packages `contracts`, `credential-registry`, `discovery`, `key-custody`, `privacy-creds` (zk circuits + ptau artifacts), `sdk`, `types`; apps: `a2a-agent`, `web`, and seven vertical MCP servers (family/geo/hub/org/people-group/person/skill/verifier-mcp); `examples/discovery-agent`.
- **Overlap with AP:** by construction — AP is the productized re-architecture. The comparison is about what *hasn't* been ported yet.
- **Not yet ported (AP lacks):**
  - `[Contracts]` the intent-marketplace surface from `003-intent-marketplace-proposal` (= FG-REG-4's source material).
  - `[SDK]` `privacy-creds` zk credential circuits (selective disclosure / private eligibility → FG-VC-6 prior art); `discovery` package + `discovery-agent` example (agent discovery flows → FG-DIR-1); `verifier-mcp` patterns (credential-verification-as-a-tool).
- **smart-agent lacks (what AP improved):** package-boundary doctrine (one-directional edges, custody firewall, spec 213); thin ERC-7579 modular account vs monolith; ADR-0012/0013 read-path discipline; generic-vs-vertical separation (ADR-0021 — its vertical MCPs live where AP puts apps).
- **Verdict:** lineage. Mine it deliberately: intent marketplace (FG-REG-4), zk privacy-creds (FG-VC-6), discovery agent (FG-DIR-1) are already-written reference implementations — porting beats greenfield, per the "always check smart-agent first" rule.

### Intent protocols (ERC-7683, CoW, UniswapX, Anoma) — adopt patterns

- **Identity:** intents = signed declarations of desired outcome, settled by competing solvers. ERC-7683 standardizes cross-chain intent structs + settlement; CoW/UniswapX prove the auction/solver model; Anoma generalizes it.
- **Overlap with AP:** the smart-agent lineage branch (`003-intent-marketplace-proposal`) is an intent marketplace *for agent work* — humans/orgs post intents, agents fulfill under delegated authority. AP delegations + caveats are precisely the authority envelope an agent-work intent needs; agreements/attestations are the fulfillment record.
- **AP lacks:**
  - `[Contracts]` an intent-settlement surface: post/match/fulfill/dispute lifecycle binding intent → delegation → agreement → attestation (port the marketplace spec from smart-agent).
  - `[SDK]` intent schema + marketplace client; solver/agent matching against `SkillDefinitionRegistry` + directory (discovery feeds matching); ERC-7683 compat where intents touch cross-chain value.
- **They lack:** all of them settle *token outcomes*; none express *agent-work* intents with identity, skills, custody, and attestation-backed fulfillment. This is open ground AP is uniquely shaped for.
- **Verdict:** adopt patterns (7683 structs, solver auctions) and build the agent-work intent marketplace — the substrate's native demand-side.

---

## Compact entries

| Product | Overlap with AP | AP lacks (layer) | Verdict |
| --- | --- | --- | --- |
| 8004scan | Registry explorer | `[SDK]` correct listing/rendering of AP agents | Track |
| MuleSoft Agent Fabric | Enterprise agent governance | `[SDK]` enterprise registry feeds (via ANS bridge) | Track |
| AGNTCY directory | OASF capability records | `[SDK]` OASF mapping (see 11, FG-ONT-3) | Conform-watch |
| Virtuals / Olas registries | Tokenized agent registries | — (different economics; watch discovery UX) | Track |

---

## Focus-area gap rollup — by layer

### `[Contracts]` gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| Agent-work intent marketplace contracts (post/match/fulfill/dispute, bound to delegation + agreement + attestation) | ERC-7683, CoW, smart-agent spec lineage | FG-REG-4 | P2 |
| Optional: attestation-backed validator for ERC-8004 Validation Registry (candidate architecture: agentic-trust validator pools w/ staking/slashing) | ERC-8004, agentic-trust | FG-REG-5 | P3 |

### `[SDK]` / package gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| **ERC-8004 registration/sync flow** (SA-owned identity token, agentURI lifecycle, reputation/validation adapters) — **port agentic-trust `erc8004-sdk` rather than rebuild** | ERC-8004, 8004scan, agentic-trust | FG-REG-1 | **P1** |
| **Signed agent-card bundle** (one verifiable card serving A2A + 8004 agentURI + ANS, attested by the SA) | A2A, ERC-8004, ANS | FG-REG-2 | **P1** |
| GoDaddy ANS bridge (DNS/X.509 identity ↔ SA binding, cross-proof, record publication) | GoDaddy ANS, MuleSoft | FG-REG-3 | P1 |
| DNS-AID capability/endpoint records | Infoblox DNS-AID | FG-REG-6 | P2 |
| Intent schema + marketplace client + skill-based matching (**port smart-agent `003-intent-marketplace-proposal` + discovery package**) | ERC-7683, smart-agent lineage | FG-REG-7 | P2 |
| Hedera/HCS bridge: UAID (HCS-14) issuance, HCS-11 profile publication, Registry Broker listing | Hashgraph Online | FG-REG-8 | P2 |
| GraphQL discovery API with skill/trust filtering (**port from agentic-trust**) | agentic-trust | FG-DIR-1 (part) | P2 |
| Fee-gated agent-inbox pattern (spam economics for agent contact) | HCS-10/HIP-991 | FG-REG-9 | P3 |
| Transparency-log checkpointing for the `.agent` namespace | HCS-27, CT logs | FG-NAME-7 | P3 |

### `[UX]` gaps — **deferred (recorded, not current focus)**

| Gap | Evidence |
| --- | --- |
| Agent directory/discovery browsing surface | 8004scan, AGNTCY, Moonscape |
| Registrar-grade ANS enrollment flow | GoDaddy |
| Trust-graph explorer (validator ↔ agent ↔ reviewer edges inspectable) | agentic-trust |

**Substrate advantages to preserve:** the canonical-address doctrine is *exactly right* for this category — every registry entry (8004 token, ANS record, A2A card, `.agent` name) is a facet pointing at one custody-protected SA. Competitors have registries without custody or custody without registries; AP's identity anchor unifies them. The intent marketplace is the substrate's native demand-side and nobody else can bind intent → authority → fulfillment → attestation.
