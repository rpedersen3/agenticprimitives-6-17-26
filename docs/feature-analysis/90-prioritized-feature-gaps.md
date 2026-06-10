# 90 — Prioritized feature gaps: substrate roadmap

> Consolidated from docs 01–12. Organized **by layer**: `[Contracts]` and `[SDK]` are active and prioritized for execution; `[UX]` gaps are **recorded but parked** (deliberately not a current focus). Priorities: **P0** = production blocker, **P1** = strategic (this/next quarter), **P2** = important (on trigger or after P1), **P3** = watch.
>
> **Execution venue ([ADR-0037](../architecture/decisions/0037-primitives-pure-repo-external-integration-and-ux-layers.md)):** this repo ships primitives only; integration layers (protocol bridges, registry sync, indexers, discovery APIs) and product/UX layers are built in **external repos** (`agentic-trust`, `agent-indexer`, `agent-explorer`, `oasf`, …). Gaps below marked **⤴ external** stay on this roadmap as ecosystem priorities, but their code lands outside this repo — what lands *here* is only their Ring 0 prerequisites (expressive schemas, SA-signed payloads, complete events, stable read interfaces). All `[UX]` gaps are external by definition.
>
> **⤴ external (Ring 1):** FG-REG-1 (8004 sync — `agentic-trust`), FG-REG-2's publication half (card *signing* stays here), FG-REG-3 (ANS bridge), FG-REG-6 (DNS-AID), FG-REG-8 (HCS/UAID), FG-DIR-1/FG-DIR-2 (discovery surfaces), FG-AUD-1 (indexer — `agent-indexer`), FG-ONT-3's OASF mapping (`oasf`), FG-VC-4's Veramo half, FG-MCP-1's MCP Registry publication, FG-ENT-1/FG-ENT-2 (enterprise connectors), FG-SDK-5 (onramps), FG-PM-3's bundler-service half.

## Executive summary — the ten moves that matter most

| # | Move | Layer | Why now |
| --- | --- | --- | --- |
| 1 | Close the four **P0 contract** items (label normalization, ERC-7562 paymaster validation, paymaster ownership, ATT-1 issuer binding) | `[Contracts]` | Mainnet blockers per the [contract audit](../audits/2026-06-10-contract-by-contract-audit.md) |
| 2 | Close the three **P0 SDK** custody items (KMS/HSM signing, custody evidence, mandatory session-delegation binding) | `[SDK]` | Production custody is the substrate's credibility |
| 3 | **AP CLI + agent-skills packs** (`npx skills add agenticprimitives/agent-skills`) | `[SDK]` | MetaMask Agent Wallet just proved the distribution channel (doc 02/08); near-zero-cost adoption by every skills-capable framework |
| 4 | **ERC-8004 registration flow** ⤴ external (`agentic-trust`) — every Smart Agent gets an 8004 identity owned by its SA; this repo's part is the attestation/card primitives 8004 projects from | `[SDK]` | Standard went live on mainnet 2026-01-29; the registry layer is being settled *now* (doc 12) |
| 5 | **Signed agent-card bundle** — SA-attested (ERC-1271) card *primitive* here; A2A/8004 `agentURI`/ANS publication ⤴ external | `[SDK]` | Convergence point of registry/discovery; nobody ships verifiable cards (doc 12) |
| 6 | **GoDaddy ANS bridge** ⤴ external — cross-proof *attestation schema* here; DNS/X.509 plumbing outside | `[SDK]` | ANS is winning enterprise discovery (MuleSoft); dual-rooted identity is a unique position (doc 12) |
| 7 | **AP indexer** ⤴ external (`agent-indexer`) — this repo ships event completeness (FG-AUD-4) + ABIs | `[SDK]` | Closes ADR-0012's open half; prerequisite for explorers, timelines, reputation (doc 10) |
| 8 | **Cumulative budget enforcer** + quorum nonces | `[Contracts]` | Per-call-vs-cumulative is the delegation model's biggest semantic hole (DM-1/DM-2/EN-22); prerequisite for agent payments (docs 04/09) |
| 9 | **MCP Authorization conformance + delegated-authority MCP profile** | `[SDK]` | Conform on OAuth table stakes, then publish the spec that makes AP the delegation layer for MCP (doc 08) |
| 10 | **x402 integration** under spend caveats | `[SDK]` | Delegation-scoped machine payments is a combination no one ships (doc 09) |

---

## `[Contracts]` roadmap — active

### P0 — production blockers

