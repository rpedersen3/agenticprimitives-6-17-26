# 91 — Next push: discovery → intent → outcome

> **Question this document answers** (2026-06-10): *"From the feature gaps it feels like our next push needs to be around agent discovery and alignment of client intent to outcomes — and how discovery plays into that. agent-skills, registration flow, signed agent-card, GoDaddy ANS all play to this gap. Recommend the set of new/updated features/packages/contracts that fills it; give critical feedback if the market dictates a different focus."*
>
> Constrained by **[ADR-0037](../architecture/decisions/0037-primitives-pure-repo-external-integration-and-ux-layers.md)** (this repo ships Ring 0 primitives only; bridges/indexers/discovery APIs/UX are external layers) and re-baselined against **master as of 2026-06-10 15:01** — which closed most of the security riders the first draft of this answer carried (see §5).

## 1. Thesis

Doc 12's closing line is the strategy: *"nobody else can bind intent → authority → fulfillment → attestation."* Discovery surfaces (ERC-8004, ANS, HCS, A2A cards) are being settled in the market **now**, but they all stop at *finding* an agent. The substrate's unique ground is what happens after finding: a client expresses an intent, a discovered agent is matched on **verifiable skills**, hired under **enforceable delegated authority**, and the outcome lands as an **attested, auditable record** against a custody-protected identity.

**Registry frame ([ADR-0038](../architecture/decisions/0038-many-registries-hypothesis-registry-building-primitives.md)):** we reject the assumption that any of those discovery surfaces becomes "the" registry. The operating hypothesis is **hundreds of registries, mostly vertical** (healthcare, travel, commerce, …). So the discovery half of this push is not "get registered in the winners" — it is shipping the **registry kit** (§2.0) that those hundreds of registries are built from, with ERC-8004/HCS as concept sources.

So the push is one chain, named end to end:

> **Discoverable** (card + registry kit) → **Trustable** (signed claims, hardened skills) → **Hirable** (intent schema + matching) → **Provable** (delegation-bounded fulfillment + attestation).

ADR-0037 splits the work: this repo makes every link of that chain *expressible and enforceable*; external repos make it *published and browsable*.

## 2. Ring 0 — what lands in this repo

### 2.0 The registry kit — contracts + SDK + standards (FG-REG-10/11, ADR-0038) — the strategic centerpiece

What every vertical registry needs and shouldn't build: **[Contracts]** a generic SA-anchored registry base — entry owner IS a Smart Agent (custody/recovery inherited), pluggable membership/validation policy hooks (issuer-attested admission, stake, quorum), typed claim slots over `attestations`, full lifecycle (expiry/renew/revoke — the AN-2 lesson designed in), complete indexable events. **[SDK]** register/resolve/query interfaces that work against *any* kit-built registry + claim verification + skill-term matching. **[Standards]** published card-schema and entry↔SA binding-proof specs so independent implementations interop without our code. Specific registries — vertical or 8004/ANS/HCS bridges — are external consumers (ADR-0037); they become *reference implementations of the kit*, not the point.

### 2.1 SA-signed agent-card primitive — `agent-profile` (+`attestations`)

The convergence point of doc 12 (FG-REG-2, P1) — kept here in its **signing half only**; the card is the kit's identity artifact.

- Canonical card payload schema (identity = SA address, names, endpoints, skill claims, trust facets) + deterministic hashing.
- ERC-1271 attestation by the SA (works for every credential strategy, survives rotation per ADR-0011) + verification API (`card ↔ SA` binding check).
- Designed for projection: the same signed payload must serve **any registry** — A2A `/.well-known/agent-card.json`, ERC-8004 `agentURI`, ANS records, and every kit-built vertical registry — **without modification**. That's the Ring 0 acceptance test (ADR-0038 generalizes it beyond the named three).
- Publication/sync of the card to any surface: ⤴ external (`agentic-trust`).

### 2.2 Skills as the matching vocabulary — `agent-skills`, `geo-features`, `contracts`

Matching is only as trustworthy as the claims it matches on. Three items, two of them **open audit findings squarely on this push's critical path**:

