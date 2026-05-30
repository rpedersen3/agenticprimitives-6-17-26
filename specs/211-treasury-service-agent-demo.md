# Spec 211 — Treasury Service Agent demo (apps/demo-web-pro reshape)

**Status:** draft v2 · 2026-05-21 (revised after architectural decisions locked in)
**Replaces:** the capability-gallery shape of `apps/demo-web-pro` (phase 6c.5-e). The directory + package name stay; the content transforms.
**Builds on:** spec 207 (custody policy), spec 209 (modular core), spec 210 (Treasury as Service Agent — ontology + agency model), **spec 212 (agent-centric delegation — the load-bearing architectural principle)**, spec 213 (custody-layer carve-out — vocabulary firewall that drives the identifier shapes in code samples below).

## Locked-in architectural decisions (2026-05-21 planning round)

The questions spec 211 v1 left open are now decided. They reshape the demo significantly — particularly the Organization gets first-class on-chain identity:

| Question | Decision |
| --- | --- |
| Is the Org an on-chain Smart Agent? | **Yes.** Acme Construction is a first-class on-chain `prov:Organization` with its own AgentAccount + `org-a2a` server + `org-mcp` exposing all org-management surfaces. |
| Person a2a/mcp multi-tenancy | **Multi-tenant.** One `person-a2a` server hosts Person #1 + Person #2 + N; same for `person-mcp`. Tenant-scoped by Smart Agent address. |
| Org MCP tool surface | **All things about the org.** `list_members`, `get_treasury_address`, `propose_membership_change`, `propose_service_agent_change`, `get_org_metadata`, `list_service_agents`, audit-trail views, governance state. |
| Treasury MCP tool surface | **All things + behavior associated with Treasury.** `get_balances`, `list_pending_actions`, `propose_payment`, `approve_pending`, `execute_approved`, `view_audit_trail`, recovery surface, configuration views. |
| User authority modeling | **MINIMAL.** Connected user controls EXACTLY their Person Smart Agent via passkey. No EOA dependency. ALL stewardship — Person↔Org, Person↔Treasury, Org↔Treasury — is delegation between Smart Agents. Per spec 212. |
| Onboarding mechanic | Predetermined seats — see § 4a below. |

These decisions cascade into reshaping the act ladder + add scope. See § 4-onward.
**Reference: smart-agent patterns to port:**
- `/home/barb/smart-agent/apps/a2a-agent/` — per-agent-class a2a server pattern, session lifecycle, delegation issuance + redemption surface.
- `/home/barb/smart-agent/apps/person-mcp/` — MCP server scoped to person resources, delegation-token authentication.
- `/home/barb/smart-agent/apps/web/` — passkey-based auth UX, principal-context chip ("Working as Alice"), consent card before delegation signing.

> **Doctrine: one product question, one story.** The app answers exactly one user question: *"How do two people, each with a passkey-controlled smart account and associated person agent, jointly control a treasury service-agent account?"* Nothing else. No capability gallery. No future-capability cards. No "see how to use validator X." The user follows a six-act story end-to-end + the demo's value is the story.

---

## 1. Goal

Demonstrate the agenticprimitives stack as a substrate for accountable, multi-actor autonomous agents (per spec 210), using Treasury as the worked example. Pass the implementation stress-test: every shared package gets exercised in a realistic multi-user + multi-agent-class scenario. Surface package gaps as work items, not workarounds.

Non-goals:
- A capability showcase (gallery is dead — see [[demo-web-treasury-flagship]] memory).
- Production-grade UX for a real treasury product (this is a demo + reference impl).
- Multi-org demos (one Organization per demo session).
- Multi-currency in v0 (one ERC-20 — USDC on Base Sepolia — is enough).

---

## 2. Vocabulary discipline

Every UI string + every code identifier honors the table below. Implementation primitives (`CustodyPolicy`, `scheduleCustodyChange`, `caveat`, `delegation token`, `userOp`) are forbidden in user-facing copy.

