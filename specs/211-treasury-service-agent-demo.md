# Spec 211 — Treasury Service Agent demo (apps/demo-web-pro reshape)

**Status:** draft · 2026-05-21
**Replaces:** the capability-gallery shape of `apps/demo-web-pro` (phase 6c.5-e). The directory + package name stay; the content transforms.
**Builds on:** spec 207 (threshold-policy), spec 209 (modular core), spec 210 (Treasury as Service Agent — ontology + agency model).
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

Every UI string + every code identifier honors the table below. Implementation primitives (`ThresholdValidator`, `proposeAdmin`, `caveat`, `delegation token`, `userOp`) are forbidden in user-facing copy.

| Concept | UI label | Identifier convention | Tech mapping |
| --- | --- | --- | --- |
| Shared funds container, has agency | **Treasury service agent** | `treasury`, `TreasuryServiceAgent` | AgentAccount in org mode + ThresholdValidator |
| Per-user on-chain identity | **Person smart account** | `personSmartAccount`, `PersonSmartAccount` | AgentAccount in hybrid mode, passkey-owned |
| Per-user delegated agent identity | **Person agent** | `personAgent`, `PersonAgent` | Session-bound identity (smart-agent's a2a pattern) |
| ThresholdValidator module | **Account safety policy** | `accountSafetyPolicy` | (do not surface module/validator) |
| Pending admin action | **Scheduled admin change** | `scheduledChange` | (do not surface "proposal") |
| M-of-N threshold | **Approvals required** | `approvalsRequired` | |

---

## 3. Three-entity user model

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

## 4. Act ladder (the story)

Linear progression. No branching. Each act is gated on the previous one completing.

### Act 1 — Create Alice Person Account
- WebAuthn registration → store Alice's credentialId + (x, y) locally.
- Counterfactual address preview from `factory.getAddressForPasskey`.
- Deploy via `factory.createAccountWithPasskey` (gasless via existing paymaster).
- Display Alice's person smart account address + a generated `.agent`-style label.
- Live status: 🟢 LIVE on Base Sepolia.

### Act 2 — Create Treasury Service Agent
- Alice creates the treasury service agent (single-owner initially).
- `factory.createAccountWithModeCustomT4` with `mode=org` (or threshold; the addition of Bob in Act 4 promotes it to N≥2).
- Initial T4 timelock from a dropdown (mirrors current CreateAccountFlow capability — keep the dropdown).
- "Account safety policy" badge surfaces: 1-of-1 today, will become 2-of-2 in Act 4.
- Live status: 🟢 LIVE.

### Act 3 — Add Bob Person Account
- Same flow as Act 1, but for Bob.
- Detect + warn if browser returns the same credential as Alice (same physical authenticator).
- If the demo runs in a single browser session, mark as 🟡 SIMULATED ("Bob is simulated in this browser; distinct passkey artifact").
- Live status: 🟢 LIVE if distinct passkey; 🟡 SIMULATED otherwise.

### Act 4 — Set 2-Person Control on Treasury
- Schedule + execute `AddOwner(Bob's person smart account)` admin action against the treasury.
- Uses existing `flows/admin-actions/AdminActionsFlow.tsx` machinery, but folded into a scripted single-screen flow.
- UI labels: **Schedule owner change**, **Safety delay** (T4 timelock), **Apply approved change**.
- After execution: 2-of-2 control surfaces in the dashboard.
- Live status: 🟢 LIVE for AddOwner. The TRANSITION to actual 2-of-2 quorum (where both Alice + Bob must sign subsequent admin changes) marked 🟡 IN-FLIGHT until packed multi-sig signature collection is hardened.

### Act 5 — Delegate Treasury Management to Person Agents
- The treasury issues a permission card to each person agent: "Alice's person agent / Bob's person agent can draft treasury actions + read balances + request spending within limits."
- Limits surfaced as plain-language: token, amount, destination, expiry, network, revocation.
- "What this delegation does NOT permit": add owners, change policy, bypass approvals, drain arbitrary assets.
- Uses `@agenticprimitives/delegation` for token construction.
- Live status: 🟡 SIMULATED for runtime enforcement (the on-chain redeem path is hardened against the existing demo-mcp; running it against the treasury needs session-package + accepted-session work). The delegation OBJECT is built live, signed, hashed; the ENFORCEMENT story is paragraph copy with a clear "this enforcement is not yet wired" badge.

### Act 6 — Treasury Control Dashboard
- Persistent dashboard for the rest of the demo.
- Panels:
  - **Treasury service agent**: address, mode, owners (Alice's + Bob's person smart accounts), approvals required.
  - **Person controllers**: Alice + Bob passkey accounts + status (connected / disconnected).
  - **Person agents**: per-person card showing the active delegation from the treasury.
  - **Pending scheduled admin changes**: empty after Act 4 in the happy path; populated if the user runs additional changes.
  - **Active treasury permissions**: list of standing delegations (Act 5 output).
  - **Audit trail**: tx hash, signatures, delegation hash, revocation path. PROV-O attribution surfaced ("Activity 0x… wasAssociatedWith Alice's person agent · actedOnBehalfOf Organization").
- Live status: 🟢 LIVE for reads.

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
| **6f.1 — Shell + Act 1** | Strip current App.tsx gallery. Build the persistent shell (top/left/main/right/bottom). Implement Act 1 end-to-end (create Alice). New components: `ActorCard`, `LiveStatusBadge`, `ProgressRail`. | 🟢 LIVE — Alice deploy is the most-shipped path |
| **6f.2 — Acts 2 + 4** | Treasury creation + 2-person control via existing CreateAccount + AdminActions machinery, folded into acts | 🟢 LIVE — fully live |
| **6f.3 — Act 3** | Bob person account; multi-identity browser-state isolation in `lib/passkey.ts` | 🟢/🟡 LIVE w/ distinct passkey; SIMULATED if browser collapses |
| **6f.4 — Act 5** | Delegation construction + permission-card UI. Runtime enforcement DEFERRED | 🟡 SIMULATED enforcement, LIVE object construction |
| **6f.5 — Act 6 Dashboard** | Stitch all reads into a persistent dashboard. PROV-O attribution surfaced in `AuditStrip` | 🟢 LIVE reads |
| **6f.6 — Per-agent-class servers** | Port person-a2a + person-mcp + organization-a2a + organization-mcp + treasury-a2a + treasury-mcp scaffolding from smart-agent. Wire the demo to use them | 🟡 → 🟢 transition |
| **6f.7 — Runtime delegation enforcement** | Act 5's simulated enforcement becomes LIVE: accepted-session blessing + session-package validation + treasury-a2a redeem | 🟢 LIVE; closes the demo's biggest "simulated" caveat |

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
- `apps/contracts/*` — no contract changes; existing factory + validator + enforcers are sufficient.
- `@agenticprimitives/identity-auth` — passkey ceremony already there.

---

## 9. Live/simulated honesty — non-negotiable

Every act surfaces a `LiveStatusBadge` with one of:

- 🟢 **LIVE** — chain write/read against deployed contracts on Base Sepolia.
- 🟡 **SIMULATED** — artifact constructed locally; not yet enforced on chain; explicit text saying so.
- 🔴 **NOT IMPLEMENTED** — placeholder for future work.

The demo MUST NOT lie about what it does. If a delegation is constructed but its runtime enforcement is paragraph copy + not on chain, the badge is yellow and the right-panel explainer says so.

---

## 10. Open questions

- **Org as on-chain agent.** Does the Organization itself manifest as an AgentAccount, or only as the conceptual aggregate of {Alice's PSA, Bob's PSA}? Spec 210 leans on prov:Organization having agency; v0 demo can collapse it to "just the set of owners on the Treasury" and revisit if a future demo needs an explicit Org AgentAccount.
- **Distinct browsers vs single browser.** Most evaluators will run the demo in one browser. Single-browser Alice+Bob means the same physical authenticator backs both passkeys — fine for demo, less realistic. Document the limitation per-act with the simulated badge.
- **Treasury → person-agent delegation shape.** Standing delegation with caveats? Or per-action approval? v0 plan = standing delegation issued in Act 5 with explicit limit caveats; per-action approval is a future Treasury type.
- **Recovery in v0.** Treasury recovery (T6 guardian quorum) is not in the act ladder. Add as Act 7 / phase 6f.8 if + when the user wants it.
- **Multi-browser demo orchestration.** Could ship a "share a link with Bob" deeplink + cross-browser handoff. Out of scope for v0 — single-browser flow is enough.

---

## 11. Resolved decisions

- `apps/demo-web-pro` is REWORKED IN PLACE. Directory + package name unchanged.
- Gallery shape (multiple flow cards) → single act ladder.
- Existing flow files (`create-account/`, `admin-actions/`, `enroll-passkey/`, `view-account/`) are FOLDED into acts, not deleted. Their primitives (the wagmi hooks, gasless plumbing, ABI helpers) are reused.
- Vocabulary table is canonical for both UI copy AND code identifiers.
- Live vs simulated is surfaced explicitly per-act + never papered over.
- Per-agent-class server separation (person-a2a, org-a2a, treasury-a2a + their MCPs) is the LONG-TERM shape, but v0 can use the existing demo-a2a for all roles. The act ladder doesn't depend on the separation; the separation depends on the act ladder being valuable enough to warrant the work.
- Treasury never talks to humans directly. The chain goes: user → person smart account → person agent → treasury service agent.

---

## 12. Cross-references

- [`specs/210-treasury-service-agent.md`](./210-treasury-service-agent.md) — the agent-architecture spec that makes "Treasury" a first-class concept.
- [`specs/207-smart-account-threshold-policy.md`](./207-smart-account-threshold-policy.md) — the policy machinery the Treasury uses.
- [`specs/202-delegation.md`](./202-delegation.md) — the delegation machinery between person agents and treasury.
- [`docs/architecture/dtk-alignment-audit.md`](../docs/architecture/dtk-alignment-audit.md) — the caveat parity that constrains what the permission cards in Act 5 can SAY today.
- [`docs/architecture/enforcer-registry/`](../docs/architecture/enforcer-registry/) — the canonical enforcer registry the permission-card renderer reads from.
- Memories: [[demo-web-treasury-flagship]] (this project's hard rules), [[gasless-demo-target]] (every action gasless), [[mirror-smart-agent-patterns]] (port person-a2a + person-mcp shape).
