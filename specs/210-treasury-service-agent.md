# Spec 210 — Treasury as a Service Agent

**Status:** draft · 2026-05-21
**Goal:** define **Treasury** as the canonical example of a **Service Agent** — a PROV-O-derived class of `prov:Agent` that has agency, acts on behalf of an Organization (which is also an Agent), and composes from agenticprimitives' existing primitives (AgentAccount, ThresholdValidator, caveat enforcers, audit trail).
**Builds on:** spec 207 (threshold-policy product surface), spec 208 (argument-level caveats — required dependency), spec 209 (ERC-7579 module taxonomy).
**Reference: smart-agent patterns to port:** `/home/barb/smart-agent/docs/ontology/tbox/{core,identity,governance}.ttl` already root agent classes in `prov:SoftwareAgent`. We extend that pattern with an explicit `ap:ServiceAgent` class that pins the "has agency + acts on behalf of an Organization" semantics. smart-agent's `sa:Pool` and `sa:Fund` (under `sa:OrganizationAgent`) are organization-shaped containers; Treasury is the **service-shaped** counterpart.
**Reference: external patterns to port:** W3C PROV-O ([https://www.w3.org/TR/prov-o/](https://www.w3.org/TR/prov-o/)) — the provenance ontology providing the formal agent class hierarchy + agency/attribution/association vocabulary.

> **Doctrine: Treasury is not "a kind of account" — it's a kind of Agent.** Every action a Treasury takes (proposing a payment, executing it, holding funds, scheduling a future disbursement) is an `prov:Activity` performed by a Service Agent, attributable in a PROV-O-conformant audit trail. Treasury inherits everything `ap:ServiceAgent` defines about agency; the on-chain `AgentAccount` is its embodiment, not its identity. This framing generalizes — future Service Agents (TradingAgent, ResearchAgent, ComplianceAgent) follow the same shape.

---

## 1. Goal

Two outcomes for this spec:

1. **Pin the agent taxonomy.** Define `ap:ServiceAgent` as a first-class PROV-O subclass of `prov:SoftwareAgent`. Document what makes a Service Agent distinct from a Person, Organization, or generic SoftwareAgent. Treasury is the canonical worked example; the taxonomy itself outlives Treasury.
2. **Define Treasury as that taxonomy's first concrete subclass.** Specify the agency surface, the required association with an Organization, the on-chain manifestation, the provenance attribution model, and the dependency list (what must ship before Treasury can be implemented).

No new package is shipped from this spec. Treasury is a *configuration + integration* of existing agenticprimitives primitives — `AgentAccount` in `org` mode + appropriate caveats + UI flows + the audit trail. The spec answers **"what makes a Treasury a Treasury"** at the ontology level, then **"how do you build one"** at the wiring level.

---

## 2. PROV-O agent hierarchy

W3C PROV-O defines three subclasses of `prov:Agent`:

```text
prov:Agent
├── prov:Person
├── prov:Organization
└── prov:SoftwareAgent
```

All three have **agency** — they can perform `prov:Activity`s, things can be `prov:wasAttributedTo` them, they can `prov:actedOnBehalfOf` other Agents (responsibility chain). The differentiation is *what kind of entity* the Agent is, not *what kind of action* it can take.

We extend this with `ap:ServiceAgent`:

```text
prov:Agent
├── prov:Person                                      (W3C)
├── prov:Organization                                (W3C)
└── prov:SoftwareAgent                               (W3C)
    └── ap:ServiceAgent                              (NEW — this spec)
        └── ap:Treasury                              (NEW — this spec)
        └── ap:TradingAgent   (future)
        └── ap:ResearchAgent  (future)
        └── ap:ComplianceAgent (future)
        └── ap:DeliveryAgent  (future)
```

Why `ap:ServiceAgent` and not `prov:SoftwareAgent` directly? Because the agency model differs:

| | `prov:Person` | `prov:Organization` | `prov:SoftwareAgent` (raw) | `ap:ServiceAgent` |
| --- | --- | --- | --- | --- |
| Has agency | yes | yes | yes | yes |
| Can hold assets on chain | via wallet | via multisig | rarely (often a script) | **yes** (AgentAccount) |
| Acts on behalf of | self | members | author | **Organization (required)** |
| Has bounded capabilities | implicit | via bylaws | implicit | **explicit caveats + policies** |
| Audit-attributable | yes | yes (collective) | maybe | **yes (every action emits a PROV-O record)** |
| Recovery model | personal | quorum | none | **org-mode T6 quorum + timelock** |
| Lifecycle owner | self | members | author | **Organization** |

`ap:ServiceAgent` is the class for autonomous on-chain services that have their own identity + assets + agency, but operate under the umbrella of an Organization that owns + scopes + can recover them. It's the formal name for "smart agent that does one job."

---

## 3. `ap:ServiceAgent` — required properties

For an instance to qualify as a Service Agent:

```turtle
ap:ServiceAgent
    a owl:Class ;
    rdfs:subClassOf prov:SoftwareAgent ;
    rdfs:label "Service Agent" ;
    rdfs:comment "An autonomous on-chain service with agency, scoped to an Organization, with bounded capabilities and a recovery path." .

# Required relations
ap:actedOnBehalfOf  rdfs:domain ap:ServiceAgent ; rdfs:range prov:Organization .
ap:hasCapability    rdfs:domain ap:ServiceAgent ; rdfs:range ap:Capability .
ap:hasPolicy        rdfs:domain ap:ServiceAgent ; rdfs:range ap:Policy .
ap:embodiedAs       rdfs:domain ap:ServiceAgent ; rdfs:range ap:AgentAccount .
ap:recoverableBy    rdfs:domain ap:ServiceAgent ; rdfs:range prov:Agent .  # guardian set
```

**MUST haves**:

- `prov:actedOnBehalfOf` exactly one `prov:Organization` (no "free-floating" Service Agents).
- `ap:embodiedAs` exactly one `ap:AgentAccount` (the on-chain proxy).
- `ap:hasCapability` ≥ 1 (a Service Agent with no capabilities is degenerate).
- `ap:hasPolicy` ≥ 1 (a Service Agent with no policy is unsafe — minimally has a spending-cap + recipient-allowlist policy if it handles value).
- `ap:recoverableBy` ≥ 1 guardian (`prov:Person` or `prov:Organization`). Without recovery, the Organization can lose the Service Agent → can't be a `ServiceAgent`.

**Inherits from `prov:SoftwareAgent`**:

- Can be `prov:wasAssociatedWith` an Activity.
- Can `prov:wasAttributedTo` an Entity it produces.
- Can be the subject of `prov:actedOnBehalfOf` (delegation chain into other agents).

---

## 4. `ap:Treasury` — the canonical Service Agent

```turtle
ap:Treasury
    a owl:Class ;
    rdfs:subClassOf ap:ServiceAgent ;
    rdfs:label "Treasury" ;
    rdfs:comment "A Service Agent that holds, custodies, and disburses assets (native + tokens) on behalf of its associated Organization." .
```

### 4.1 Capabilities

A Treasury's `ap:hasCapability` set:

| Capability | Verb | On-chain primitive | Phase |
| --- | --- | --- | --- |
| `ap:HoldAssets` | receive transfers, custody balances | `AgentAccount` native + ERC-20 + ERC-721 balances | ✅ shipped |
| `ap:ProposePayment` | submit a proposed disbursement | `ThresholdValidator.proposeAdmin` with custom AdminAction `DisbursePayment` (NEW) | needs validator extension |
| `ap:ExecutePayment` | execute a quorum-approved disbursement | `ThresholdValidator.executeAdmin` + `account.executeFromModule(target, value, data)` | ✅ shipped |
| `ap:SchedulePayment` | queue a payment for future execution | Delegation with `TimestampEnforcer(validAfter)` + `ArgumentRuleEnforcer` (target/amount pinned) | needs spec 208 |
| `ap:CapSpending` | enforce per-period spending budget | Caveat with `RateLimitEnforcer` (port pending) | needs phase 7 port |
| `ap:AllowlistRecipients` | restrict recipients to a known set | `ArgumentRuleEnforcer` with `IN` operator on the recipient arg | needs spec 208 |
| `ap:Recover` | atomic owner/passkey rotation by guardian quorum | `ThresholdValidator.RecoverAccount` T6 action | ✅ shipped |
| `ap:Audit` | every action emits a PROV-O / audit-trail record | spec 206 audit infrastructure | ✅ shipped |

### 4.2 Policies

A Treasury's `ap:hasPolicy` set composes from:

```turtle
ap:Policy
    a owl:Class ;
    rdfs:subClassOf prov:Plan .  # PROV-O's "plan an Activity follows"

ap:SpendingCapPolicy        rdfs:subClassOf ap:Policy .  # per-period max
ap:RecipientAllowlistPolicy rdfs:subClassOf ap:Policy .  # who can receive
ap:ApprovalQuorumPolicy     rdfs:subClassOf ap:Policy .  # M-of-N signers
ap:TimelockPolicy           rdfs:subClassOf ap:Policy .  # T4 / T5 / T6 windows
ap:RecoveryPolicy           rdfs:subClassOf ap:Policy .  # guardian quorum + 24h cancel + 48h timelock
```

These policies don't introduce new on-chain machinery — they map to **existing** spec 207 fields (`thresholdByTier`, `timelockByTier`, `guardians`, `recoveryThreshold`) and **planned** spec 208 caveats. A Treasury's policy set is its row in the validator's `Config` struct + the caveats baked into its delegation set.

### 4.3 Required associations

```turtle
:exampleTreasury
    a ap:Treasury ;
    prov:actedOnBehalfOf :exampleOrg ;
    ap:embodiedAs :exampleTreasuryAgentAccount ;        # AgentAccount in `org` mode
    ap:hasCapability ap:HoldAssets, ap:ProposePayment, ap:ExecutePayment,
                     ap:SchedulePayment, ap:CapSpending, ap:AllowlistRecipients,
                     ap:Recover, ap:Audit ;
    ap:hasPolicy :exampleSpendingCap, :exampleAllowlist, :exampleQuorum,
                 :exampleTimelock, :exampleRecovery ;
    ap:recoverableBy :guardian1, :guardian2, :guardian3 .

:exampleOrg
    a prov:Organization ;
    prov:hadMember :alice, :bob, :carol .
```

Note `:exampleOrg` is itself a `prov:Organization` — an Agent with its own agency. The on-chain mapping: the Organization's members are the owners of the Treasury's AgentAccount; the Treasury's recovery guardians are likely board-level (a wider group than the day-to-day signers).

---

## 5. Provenance attribution model

Every action a Treasury takes is a `prov:Activity` that emits a structured record. This is the agency-traceability story — at any moment we can answer "what did the Treasury do, on whose behalf, by what authority, to what effect."

### 5.1 Example: a quorum-approved payment

A Treasury sends 50 USDC to a payroll vendor. Activity graph:

```text
[:proposeActivity]                          [:executeActivity]
    a prov:Activity                              a prov:Activity
    prov:wasAssociatedWith :exampleTreasury      prov:wasAssociatedWith :exampleTreasury
    prov:wasAssociatedWith :alice                prov:wasAssociatedWith :bob, :carol
    prov:atTime "2026-05-21T12:00:00Z"           prov:atTime "2026-05-21T13:00:00Z"
    prov:used :proposalArgs                      prov:used :proposalArgs
    prov:generated :pendingProposal              prov:generated :paymentReceipt
        |                                            |
        |  authority delegation                      |
        v                                            v
:exampleTreasury prov:actedOnBehalfOf :exampleOrg

[:paymentReceipt]
    a prov:Entity
    prov:wasAttributedTo :exampleTreasury  # the Treasury is responsible
    prov:wasGeneratedBy :executeActivity
    : value 50_000000 USDC
    : recipient :payrollVendor
    : txHash 0x…
```

This graph is what the **audit / forensics trail** capability (spec 206) emits. Today's audit events `delegation.mint`, `validator.proposeAdmin`, `validator.executeAdmin`, `mcp-runtime.with-delegation.accept` map onto these `prov:Activity` records. Spec 210's contribution is the framing — they were already there; now we know what they MEAN provenance-wise.

### 5.2 Three things this gives us for free

- **Accountability questions are now answerable as queries.** "All payments authorized by Alice in March" = SPARQL over the audit graph filtered on `prov:wasAssociatedWith :alice`. "All Treasury activities on behalf of the marketing team's sub-org" = same filter, different agent.
- **Recovery is a provenance event.** When guardians execute `T6 RecoverAccount`, the activity has `prov:wasAssociatedWith` the guardians + `prov:wasInfluencedBy` the lost-signer event. Recovery audit story is structurally identical to payment audit story — both are Activities by an Agent.
- **Cross-Service-Agent composition gets a model.** When a future TradingAgent calls into the Treasury for a settlement, that's `:tradingAgent prov:actedOnBehalfOf :exampleOrg` + activity associating BOTH agents. The PROV-O hierarchy is what lets two ServiceAgents reason about each other consistently.

---

## 6. Implementation mapping

A Treasury is built by **wiring existing primitives**, not by adding a new package or new contracts (beyond what specs 207/208 already plan).

### 6.1 Account configuration

```ts
const treasuryParams: AgentAccountInitParams = {
  mode: 3,                                              // org mode (≥ 3 guardians, SoD)
  owners: [alice, bob, carol],                          // org members
  guardians: [boardMember1, boardMember2, boardMember3], // separate authority for recovery
  initialPasskeyCredentialIdDigest: bytes32(0),
  initialPasskeyX: 0n,
  initialPasskeyY: 0n,
};

const treasuryAccount = await factory.createAccountWithModeCustomT4(
  treasuryParams,
  thresholdValidatorAddress,
  3600 * 6,           // T4 timelock 6h — typical treasury cadence
  randomSalt,
);
```

This is mechanically the same as creating any other org-mode account; what makes it a Treasury is the additional caveat set + policy posture (next section).

### 6.2 Standing payment delegations (spec 208 dependent)

A Treasury issues delegations to itself (or to a delegated `ap:DisbursingAgent` sub-service) that pre-authorize the payment SHAPES it can make. Each shape is one delegation:

```ts
// "Treasury can transfer USDC to {payroll,vendor1,vendor2}, ≤ 5000 USDC per call,
//  ≤ 50000 USDC per month, max 100 calls total"
const payrollPaymentDelegation = await delegationClient.issue({
  delegator: treasuryAccount.address,
  delegate:  treasuryAccount.address,                  // self-delegated (Treasury executes)
  caveats: [
    buildArgumentRuleCaveat([
      ruleErc20Transfer({
        token: USDC,
        recipients: [payroll, vendor1, vendor2],
        maxAmount: 5_000_000000n,                       // 5000 USDC per call
        maxUses: 100n,
      }),
    ]),
    buildRateLimitCaveat({                              // pending RateLimit port
      window: 30 * 86400n,
      maxValue: 50_000_000000n,                         // 50k USDC per month cumulative
    }),
    buildTimestampCaveat({
      validAfter: now,
      validUntil: now + 365 * 86400,                    // 1-year window
    }),
  ],
  signer: orgQuorumSigner,                              // signed by the Organization (M-of-N)
});
```

Three caveats compose into the Treasury's "I can spend USDC like this" policy. The Treasury (as ServiceAgent) doesn't need to ask the Organization each time — the Organization's M-of-N signature ON THE DELEGATION is the authority. Each subsequent execution is `prov:wasAttributedTo :treasury` but `prov:actedOnBehalfOf :org` via the signature on the delegation.

### 6.3 One-off payments (no standing delegation)

For payments outside the pre-approved shape, the Treasury goes through `ThresholdValidator.proposeAdmin` (org-mode quorum + T4 timelock + SoD). That's the existing admin-actions flow — Treasury reuses spec 207's machinery without change.

### 6.4 What's missing for v0

- `ArgumentRuleEnforcer` (spec 208) — required for typed recipient + amount checks. v0 Treasury demo can do without (using only `AllowedTargetsEnforcer` + `ValueEnforcer`) but loses precision.
- `RateLimitEnforcer` (port from smart-agent — phase 7) — required for per-period budgets. v0 Treasury can ship without; ad-hoc "I've spent N this month" tracking happens off-chain.
- A new validator AdminAction `DisbursePayment(token, recipient, amount)` — needed only if Treasury wants payments to go through the propose/execute admin path. Optional; the delegation-issuance path (§ 6.2) is more flexible.
- UI flows in `demo-web-pro` (see § 8 phase plan).

---

## 7. Capability matrix — what differs between Agent types

This is the framing that motivates `ap:ServiceAgent`. Same actions, different agents:

| Action | Person | Organization | Treasury (ServiceAgent) |
| --- | --- | --- | --- |
| **Sign a message** | personal wallet | M-of-N quorum | ERC-1271 via own owners (M-of-N) |
| **Hold ETH** | personal wallet | safe-style multisig | own AgentAccount in org mode |
| **Authorize a payment** | personal sig | M-of-N quorum, possibly with timelock | own quorum (= Org's quorum); plus optional standing delegations the Org pre-approved |
| **Be recovered** | seed phrase (off-chain) | reconstitute quorum via legal process | guardian quorum + 48h timelock (T6) — on-chain |
| **Attribute provenance** | direct sig | aggregated multisig | every action prov:wasAttributedTo the Treasury, but prov:actedOnBehalfOf the Org |
| **Be replaced** | not applicable (you're you) | replace via byvotes | Org replaces by upgrading the AgentAccount impl (T5) OR recovering via T6 |

The fourth column is what's interesting: a Service Agent has **a public identity (the AgentAccount address) and a clear agency surface**, but its authority is always derivable back to the Organization that owns it. This is what makes it AUDITABLE in a way that a bare smart-account wallet (without the Service Agent framing) isn't.

---

## 8. Phase plan

| Phase | What lands | Status |
| --- | --- | --- |
| **6e.0** (ontology) | Land this spec; add `ap:` namespace classes to a new `docs/ontology/ap-service-agent.ttl` mirroring smart-agent's tbox shape | this spec |
| 6e.1 (caveat prerequisites) | Spec 208's `ArgumentRuleEnforcer` shipped; RateLimitEnforcer ported from smart-agent | blocked on 6c.6 + phase 7 |
| 6e.2 (SDK helpers) | `@agenticprimitives/delegation` exports `buildTreasuryPaymentDelegation(opts)` — typed sugar over the 3-caveat composition; consumes the enforcer registry | needs 6e.1 |
| 6e.3 (audit attribution) | spec 206 audit events gain optional `prov:Activity` fields (agent URI, activity URI, actedOnBehalfOf URI). Backwards-compatible — old audit events still parse | small; can land any time |
| 6e.4 (demo-web-pro flows) | Four new flows under `apps/demo-web-pro/src/flows/treasury/`: CreateTreasuryFlow, ProposePaymentFlow, ApprovePaymentFlow, ViewLedgerFlow + paired walkthroughs in `apps/demo-web-pro/docs/treasury/` | depends on 6e.2 |
| 6e.5 (cross-cutting capability) | Add "Treasury as Service Agent" row to `docs/architecture/cross-cutting-capabilities.md` once 6e.4 ships | docs |
| 7+ (future Service Agents) | TradingAgent, ResearchAgent, ComplianceAgent — each gets its own spec extending `ap:ServiceAgent` and reusing the Treasury blueprint | post-Treasury |

No new package. No new core contracts (the validator + factory + AgentAccount are sufficient). The cost is concentrated in the SDK + UI layer.

---

## 9. What this spec is NOT defining

- A new on-chain Treasury contract. The Treasury is an `AgentAccount`, period.
- A new package (`@agenticprimitives/treasury`). The functionality threads through `delegation` (caveats) + the UI app. If we were to extract anything as a package, it'd be a `ServiceAgent` runtime helper — but that's premature; ship Treasury as a UI + audit + caveat composition first, see if abstraction pressure emerges.
- A multi-currency treasury. v0 = one ERC-20 (USDC). Multi-currency is the SAME mechanism with more delegations.
- DAO governance integration. Treasury is the asset side; governance (proposals, votes, quorum semantics for the Organization) is a separate Organization-shape concern. We adopt PROV-O so the future governance work has consistent agent vocabulary.

---

## 10. Open questions

- **Naming.** `ap:ServiceAgent` vs `ap:SmartAgent` — the user-facing term ("Smart Agent" is shorter, marketable) vs the ontology term ("ServiceAgent" is more precise). Spec uses the ontology term + glossary points "SmartAgent" → `ap:ServiceAgent`.
- **Sub-service composition.** Can a Treasury have a `DisbursingAgent` sub-service that handles routine payouts? Likely yes — that's nested `prov:actedOnBehalfOf`. Out of scope for v0 (no demo case yet).
- **Cross-Org Service Agents.** Can a single Treasury serve multiple Organizations? PROV-O permits `prov:actedOnBehalfOf` multiple Agents. Not modeled in v0; v0 = exactly one Org per Treasury.
- **Treasury as Entity vs Agent.** A subtle ontology question: when funds are IN the Treasury, the Treasury is acting as a custodian (Agent). When the Treasury's balance changes, is the balance change an Entity that wasAttributedTo the Treasury? Yes — and the audit trail should record this. The smart-agent ontology models balance changes as Entities; we follow that pattern.
- **SoftwareAgent vs ServiceAgent distinction.** Why not just use `prov:SoftwareAgent` for Treasury? Because `prov:SoftwareAgent` is too broad — covers helper scripts, batch jobs, anything with no human in the loop. `ap:ServiceAgent` carries additional contracts: must have an Organization, must have policies, must be recoverable. Worth being a named subclass.

---

## 11. Resolved decisions

- Treasury is **a Service Agent**, not a kind of account. Account is the embodiment.
- `ap:ServiceAgent` is a PROV-O subclass of `prov:SoftwareAgent` (not a sibling of Person/Org). Inheriting from SoftwareAgent gives us PROV-O's existing semantics for free.
- A Service Agent **MUST** have a parent Organization. No free-floating ServiceAgents.
- A Service Agent **MUST** have an explicit capability set + policy set + recovery path. These are the affordances that make agency safe.
- No new package, no new contracts. v0 Treasury is a configuration + UI exercise, with dependencies on specs 207 (shipped) + 208 (in flight) + RateLimitEnforcer port (queued).
- Provenance attribution piggybacks on the existing spec 206 audit trail with optional PROV-O field extensions (backwards-compatible).
- The ontology lives at `docs/ontology/ap-service-agent.ttl` (mirroring smart-agent's tbox pattern); is consumed by future SPARQL queries over the audit trail.

---

## 12. Cross-references

- [`specs/207-smart-account-threshold-policy.md`](./207-smart-account-threshold-policy.md) § 4 (org mode) + § 8 (recovery semantics) — Treasury IS an org-mode AgentAccount + appropriate guardian set.
- [`specs/208-argument-level-caveats.md`](./208-argument-level-caveats.md) — `ArgumentRuleEnforcer` is the primary spec 210 dependency.
- [`specs/209-erc7579-module-taxonomy.md`](./209-erc7579-module-taxonomy.md) — Treasury reuses the existing modular core; no new modules.
- [`specs/206-audit.md`](./206-audit.md) — the audit trail that becomes the PROV-O activity log when extended per § 5 + § 8 / 6e.3.
- [`docs/architecture/dtk-alignment-audit.md`](../docs/architecture/dtk-alignment-audit.md) — caveat parity that informs which enforcers Treasury can use today.
- [`docs/architecture/enforcer-registry/`](../docs/architecture/enforcer-registry/) — Treasury's standing delegations consume entries from the registry; SDK helpers walk it.
- Memories:
  - [[multi-sig is integrated, not bolted-on]] — Treasury is built on, not bolted onto, the multi-sig substrate.
  - [[hybrid-is-default-consumer-mode]] — Treasury is the canonical `org`-mode account (NOT hybrid).
  - [[ERC-7579 module architecture]] — no new modules needed; Treasury composes from existing ones.
  - [[multisig-is-safety-and-recovery]] — Treasury's policy posture IS the safety + recovery doctrine.
  - [[mirror smart-agent patterns]] — `prov:SoftwareAgent` rooting follows smart-agent's tbox convention.

---

## 13. Why this matters architecturally

The user's framing — *Treasury is a Service Agent that exemplifies our agent architecture* — is load-bearing. It means agenticprimitives is fundamentally **a substrate for accountable autonomous agents in the PROV-O sense**, not just a smart-account toolkit. Concrete consequences:

- Every new capability the repo ships should be evaluated through "does this enable Service Agents to do their job better, with provenance traceability?" If yes, ship. If it doesn't fit the agent model, the abstraction is probably wrong.
- The vocabulary in the codebase + docs should align with PROV-O: `Agent`, `Activity`, `Entity`, `actedOnBehalfOf`, `wasAttributedTo`, `wasAssociatedWith`. We already use "agent" everywhere; we should be more disciplined about meaning the PROV-O sense.
- Future Service Agent types (`ap:TradingAgent`, `ap:ResearchAgent`, etc.) reuse Treasury's blueprint. Each one is a spec that says: "this Service Agent has THESE capabilities, THESE policies, THIS recovery path." The runtime stays unchanged.
- Audit + governance + delegation + recovery are all **provenance-shaped concerns**. The PROV-O lens reveals that the right primitives are Agents (already have), Activities (covered by audit), Entities (caveats + delegations + tokens), and the relations between them (delegation chains + attribution).

Treasury is the proof. Spec 210 is the framing.