| Concept | UI label | Identifier convention | Tech mapping |
| --- | --- | --- | --- |
| Shared funds container, has agency | **Treasury service agent** | `treasury`, `TreasuryServiceAgent` | AgentAccount in org mode + CustodyPolicy |
| Company organization | **Acme Construction (organization)** | `org`, `OrgSmartAgent`, `acmeConstruction` | AgentAccount in org mode + CustodyPolicy |
| Per-user on-chain identity | **Person smart agent** | `personSmartAgent`, `PersonSmartAgent` | AgentAccount in hybrid mode, passkey-owned |
| Per-user delegated agent identity | **Person agent** | `personAgent`, `PersonAgent` | Session-bound identity (smart-agent's a2a pattern) |
| CustodyPolicy module | **Account safety policy** | `accountSafetyPolicy` | (do not surface module/validator) |
| Pending admin action | **Scheduled admin change** | `scheduledChange` | (do not surface "proposal") |
| M-of-N threshold | **Approvals required** | `approvalsRequired` | |
| **Admin** authority (m-of-n on Smart Agent itself) | **Admin** ("admin change", "admin action") | `admin*`, `adminAction*` | CustodyPolicy.scheduleCustodyChange/applyCustodyChange; per spec 212 § 2.2 |
| **Stewardship** authority (agent-to-agent delegation, no fresh m-of-n) | **Permission**, **authority grant**, **treasury permission card** | `steward*`, `stewardship*`, `permissionGrant*` | Delegation tokens; caveats; per spec 212 § 2.2 |

---

## 3. Four-Agent architecture (revised after 2026-05-21 decisions)

> **Per spec 212**: the user is NOT in this graph. The user controls their Person Smart Agent via passkey. All authority below is agent-to-agent.

```
                          ┌──────────────────────────┐
                          │  Acme Construction       │  prov:Organization
                          │  (on-chain AgentAccount) │
                          │  org-a2a + org-mcp       │
                          └────────┬───────┬─────────┘
                                   │       │
                       prov:hadMember│       │acts via (member delegations)
                                   │       │
              ┌────────────────────┴───┐ ┌─┴──────────────────────┐
              ▼                        ▼ ▼                          ▼
   ┌──────────────────┐                                  ┌──────────────────┐
   │ Person #1        │                                  │ Person #2        │
   │ (Alice)          │                                  │ (Bob)            │
   │ on-chain AA      │                                  │ on-chain AA      │
   │ person-a2a       │                                  │ person-a2a       │
   │ person-mcp       │                                  │ person-mcp       │
   │ (multi-tenant)   │                                  │ (multi-tenant)   │
   └────────┬─────────┘                                  └────────┬─────────┘
            │                                                       │
            │ passkey controls (NOT delegates)                      │ passkey controls
            │                                                       │
            ▼                                                       ▼
        🔑 Alice's                                              🔑 Bob's
         passkey                                                 passkey

                          ┌──────────────────────────┐
                          │  Acme Treasury           │  ap:ServiceAgent →
                          │  (on-chain AgentAccount) │  ap:Treasury
                          │  treasury-a2a            │  prov:actedOnBehalfOf
                          │  treasury-mcp            │      Acme Construction
                          │  ap:hasSteward Alice,Bob │
                          └──────────────────────────┘
```

Authority flow examples:
- **Alice's Person Agent → Org Agent → Treasury Agent**: nested delegation chain when Alice authorizes a Treasury action that needs Org-level approval.
- **Alice's Person Agent → Treasury Agent (direct)**: when Alice's standing delegation from the Treasury permits direct draft-payment authority within caveats.
- **Org Agent → Treasury Agent**: the foundational delegation that makes Treasury act on behalf of the Org (issued at Treasury creation; renewed as policy evolves).

## 3a. Three-entity USER model (the user-facing picture)

```text
USER (Alice or Bob — human)
  └── authenticates via passkey
       │
       └── controls
            │
            ▼
       PERSON SMART ACCOUNT
       (Alice's or Bob's AgentAccount; on-chain; the human's direct identity)
            │
            └── delegates session authority to
                 │
                 ▼
            PERSON AGENT
            (off-chain a2a-server-side identity holding delegations
             from the person smart account; mediates calls to + from
             the Treasury service agent)
```

Two of these towers (Alice's + Bob's) jointly control:

```text
TREASURY SERVICE AGENT
  └── prov:actedOnBehalfOf  the Organization {Alice, Bob}
  └── owners: Alice's person smart account, Bob's person smart account
  └── account safety policy: 2-of-2 for admin changes, T4 timelock
  └── recoverableBy: guardian set (out of scope for v0; placeholder)
```

The user is technically a direct owner of the treasury, but the **demo enforces all treasury authority through the person-agent → treasury-service-agent delegation chain**. This is the audit story; direct calls bypass the provenance graph.

---

## 4. Onboarding mechanic (NEW — predetermined seats)

App boot loads the predefined organization config (env-driven for re-branding):

```
ORG_NAME=Acme Construction
ORG_ADMIN_SEATS=2
ORG_SEAT_LABELS=Alice,Bob
```

First screen — seat picker:

```
┌──────────────────────────────────────────────┐
│  Acme Construction                            │
│  Shared treasury demo · two-admin org         │
│                                                │
│  Pick a seat to begin.                         │
│                                                │
│  ┌─────────────┐  ┌─────────────┐             │
│  │   Alice     │  │    Bob      │             │
│  │  (open)     │  │  (open)     │             │
│  └─────────────┘  └─────────────┘             │
│                                                │
│  Both seats need admins for the treasury to    │
│  activate.                                     │
└──────────────────────────────────────────────┘
```

Visitor picks "Alice" → passkey ceremony → Person Smart Agent deployed for Alice → Alice's seat is "claimed."

Visitor returns (same browser, new tab, or same tab after a refresh) → seat picker shows "Alice ✓ claimed" + "Bob open" → picks Bob → same flow.

After both seats filled, the role switcher appears in the top bar:

```
[Acting as: Alice ▼] · Acme Construction · Acme Treasury status: ready to set up
```

The switcher lets the visitor play Alice + Bob in turn. Honest about being a demo cheat (the right panel explainer says so).

The seat-picker disappears after both seats claimed (the demo state is now "two-person org in operation").

## 5. Act ladder (revised for four-agent architecture)

Linear progression with the onboarding loop above as a prerequisite. Acts 2 + 3 are MORE INVOLVED than spec v1 because the Org has its own on-chain identity now.

**Modality legend** (per spec 212 § 2.2):
- **[Admin]** — requires m-of-n approval from a Smart Agent's owner quorum (passkey ceremony per signing owner)
- **[Stewardship]** — uses pre-issued delegation; single signer (delegate's session key); no fresh m-of-n
- **[Bootstrap]** — onboarding-time deploy; not yet under m-of-n control (the Smart Agent has just been created)

Every act below is labeled. The "wow moment" that EXERCISES stewardship is currently missing from this ladder — see § 10 for the proposed Act 7 (real payment via stewardship delegation).

### Act 1 — Create Alice Person Smart Agent **[Bootstrap]**
- WebAuthn registration → store Alice's credentialId + (x, y) locally.
- Counterfactual address preview from `factory.getAddressForPasskey`.
- Deploy via `factory.createAccountWithPasskey` (gasless via existing paymaster).
- Display Alice's person smart account address + a generated `.agent`-style label.
- Live status: 🟢 LIVE on Base Sepolia.

### Act 2 — Create Acme Construction (Org Smart Agent) **[Bootstrap]**
- Alice (now the founder via Act 1) creates the Org on-chain.
- `factory.createAccountWithModeCustomSafetyDelay` with `mode=org`, owner = Alice's Person Smart Agent.
- The Org's AgentAccount becomes "Acme Construction" on-chain. Alice is its sole member initially.
- This is BEFORE Treasury creation — the Org owns the Treasury (per Option β architecture).
- "Account safety policy" surfaces: 1 approval required (sole-member org). Will become 2 in Act 4.
- The Org's a2a + MCP servers come up tenant-scoped to this Org address.
- Live status: 🟢 LIVE.

### Act 2.5 — Create Acme Treasury (Service Smart Agent) **[Admin]**
(The Org issues the deploy + initial Treasury setup via an Admin action — Org has only 1 owner at this point, so "approvals required" = 1; still admin-shaped, not bootstrap-shaped, because it's the Org Smart Agent acting.)
- Treasury is created with the ORG (not Alice directly) as its owner.
- `factory.createAccountWithModeCustomSafetyDelay`, owner = Acme Construction's AgentAccount address.
- Treasury's `ap:hasSteward` set is empty initially (admins are added in Act 4); Org is the sole authority.
- Treasury a2a + treasury-mcp servers come up scoped to this Treasury address.
- Org issues its FIRST delegation: "Acme Construction authorizes Acme Treasury to hold + custody assets on its behalf" — establishes the `prov:actedOnBehalfOf` relationship on chain.
- Live status: 🟢 LIVE for account + module deploy; 🟡 SIMULATED for the Org→Treasury initial delegation enforcement (delegation OBJECT exists; redemption path lights up in phase 6f.7).

### Act 3 — Bob joins as Org member **[Admin]**
- Visitor takes Bob's seat (passkey ceremony, deploy Bob's Person Smart Agent).
- Alice (acting as Org's sole admin) proposes `AddMember(Bob's Person Smart Agent)` as an Org T4 admin action.
- T4 timelock elapses (configurable via the same dropdown from Act 2).
- Alice executes the change. Org now has 2 members.
- UI labels: "Schedule new member" / "Safety delay" / "Apply approved change."
- Detect same-credential collision; mark as 🟡 SIMULATED if Bob's passkey isn't distinct.
- Live status: 🟢 LIVE.

### Act 4 — Set 2-Person Org Control (and thus Treasury) **[Admin × 2]**
- Org's "approvals required" goes from 1 to 2.
- Two T4 admin actions executed in sequence:
  1. `AddSteward(Bob's Person Smart Agent)` on the Treasury — Bob joins the steward set
  2. `ChangeApprovalsRequired(2)` on the Org — admin changes now require both Alice + Bob
- Both run through the existing AdminActionsFlow machinery, folded into a scripted two-step act.
- After execution: any future Org admin change OR Treasury action (per Org's policy) requires both Alice + Bob.
- Live status: 🟢 LIVE for both AddSteward and ChangeApprovalsRequired. The downstream "now 2-of-2 enforcement actually applies" 🟡 IN-FLIGHT until packed multi-sig signature collection is hardened (phase 6f.7).

### Act 5 — Delegate Treasury Management to Person Agents **[Admin → creates Stewardship]**
(Issuing the delegations is an Admin action — needs Org's 2-of-2 quorum to sign each delegation. The OUTPUT is stewardship grants the Person Agents will USE in Act 7+ without further m-of-n.)
- Treasury (signed by Org's 2-of-2 quorum, since Acme Construction owns Treasury) issues two delegations:
  - **Alice's Person Agent**: standing draft-payment + read-balance authority, limited by recipient allowlist + amount cap + 90-day expiry
  - **Bob's Person Agent**: same shape, separately issued
- These are agent-to-agent delegations per spec 212. The user's passkey never appears in the delegation hash. The delegations are SIGNED by the Org Smart Agent (which is in turn controlled by its 2-of-2 admin set, which is in turn controlled by Alice's + Bob's Person Smart Agents, which are in turn controlled by their passkeys — but the chain of agent identities is what matters for authority).
- Permission cards rendered from the registry (phase 6b.1 enforcer registry).
- Limits in plain language: token, recipient allowlist, max per call, max cumulative, expiry, revocation path.
- "What this delegation does NOT permit": add owners, change policy, bypass approvals, drain arbitrary assets.
- Live status: 🟡 SIMULATED for runtime enforcement. The delegation OBJECTS are built live + signed + hashed by the Org Smart Agent; the ENFORCEMENT story is paragraph copy with a clear "this enforcement lights up in phase 6f.7" badge.

### Act 6 — Acme Construction Control Dashboard **[read-only]**
- Persistent dashboard for the rest of the demo.
- Top of dashboard: **Acme Construction** (the Org) is the focal entity. Treasury + Persons are arrayed as relationships.
- Panels:
  - **Acme Construction**: org address, members, approvals required, list of service agents (just Treasury today, but the shape supports more)
  - **Acme Treasury (Service Smart Agent)**: address, stewards (Alice + Bob via Org), prov:actedOnBehalfOf Acme Construction, balances, approvals required
  - **Person Smart Agents**: Alice + Bob — passkey-controlled, Org members
  - **Person Agents**: per-person card showing the active delegation from Treasury
  - **Pending scheduled admin changes** (Org-level + Treasury-level)
  - **Active treasury permissions** (the standing delegations from Act 5)
  - **Audit trail (PROV-O)**: every Activity tagged with Agent URIs — `wasAssociatedWith :alicePersonAgent · actedOnBehalfOf :acmeConstruction`. No user URIs anywhere (per spec 212).
- Live status: 🟢 LIVE for reads (all read from chain + the org/treasury MCPs).

---

## 5. Persistent UI shell

Four regions, fixed across all acts:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ TOP BAR · Alice 🟢 · Bob 🟢 · Treasury 🟢 · Chain: Base Sepolia ·   │
│           Status: LIVE / SIMULATED tag for current act               │
├─────────────────────────────────────────────────────────────────────┤
│        │                                              │              │
│  LEFT  │  MAIN PANEL                                  │   RIGHT      │
│  PROG  │  (one task at a time, plain-language copy)   │   EXPLAIN    │
│  RAIL  │                                              │              │
│  ────  │                                              │   What is    │
│ ✓ 1    │                                              │   happening  │
│ ✓ 2    │                                              │   on chain?  │
│ ▶ 3    │                                              │              │
│   4    │                                              │   What is    │
│   5    │                                              │   simulated? │
│   6    │                                              │              │
│        │                                              │              │
├─────────────────────────────────────────────────────────────────────┤
│ BOTTOM AUDIT STRIP · recent tx · sig · scheduled change · deleg     │
└─────────────────────────────────────────────────────────────────────┘
```

The RIGHT explainer is critical for honesty: every act surfaces an explicit "this part is live" / "this part is simulated" badge with a one-sentence reason.

---

## 6. New components (additions to `src/components.tsx`)

Keep all existing: `AppShell`, `RiskBadge` (rename to `ApprovalBadge`?), `StatusBadge`, `AddressChipInput`, `ModePill`, `shortAddress`, `PermissionCard`, etc.

Add:

| Component | Purpose |
| --- | --- |
| `ActorCard` | Renders a person (Alice / Bob) — passkey status, person smart account address, person agent label, connected/simulated badge |
| `TreasuryMap` | Visual graph: treasury at center, person smart accounts as owners, person agents as delegated peripheries, audit-trail arrows |
| `PermissionSummary` | Decoded delegation card — "Alice's person agent can do X, Y, Z; cannot do A, B, C; limits: …" |
| `LiveStatusBadge` | Green / yellow / red dot + tooltip explaining the live-or-simulated state of the current act |
| `AuditStrip` | Horizontal scroll of recent activities — tx hash, signer, action label, time, expandable to PROV-O record |
| `ProgressRail` | Left-side act tracker (current / completed / blocked) |
| `PrincipalChip` | Top-bar "Working as Alice" indicator with switcher for Bob (mirrors smart-agent's pattern) |

---

## 7. Phased rollout

| Phase | Deliverable | Live boundary |
| --- | --- | --- |
| **6f.1 — Shell + Onboarding + Act 1** | Strip current App.tsx gallery. Build the persistent shell (top/left/main/right/bottom). Implement the seat picker. Implement Act 1 (passkey ceremony + Alice's Person Smart Agent deploy). New components: `SeatPicker`, `ActorCard`, `LiveStatusBadge`, `ProgressRail`, `PrincipalChip`. | 🟢 LIVE for Alice deploy |
| **6f.2 — Acts 2 + 2.5 (Create Org + Treasury)** | Org AgentAccount (Acme Construction) deploy in org-mode; Treasury AgentAccount deploy with Org as owner; initial Org→Treasury delegation. **More scope than v1** because Org is now on-chain. | 🟢 LIVE for accounts/modules; 🟡 SIMULATED for Org→Treasury delegation enforcement (lights up in 6f.7) |
| **6f.3 — Act 3 (Bob joins Org)** | Bob's seat claim → Bob's Person Smart Agent deploy → Alice proposes AddMember(Bob) on the Org → execute. Multi-identity passkey isolation in `lib/passkey.ts`. | 🟢 LIVE w/ distinct passkey; 🟡 SIMULATED otherwise |
| **6f.4 — Act 4 (Set 2-Person Control)** | Treasury AddSteward(Bob) + Org ChangeApprovalsRequired(2). Two T4 admin actions, scripted into one act. | 🟢 LIVE for the admin actions themselves; 🟡 IN-FLIGHT for full 2-of-2 enforcement |
| **6f.5 — Act 5 (Delegate Treasury Management)** | Treasury issues delegations to Alice's + Bob's Person Agents via Org's 2-of-2 quorum. Permission cards rendered from enforcer registry. Construction LIVE; runtime enforcement SIMULATED. | 🟡 SIMULATED enforcement, LIVE object construction |
| **6f.6 — Act 6 (Org Control Dashboard)** | Stitch all reads into a persistent Org-focal dashboard. Audit trail tags activities with PROV-O Agent URIs. | 🟢 LIVE reads |
| **6f.7 — Per-agent-class server scaffolding** | Port `person-a2a` (multi-tenant) + `person-mcp` (multi-tenant) + `org-a2a` (single-tenant per Org) + `org-mcp` + `treasury-a2a` + `treasury-mcp` from smart-agent. Wire the demo to use them. New apps in `apps/demo-*-a2a` / `apps/demo-*-mcp`. | enables 🟡→🟢 transition |
| **6f.8 — Runtime delegation enforcement** | Acts 2.5 + 5 SIMULATED enforcement become LIVE: accepted-session blessing + session-package validation + treasury-a2a redeem path. The demo's biggest 🟡 flips to 🟢. | 🟢 LIVE; closes the demo's simulation gap |
| **6f.9 — PROV-O Activity emission** | Audit-trail events extended with optional PROV-O Activity URIs per spec 210 § 5. Dashboard Audit Strip renders the resulting graph. | 🟢 LIVE attribution |

---

## 8. Package gaps to survey + fill

The user's stated goal is to STRESS-TEST the agenticprimitives package architecture. After each phase, log:

- What surface from the packages was used?
- What did the demo need that wasn't there?
- What did we work around in the app instead of pushing back into a package?

Known gaps in advance (port from smart-agent or design fresh):

| Gap | Smart-agent equivalent | Phase blocking |
| --- | --- | --- |
| Multi-user passkey session lifecycle (Alice + Bob in one browser) | `smart-agent/apps/web/src/passkey-flow.ts` + session-isolation in localStorage | 6f.3 |
| A2A protocol client helpers for inter-agent calls | `smart-agent/apps/a2a-agent/src/routes/*` | 6f.6 |
| MCP server scaffolding for treasury-specific tools | `smart-agent/apps/person-mcp/` (pattern only — treasury tools are new) | 6f.6 |
| Permission-card rendering | None in smart-agent; depends on `enforcer-registry` (phase 6b.1 shipped) | 6f.4 |
| Org-level membership + role abstractions | Smart-agent has some — limited; needs design | 6f.6 |
| PROV-O Activity emission helpers | Smart-agent emits audit events; spec 210 § 5 documents PROV-O shape | 6f.5 |
| Treasury-shaped admin action (DisbursePayment) | None in smart-agent; spec 210 § 6 covers | post-6f |

Surfaces that should stay UNCHANGED across this work:
- `@agenticprimitives/agent-account` — Treasury IS an AgentAccount; no new methods needed.
- `packages/contracts/*` — no contract changes; existing factory + validator + enforcers are sufficient.
- `@agenticprimitives/connect-auth` — passkey ceremony already there.

---

## 9. Live/simulated honesty — non-negotiable

Every act surfaces a `LiveStatusBadge` with one of:

- 🟢 **LIVE** — chain write/read against deployed contracts on Base Sepolia.
- 🟡 **SIMULATED** — artifact constructed locally; not yet enforced on chain; explicit text saying so.
- 🔴 **NOT IMPLEMENTED** — placeholder for future work.

The demo MUST NOT lie about what it does. If a delegation is constructed but its runtime enforcement is paragraph copy + not on chain, the badge is yellow and the right-panel explainer says so.

---

## 10. Open questions

- **Act 7 — the WOW moment.** Acts 1-6 are all setup + read-only. The DEMO'S VALUE is the moment a Person Agent USES its stewardship delegation to actually move money. Proposed Act 7: "Alice's Person Agent drafts a payment to a vendor; the standing delegation enforces caveats; Bob's Person Agent approves (or auto-approves within bounds); Treasury executes." This is the first **Stewardship** act and the demo's emotional peak. Should be added.
- **Distinct browsers vs single browser.** Most evaluators will run the demo in one browser. Single-browser Alice+Bob means the same physical authenticator backs both passkeys — fine for demo, less realistic. Document the limitation per-act with the simulated badge.
- **Treasury → person-agent delegation shape.** Standing delegation with caveats? Or per-action approval? v0 plan = standing delegation issued in Act 5 with explicit limit caveats; per-action approval is a future Treasury type.
- **Recovery in v0.** Treasury recovery (T6 guardian quorum) is not in the act ladder. Add as Act 8 (after Act 7) if + when the user wants it. Recovery is **[Admin]** — guardian-quorum signature, T6 timelock.
- **Multi-browser demo orchestration.** Could ship a "share a link with Bob" deeplink + cross-browser handoff. Out of scope for v0 — single-browser flow is enough.
- **Session-key lifecycle.** When does a Person Smart Agent issue a session-key delegation to its Person Agent (a2a-server)? On every login (passkey re-ceremony each time)? Once per device with refresh-on-expiry? Time-bounded? Affects how Stewardship flows feel ergonomically: every action prompting a passkey ceremony defeats the point of stewardship. Probably: once per device, 30-day expiry, refresh-on-expiry. Needs its own spec.

---

## 11. Resolved decisions

- `apps/demo-web-pro` is REWORKED IN PLACE. Directory + package name unchanged.
- Gallery shape (multiple flow cards) → single act ladder.
- Existing flow files (`create-account/`, `admin-actions/`, `enroll-passkey/`, `view-account/`) are FOLDED into acts, not deleted. Their primitives (the wagmi hooks, gasless plumbing, ABI helpers) are reused.
- Vocabulary table is canonical for both UI copy AND code identifiers.
- Live vs simulated is surfaced explicitly per-act + never papered over.
- Per-agent-class server separation (person-a2a, org-a2a, treasury-a2a + their MCPs) is the LONG-TERM shape, but v0 can use the existing demo-a2a for all roles. The act ladder doesn't depend on the separation; the separation depends on the act ladder being valuable enough to warrant the work.
- Treasury never talks to humans directly. The chain goes: user → person smart account → person agent → treasury service agent.
- **Two authority modalities** are pinned per spec 212 § 2.2:
  - **Admin**: m-of-n owner-quorum signs; routed through CustodyPolicy's propose/execute machinery. Covers setup, key control, policy, owner changes, recovery, upgrades, AND issuing delegations. Acts 2-5 in this demo are Admin.
  - **Stewardship**: a delegate USES a delegation that was previously issued by Admin. Single signer (delegate's session key). Acts 7+ are Stewardship (currently queued; not yet in the act ladder).
- UI vocabulary: "admin"/"admin change" for Admin authority surfaces; "permission"/"authority grant"/"treasury permission card" for Stewardship surfaces. Code identifiers: `admin*` and `steward*` / `stewardship*`.

---

## 12. Cross-references

- [`specs/210-treasury-service-agent.md`](./210-treasury-service-agent.md) — the agent-architecture spec that makes "Treasury" a first-class concept.
- [`specs/207-smart-account-threshold-policy.md`](./207-smart-account-threshold-policy.md) — the policy machinery the Treasury uses.
- [`specs/202-delegation.md`](./202-delegation.md) — the delegation machinery between person agents and treasury.
- [`docs/architecture/dtk-alignment-audit.md`](../docs/architecture/dtk-alignment-audit.md) — the caveat parity that constrains what the permission cards in Act 5 can SAY today.
- [`docs/architecture/enforcer-registry/`](../docs/architecture/enforcer-registry/) — the canonical enforcer registry the permission-card renderer reads from.
- Memories: [[demo-web-treasury-flagship]] (this project's hard rules), [[gasless-demo-target]] (every action gasless), [[mirror-smart-agent-patterns]] (port person-a2a + person-mcp shape).