| ID | Gap | Source doc | Evidence |
| --- | --- | --- | --- |
| FG-NAME-1 | On-chain label normalization (charset enforcement in `AgentNameRegistry` + `PermissionlessSubregistry`) | 06 | ENS ENSIP-15; audit AN-1-ONCHAIN |
| FG-SEC-10 | ERC-7562-compliant paymaster validation (no governance storage read in validation) | 05 | audit PM-1; all compliant bundlers |
| FG-SEC-11 | Paymaster owner = governance timelock + deposit protections | 05 | audit PM-2 |
| FG-SEC-12 | Bind `assertJointAgreement` issuer signature (typehash/parties/chain/contract) | 07 | audit ATT-1 (High) |

### P1 — strategic

| ID | Gap | Source doc | Evidence |
| --- | --- | --- | --- |
| FG-REG-10 | **Registry kit (contracts + standards)** — generic SA-anchored registry base: entry owner IS a Smart Agent, pluggable membership/validation hooks, typed claim slots over `attestations`, lifecycle (expiry/renew/revoke), complete events; + published card-schema/binding-proof specs | 12, [ADR-0038](../architecture/decisions/0038-many-registries-hypothesis-registry-building-primitives.md) | Many-registries hypothesis; ERC-8004 + HCS as design inputs |
| FG-DELEG-1 | Stateful **cumulative/periodic budget enforcer** (caps across redemptions) | 04, 09 | audit DM-1/EN-22; AP2 mandates; MetaMask Guard Mode |
| FG-SEC-9 | Nonce/expiry in quorum + approved-hash signatures | 04 | audit DM-2/EN-13 |
| FG-CON-STD-1 | ERC-7715/7710-compatible permission + delegation encoding | 02, 04 | MetaMask Delegation Framework |
| FG-NAME-2 | Registrar economics: real expiry/renewal/grace/reclaim | 06 | ENS; audit AN-2 |
| FG-NAME-3 | Anti-squatting: commit-reveal + cost barrier on subregistry | 06 | audit SUB-1/2 |
| FG-NAME-4 | ENS-compatible resolver interface (CCIP-Read) | 06 | ENS wallet ecosystem |
| FG-VC-1 | Real revocation keyed on `(issuer, credentialHash)` | 07 | audit ATT-2; EAS |
| FG-VC-2 | Attestation schema registry (typed shapes, referenced attestations) | 07 | EAS, Verax |
| FG-SEC-1 | External audit + bug bounty (process gate, contract-adjacent) | 02 | Safe-grade credibility |

### P2 — important

| ID | Gap | Source doc |
| --- | --- | --- |
| FG-NAME-5 | Round-trip-verified forward resolution (no owner fallback) | 06 |
| FG-CON-STD-2 | Module registry + security attestation for AP 7579 modules | 02 |
| FG-PM-1 | Per-sender spend budgets + `_postOp` accounting | 05 |
| FG-PM-2 | ERC-20 gas payment paymaster variant | 05 |
| FG-STD-3 | EIP-7702 support for EOA-custodian onboarding | 05 |
| FG-REG-4 | Agent-work intent marketplace contracts (post/match/fulfill/dispute) | 12 |
| FG-AUD-4 | Event completeness review (indexable events for every state change) | 10 |
| FG-ONT-1 | Skill claims upgradeable from self-claim to issuer-attested | 11 |

### P3 — watch

| ID | Gap | Source doc |
| --- | --- | --- |
| FG-REG-5 | Attestation-backed validator for ERC-8004 Validation Registry | 12 |
| FG-PAY-4 | Stream-aware treasury enforcers (Superfluid/Sablier draw-down) | 09 |

---

## `[SDK]` / package roadmap — active

### P0 — production blockers

| ID | Gap | Source doc | Evidence |
| --- | --- | --- | --- |
| FG-SEC-2 | Production KMS/HSM per-subject derivation + session signing; **block local signer in prod** | 03 | GCP/AWS KMS, Turnkey, Fireblocks |
| FG-SEC-3 | IAM/CloudTrail custody evidence export into audit sink | 03 | pairs with FG-SEC-2 |
| FG-SEC-8 | Mandatory session-delegation binding in every verifier + remint-attack tests | 04 | internal audit; ERC-7710 doctrine |

### P1 — strategic