| Item | Source | Status |
| --- | --- | --- |
| Bind `skillEndorsementDigest` / `geoEndorsementDigest` to chainId + verifyingContract | NEW-SKILL-1 / NEW-GEO-1 (P2, **open**) | Required before any endorsement-weighted matching |
| Skill claims upgradeable self-claim → issuer-attested | FG-ONT-1 | The trust gradient matchers will sort by |
| Stable skill IDs exposed for external taxonomy mapping (OASF/A2A skills) | FG-ONT-3 | IDs here; mapping ⤴ external (`oasf`) |

### 2.3 Intent primitives — fill the `intent-marketplace` / `intent-resolver` / `fulfillment` stubs

The stubs exist, spec'd and honest about being stubs. Implementation ports the **primitive half** of smart-agent `003-intent-marketplace-proposal` (FG-REG-7) per the lineage rule:

- Intent schema + commitment math (EIP-712, chain/contract-bound — learn from this week's ATT/AGR/SKILL digest lessons *the first time*).
- Resolution: expressed intent → canonical order with required-skill terms that match registry skill IDs.
- Fulfillment evidence: intent commitment → delegation (the authority envelope) → agreement → attestation, closing **NEW-FLF-1** (`isHandoffAllowed` currently ignores `requiresUserApproval`/privacy-tier/scopes/hop-count) on the way.
- Marketplace *client/solver network*: ⤴ external when demand shows up.

### 2.4 The authority envelope — `contracts` (the one new contract surface)

"Hire an agent under a budget" is not credible with today's per-call-only caveats. This is the highest-value contract work in the push:

| Item | Findings/IDs | Why it's in this push |
| --- | --- | --- |
| **Cumulative/periodic budget enforcer** (stateful caps across redemptions) | FG-DELEG-1; DM-1/EN-22 (open) | The intent→outcome story collapses without it; prerequisite for payments later |
| Nonce/expiry in quorum + approved-hash signatures; zero-threshold revert | FG-SEC-9; DM-2/EN-13/EN-11 (open) | Same envelope, same wave |
| Event completeness review | FG-AUD-4 | Ring 0's contract with `agent-indexer` — every state change indexable |

### 2.5 Naming trust riders — `contracts` (naming)

Discovery raises the stakes on name trust: a marketplace that resolves `advisor.agent` to the wrong SA is a matching engine for fraud. SUB-1/SUB-2 (commit-reveal + cost barrier on the permissionless subregistry) and AN-2 (real expiry/reclaim) move from "open Medium" to **riders on this push** (FG-NAME-2/3).

### 2.6 ANS cross-proof schema — `attestations`

The Ring 0 half of FG-REG-3: an attestation schema asserting `X.509/DNS identity ↔ SA` cross-proof, so a cert-verified agent can prove it IS a given SA. DNS/X.509 plumbing, enrollment, record publication: ⤴ external.

## 3. Ring 1/2 — what executes externally (tracked, not built here)

| Layer | Repo | Work |
| --- | --- | --- |
| ERC-8004 registration/sync (SA-owned token, `agentURI` → signed card), Veramo DID/VC, GraphQL discovery w/ skill+trust filtering | `agentic-trust` | FG-REG-1, FG-VC-4, FG-DIR-1 — its `erc8004-sdk` is the prior art; re-root its agents on AP custody |
| Indexer feeds for names/skills/attestations/agreements (already runs multi-chain subgraphs + EAS schemas) | `agent-indexer` | FG-AUD-1 — consumes §2.4's event completeness |
| Directory/explorer UX, trust-graph browsing | `agent-explorer` | `[UX]` (deferred-from-here by definition) |
| OASF taxonomy mapping for §2.2's skill IDs | `oasf` | FG-ONT-3 mapping half |
| ANS/DNS-AID/HCS-UAID publication | venue TBD | FG-REG-3/6/8 publication halves |

## 4. Sequencing

1. **§2.2 hardening + §2.4 enforcer first** (small, audit-driven, unblock everything): domain-bound endorsements, cumulative budgets, quorum nonces, event completeness.
2. **§2.1 signed card** next — the kit's identity artifact, the thing every registry projects.
3. **§2.0 registry kit** — spec first (the standards doc IS a deliverable per ADR-0038), then contracts + SDK; the card (§2.1) and claim slots (`attestations`) are its inputs, which is why it sequences after them.
4. **§2.3 intent primitives** — schema/resolution/fulfillment evidence chain; spec first per doctrine, porting smart-agent 003. Matching consumes kit-built registries' entries.
5. §2.5/§2.6 riders land opportunistically alongside.
6. External layers (§3) proceed in parallel in their own repos against published package versions — their schedule is not this repo's schedule. First-party proof: re-shape one bridge (e.g. 8004 sync) as a *kit consumer* to validate the kit's interfaces.
7. **No marketplace settlement contracts yet** (FG-REG-4 stays P2-on-trigger): pour concrete when a real counterparty shows up; agreements + attestations already record outcomes.

## 5. Critical feedback — re-baselined against master (2026-06-10)

**What master already absorbed.** The first draft of this answer carried a "don't ship discovery with open P0s" rider. Master closed most of it *today*: CP-1/CP-2, PM-1/PM-2, WA-1/WA-2, NEW-MCP-1 closed; DEL-001 fail-closed by default and production-enforced (ADR-0036); CA-F1/AN-1-ONCHAIN/ATT-1/AGR-1/SIG-1 closed this morning with a Base Sepolia redeploy. That rider is now mostly satisfied — the push can lead with discovery rather than queue behind security.

**What still gates, honestly:**

1. **Production custody is still the credibility gate.** FG-SEC-2/3 (KMS/HSM per-subject signing in prod, custody evidence export) and CON-FACTORY-001 (governance key rotation — an ops ceremony) remain open. Being *discoverable* with testnet-grade custody is fine; being *hirable with real budgets* is not. These must land before the intent layer takes non-test value.
2. **The open findings inside this push's own path** — NEW-SKILL-1/NEW-GEO-1, NEW-VC-1 (revocation not enforced in `verifyCredential`), ATT-2 (cosmetic revocation), NEW-FLF-1 — are not riders, they're §2 work items. A matching engine built on replayable endorsements and unrevocable credentials would be this market's signature failure mode.
3. **Distribution may outrank bridges.** FG-SDK-1 (AP CLI + agent-skills packs) is the one P1 this document doesn't schedule, and the MetaMask channel evidence says it's the cheapest adoption lever we have. It's also pure Ring 0 (a generic SDK surface). If capacity forces a cut, cut §2.6 before FG-SDK-1 — reconsider it as item 2.5-bis.
4. **The registry category fragments; enforcement still doesn't.** Under ADR-0038's many-registries hypothesis, "which index wins" stops mattering — listing in ERC-8004/ANS/HCS is table-stakes tactics handled by external layers, and the kit (§2.0) profits from proliferation regardless. The durable moat is unchanged either way: a discovered AP agent's card, skills, and budget are **enforceable claims**. If anything in §2 slips, protect 2.0/2.2/2.3/2.4 and let 2.6 slip. (Hedge: if a single registry *does* win network-effects-style, kit-built registries project into it via Ring 1 bridges — the work isn't stranded.)
5. **Watch trigger for FG-REG-4 (marketplace contracts):** first external party wanting to settle agent-work intents on-chain, or a credible competitor shipping agent-work settlement. Until then the off-chain-coordinated / on-chain-recorded shape (§2.3) is deliberately sufficient.

## 6. Roadmap deltas this document implies

- **FG-REG-10/11 (registry kit contracts+standards / SDK) enter as P1** — the strategic centerpiece per ADR-0038; FG-REG-1/3/6/8 bridges re-frame as external *reference consumers* of the kit.
- FG-REG-2 splits: signing half **P1 here**; publication half ⤴ external.
- SUB-1/SUB-2/AN-2 (FG-NAME-2/3) attach to this push (were unscheduled Mediums).
- NEW-SKILL-1/NEW-GEO-1/NEW-VC-1/NEW-FLF-1 graduate from audit backlog to feature-blocking items.
- FG-DELEG-1 + FG-SEC-9 move ahead of all registry work in execution order (§4.1).
- FG-SDK-1 flagged for promotion into the push (item 3 of §5).