| ID | Gap | Source doc | Evidence |
| --- | --- | --- | --- |
| FG-REG-11 | **Registry kit (SDK)** — discovery + registry client/server kit working against *any* kit-built registry: register/resolve/query interfaces, signed-card production/verification, domain-bound claim verification, skill-term matching | 12, ADR-0038 | Pairs with FG-REG-10; generalizes FG-REG-2's signing half |
| FG-SDK-1 | **AP CLI (structured JSON) + agent-skills packs** for Claude Code/Cursor/Codex/OpenClaw | 02, 08 | MetaMask `mm` CLI + agent-skills; skills.sh |
| FG-REG-1 | **ERC-8004 registration/sync** (SA-owned identity token, agentURI lifecycle, reputation/validation adapters) ⤴ external — becomes a reference consumer of the registry kit | 12 | ERC-8004 mainnet, 8004scan |
| FG-REG-2 | **Signed agent-card bundle** (A2A + 8004 + ANS from one SA-attested card) | 12 | A2A, ERC-8004, GoDaddy ANS |
| FG-REG-3 | **GoDaddy ANS bridge** (X.509 ↔ SA cross-proof, DNS publication) | 12 | ANS + MuleSoft Agent Fabric |
| FG-AUD-1 | **AP indexer** (Ponder/subgraph) for all registries — closes ADR-0012 | 10 | The Graph, Ponder |
| FG-MCP-1 | MCP Authorization (OAuth 2.1) conformance + MCP Registry publication | 08 | MCP spec |
| FG-MCP-2 | Delegated-authority profile for MCP (spec + reference impl) | 08 | MCP spec gap |
| FG-MCP-3 | A2A agent-card extension schema + card↔SA binding verification | 08 | A2A, ERC-8004 |
| FG-AUD-2 | OTel GenAI tracing + evidence correlation (trace ↔ JTI ↔ grant) | 10 | OTel, LangFuse |
| FG-POL-1 / FG-SEC-5 | Policy simulation + testable bundles + decision logs | 03, 04 | Cerbos, Cedar, Turnkey |
| FG-STD-1 | ERC-7715 permission-request builder/parser | 04 | MetaMask Advanced Permissions |
| FG-STD-4 | DID/VC/SIWE standards-compat library | 06 | SpruceID/DIDKit |
| FG-VC-3 | Indexed attestation query APIs | 07 | EAS (rides FG-AUD-1) |
| FG-VC-4 | W3C VC/VP standards conformance — port agentic-trust Veramo integration | 07, 12 | Veramo, Trinsic, agentic-trust |
| FG-PAY-1 | x402 integration (price-gated MCP tools + payer-side under caveats) | 09 | x402/Coinbase |
| FG-PAY-2 | Payment ↔ audit-evidence binding (receipts tied to agreements) | 09 | Request, x402 |
| FG-SDK-6 | Transaction service (off-chain quorum proposal queue + signature collection) | 02 | Safe |
| FG-SDK-7 | Threat-scan / simulation pipeline on the signing path | 02, 10 | MetaMask (Blockaid), Tenderly |
| FG-SEC-6 | Verifiable custody attestation (keys never leave hardware) | 03 | Turnkey, Lit |
| FG-OPS-1 | Declarative sponsorship rules + budget telemetry | 05 | Alchemy Gas Manager |
| FG-PM-3 | Bundler-client integration parity (permissionless.js-grade) | 05 | Pimlico |

### P2 — important

| ID | Gap | Source doc |
| --- | --- | --- |
| FG-SDK-2 | External wallet connector breadth / chain abstraction | 01 |
| FG-SDK-3 | Key-export / self-custody offboarding | 01 |
| FG-SDK-4 | SMS/email OTP custody factors | 01 |
| FG-SDK-5 | Fiat onramp/offramp adapters | 01 |
| FG-SEC-4 | Fraud/device-risk signal pipeline into policy | 01 |
| FG-ENT-1 | SAML + SCIM provisioning into `identity-directory` | 01 |
| FG-ENT-2 | Enterprise credential issuer integration (Entra Verified ID) | 07 |
| FG-ENT-3 | Institutional approval-workflow engine + compliance export | 03 |
| FG-SDK-8 | Server-wallet async-signing ergonomics (polling model) | 02 |
| FG-SDK-9 | Session-key DX parity (create/scope/revoke in a few lines) | 02 |
| FG-SDK-10 | Multi-chain deployment / chain-abstraction story | 02 |
| FG-MCP-4 | Framework adapters (LangChain/LangGraph, AI SDK, OpenAI Agents) | 08 |
| FG-MCP-5 | External OAuth token-vault adapter (third-party SaaS tools) | 08 |
| FG-POL-2 | Off-chain ReBAC adapter (org/directory permissions) | 04 |
| FG-POL-4 | Formal policy language (Cedar-style) for tool-policy | 04 |
| FG-DIR-1 | Agent discovery/distribution surface (cards findable + interactive) | 06, 12 |
| FG-DIR-2 | Off-chain mutable profile/indexable streams (Ceramic) | 06 |
| FG-NAME-6 | Namespace governance tooling | 06 |
| FG-VC-5 | External trust/personhood signals as policy inputs | 07 |
| FG-VC-7 | EAS-schema interop layer | 07 |
| FG-PAY-3 | Google AP2 mandate compat (delegation → mandate mapping) | 09 |
| FG-PAY-5 | Stablecoin treasury ops (USDC/CCTP) | 09 |
| FG-PAY-6 | Agent-wallet provisioning DX (one-call funded wallet) | 09 |
| FG-AUD-3 | Security alerting on custody/recovery/name events | 10 |
| FG-ONT-2 | JSON-LD/schema.org vocabulary publication + SHACL conformance | 11 |
| FG-ONT-3 | Skill mapping: registry → A2A skills → OASF taxonomy | 11 |
| FG-ONT-4 | Entitlement check API + usage metering | 11 |
| FG-REG-6 | DNS-AID capability/endpoint records | 12 |
| FG-REG-7 | Intent schema + marketplace client + skill-based matching (port smart-agent `003-intent-marketplace-proposal` + discovery) | 12 |
| FG-REG-8 | Hedera/HCS bridge: UAID (HCS-14), HCS-11 profiles, Registry Broker listing | 12 |

### P3 — watch

| ID | Gap | Source doc |
| --- | --- | --- |
| FG-VC-6 | ZK / selective-disclosure credentials (prior art: smart-agent `privacy-creds` circuits) | 07, 12 |
| FG-ONT-5 | Off-chain validator matching on-chain shape semantics | 11 |
| FG-ENT-4 | Compliance screening hook (sanctions/risk) in spend paths | 10 |
| FG-REG-9 | Fee-gated agent-inbox pattern (spam economics) | 12 |
| FG-NAME-7 | Transparency-log checkpointing for `.agent` namespace | 12 |

---

## `[UX]` — recorded, **parked** (not current focus)

Kept for completeness; no IDs, no priorities. Revisit when UX becomes a focus.

| Gap | Evidence | Source doc |
| --- | --- | --- |
| Hosted onboarding + account-linking components | Privy, Clerk, Magic | 01 |
| Policy admin UI + manual-approval queues | Privy, Permit.io | 01, 04 |
| Hosted enterprise admin portal | WorkOS | 01 |
| Onboarding mode-picker / operating-mode selection | MetaMask Agent Wallet | 02 |
| Treasury UI + module marketplace | Safe, Rhinestone | 02 |
| Gas/sponsorship policy dashboard | Alchemy, Pimlico | 02, 05 |
| Consumer recovery UX (guardian invites, status) | Argent, Clave | 03 |
| Approval-workflow console | Fireblocks, Turnkey | 03 |
| Wallet-rendered permission consent | MetaMask | 04 |
| Mainstream naming purchase/branding | Unstoppable Domains | 06 |
| Attestation explorer + issuer directory | EAS explorer | 07 |
| Tool-connection management console | Composio, Arcade | 08 |
| Treasury funding flows, spend dashboards, invoicing surfaces | Safe, Request Finance | 09 |
| Audit/forensics explorer + trace viewer | Dune, LangSmith | 10 |
| Vocabulary/taxonomy browser | OASF | 11 |
| Agent directory browsing; ANS enrollment flow | 8004scan, GoDaddy | 12 |

---

## Sequencing logic

1. **P0 first, both layers in parallel** — contract fixes (items 1) and custody closure (item 2) are independent workstreams.
2. **Distribution + registry next (items 3–6)** — the agent-registry/discovery layer is being settled in the market *now* (ERC-8004 mainnet Jan 2026, ANS/MuleSoft Feb 2026, MetaMask skills Jun 2026); presence there compounds, lateness doesn't.
3. **Indexer (item 7) unlocks** attestation queries, explorers, reputation adapters, and audit timelines — schedule before the VC/attestation P1s that ride on it.
4. **Delegation semantics (item 8) before payments (item 10)** — cumulative budgets are a prerequisite for credible agent spending.
5. Re-baseline quarterly or on market events (next likely trigger: MetaMask Agent Wallet GA, summer 2026).

