# Spec 212 — Agent-centric delegation architecture

**Status:** load-bearing principle · 2026-05-21
**Outranks:** every tactical decision in every other spec. If a design weakens this principle, the principle wins.
**Builds on:** spec 210 (Treasury as Service Agent — the canonical example of an `ap:ServiceAgent` instance), W3C PROV-O ontology.
**Codifies:** the architectural rule the user pinned during phase 6f planning (2026-05-21).

> **agenticprimitives is agent-centric, not user-centric.** A connected USER controls exactly ONE Smart Agent — their Person Smart Agent — via passkey. From there, **ALL** stewardship flows via delegations BETWEEN Smart Agents (PROV-O Agents). The user does not appear in any authority chain. There is no shared wallet. There is no co-signing. There is no EOA fallback path that matters. The system is composed of agents talking to agents, with users acting only as passkey-holders for their single Smart Agent.

---

## 1. Statement of principle

A `prov:Agent` in agenticprimitives is either:
- a `prov:Person` (Person Smart Agent — on-chain AgentAccount, passkey-controlled)
- a `prov:Organization` (Company Org — on-chain AgentAccount with member Smart Agents as owners)
- an `ap:ServiceAgent` (Treasury, future Trading/Research/Compliance agents — on-chain AgentAccount with role-specific policies)

All three classes have **first-class agency**. They issue delegations. They receive delegations. They perform `prov:Activity`s. They are subjects of `prov:wasAttributedTo`.

A USER is NOT a `prov:Agent` in our system. A user is a human with a passkey. The passkey controls **exactly one** Person Smart Agent (the one whose AgentAccount was deployed with that passkey as the validating signer). The user's role in the architecture begins and ends with that control link.

Everything else — Person stewards Org, Person stewards Treasury, Org acts via Treasury, Treasury settles a payment with an external service — is a delegation chain between Agents. The user never appears in those chains.

---

## 2. Concrete consequences

### 2.1 SDK design

Every public API surface in `@agenticprimitives/*` takes Smart Agent addresses, not user/EOA addresses, when accepting an authority-bearing identity.

| Function signature | Anti-pattern | Required pattern |
| --- | --- | --- |
| Issue a delegation | `issueDelegation({fromEoa, ...})` | `issueDelegation({fromSmartAgent, ...})` |
| Verify a token | `verifyToken({signerEoa, ...})` | `verifyToken({signerSmartAgent, ...})` |
| Build a session | `createSession({userAddress, ...})` | `createSession({personSmartAgent, ...})` |
| Bundle a userOp | `buildUserOp({owner: address, ...})` | `buildUserOp({sender: smartAgent, ...})` |

If we need to talk about EOAs, the type is `Address` with a NAMED purpose ("p256VerifyingSigner", "bundlerSigner") — never "the user."

### 2.2 Authority modeling

The ONLY user-to-agent authority link is **passkey owns Person Smart Agent**. This link:
- is established at onboarding (passkey ceremony + AgentAccount deploy)
- is durable (passkey persists; Smart Agent address persists)
- requires NO additional caveats / delegations / policies
- is the LIMITING surface for what a user can directly cause: they can cause their Person Smart Agent to sign userOps. That's it.

Everything beyond that is agent-to-agent. The Person Smart Agent then:
- issues delegations to other Smart Agents (Org, Treasury, etc.) to bestow authority
- issues a session-key delegation to its own Person Agent (a2a-server-side identity) for routine actions
- receives delegations from other Smart Agents to act on their behalf

### 2.3 Audit trail (PROV-O)

Every Activity emits a PROV-O record whose `prov:wasAssociatedWith` is a Smart Agent URI, never a user / EOA URI. The user can be traced back through the Smart Agent's passkey-ownership relationship, but they do NOT appear in the Activity itself.

```turtle
[:paymentActivity]
    a prov:Activity ;
    prov:wasAssociatedWith :alicePersonAgent ;        # the agent that acted
    prov:actedOnBehalfOf :acmeConstruction ;          # the org the action serves
    prov:wasInfluencedBy :proposalActivity .          # upstream activity

# A user-question-shaped query traces the link:
# "Who is Alice the human?" → SPARQL: ?passkey ap:controls :alicePersonSmartAgent
```

### 2.4 Multi-party authority

When two Person Smart Agents (Alice + Bob) jointly control a Treasury:
- The Treasury's on-chain ownership: Alice's PSA + Bob's PSA (Smart Agent addresses, NOT user EOAs)
- Approvals required: 2 (Smart Agent delegation tokens, not user signatures)
- Each delegation token is signed by the corresponding Person Agent's session key (rooted in Person Smart Agent ownership, ultimately controlled by the passkey)

There is no "Alice signs from her browser" moment in the multi-party flow. There is "Alice's passkey ceremony unlocks her Person Smart Agent → her Person Agent issues a delegation to the Treasury."

### 2.5 New roles in the system

Adding a new authority entity (e.g., a Compliance role) creates a new `ap:ServiceAgent` subclass + new delegations to/from it. It does NOT create a new user EOA + add it as a signer.

Adding a new member to an Organization creates a new Person Smart Agent (with its own passkey-controlled AgentAccount) + an Org-level delegation/membership record. It does NOT add a new EOA to a Safe-shaped multi-sig.

### 2.6 EOA dependency

Zero. The full agent-centric architecture works with passkey-only auth:
- WebAuthn (P-256) authenticates the user
- AgentAccount's `_validateSig` accepts P-256 via the `WebAuthnLib` ERC-1271 path (already shipped)
- 4337 EntryPoint + `UniversalSignatureValidator` already handle the dispatch
- Paymaster sponsors gas (no native ETH in user pockets needed)

EOAs may appear as bundler signers, paymaster signers, or governance keys (operational), but never as user authority. demo flows must not require "connect a wallet" in the MetaMask sense — "connect a passkey" is enough.

---

## 3. What this is NOT

- This principle is **not** opposed to interoperability with EOA-using systems. Smart Agents can accept delegations whose root signer happens to be an EOA. The principle is about how AGENT-CENTRIC SYSTEMS THEMSELVES are built, not about isolation from the broader Ethereum ecosystem.
- This principle is **not** equivalent to "no MetaMask." MetaMask can be the wallet that holds + signs for a Person Smart Agent's passkey (since MetaMask supports passkeys via WebAuthn). The point is the AUTHORITY is in the Smart Agent, not in the wallet UI.
- This principle is **not** a claim about UX simplicity. Agent-centric is often MORE complex than user-centric (more entities, more delegations, more state). The trade-off is: agent-centric gives us a coherent provenance model + composable authority + first-class Service Agents. Shared-wallet doesn't.

---

## 4. How packages should embody this principle

| Package | Embodiment |
| --- | --- |
| `@agenticprimitives/types` | Define `SmartAgent` as a first-class type (address + class + metadata). Define `Delegation` as between SmartAgents. |
| `@agenticprimitives/identity-auth` | Passkey is the auth primitive. EOA is a legacy compat surface. Document the asymmetry. |
| `@agenticprimitives/agent-account` | AgentAccount IS the Smart Agent's on-chain embodiment. Public surface speaks in Smart Agent terms. |
| `@agenticprimitives/delegation` | Already correct shape (Delegation is between addresses). Audit + ensure docs use "Smart Agent" not "user." |
| `@agenticprimitives/key-custody` | Session keys are owned by Smart Agents (via delegation), not by users. |
| `@agenticprimitives/tool-policy` | Risk-tier checks attribute to Smart Agents. |
| `@agenticprimitives/mcp-runtime` | `withDelegation` consumes a delegation FROM a Smart Agent TO a Smart Agent. The user is never named. |
| `@agenticprimitives/audit` | Audit events are PROV-O records — `wasAssociatedWith :smartAgent`, never `:user`. |
| Future `@agenticprimitives/service-agent` | (potentially queued) — a runtime helper that scaffolds the a2a + MCP pair for any `ap:ServiceAgent` subclass. |

This audit + alignment pass against this principle is its own follow-up task. Where the packages already speak agent-centric (most of them do), no changes. Where they still leak user-centric assumptions, fix.

---

## 5. How demos should embody this principle

- demo-web-pro (treasury demo per spec 211): user connects passkey, controls EXACTLY their Person Smart Agent. All treasury actions are agent-to-agent delegations, surfaced as permission cards. No "sign this transaction" UX.
- demo-web (simple demo): currently EOA-leaning (uses wagmi `useAccount`). Either migrate to passkey-only or document as a "legacy onramp" demo, not the architectural exemplar.
- Future demos: every interactive flow tells an agent story. "Trading Agent receives a delegation from Treasury, then settles trades within caveats." "Compliance Agent monitors all Treasury Activities for policy violations."

---

## 6. How specs should reference this principle

Every spec touching authority or delegation cites spec 212 in its "Builds on" section. If a spec's design conflicts with this principle, the spec is wrong — not the principle. The principle outranks every spec because the principle is the architecture's identity statement; specs are working out the details.

Forms of "conflict" to watch for:
- "User signs this with their EOA…" — wrong; rewrite as "Person Smart Agent signs via its passkey ceremony."
- "Multi-sig means N users sign…" — wrong; rewrite as "M-of-N Smart Agent delegations."
- "The connected account…" — ambiguous; rewrite as "the connected Person Smart Agent" or "the controlling passkey."

---

## 7. Open questions for the architecture itself

The principle is settled. Tactical questions that follow from it:

- **Session-key lifecycle**: when does a Person Smart Agent issue a session-key delegation to its Person Agent? On every login? Once per device? Time-bounded? Refreshable? (Smart-agent has patterns; we should adopt.)
- **Delegation persistence**: where does the demo store the "Person Agent's session key" between page loads? Local storage? IndexedDB? Server-side keyed by some passkey-derived identifier?
- **Re-auth ergonomics**: passkey ceremonies are user-friction. If every action needs a passkey ceremony, users will resist. Sessions amortize this — once Person Agent has a session-key delegation from Person Smart Agent, routine actions don't require a passkey. But signing critical actions (T3+ value, T5 trust-root) probably should require fresh passkey ceremonies.
- **First-time setup**: how does a user FIRST get their Person Smart Agent? Phase 6f.1 will work this out, but the principle has implications: the deploy + initial session-key issuance + Org/Treasury membership claim is the only moment the user really "appears" in the system. After that, they're a passkey-holder for one specific Smart Agent.

These get their own specs/phases, but spec 212 names them so they're not forgotten.

---

## 8. Cross-references

- [`specs/210-treasury-service-agent.md`](./210-treasury-service-agent.md) — Treasury is the canonical Service Agent; spec 210 is built on this principle.
- [`specs/211-treasury-service-agent-demo.md`](./211-treasury-service-agent-demo.md) — the treasury demo IS this principle made visible; § 3 (three-entity model) is the user-side picture, § 4 (act ladder) is the agent-side picture.
- [`specs/202-delegation.md`](./202-delegation.md) — delegation primitives. Audit for user-EOA-leakage in language.
- [`docs/architecture/dtk-alignment-audit.md`](../docs/architecture/dtk-alignment-audit.md) — DTK alignment is about agent-to-agent delegation; this principle says we don't compromise on agent-centric to be DTK-shaped.
- Memories:
  - [[agent-centric-delegation]] — this principle's memory home
  - [[multi-sig-is-safety-and-recovery]] — multi-sig is an agent-shape concern
  - [[multisig-integration-not-bolt-on]] — delegations are agent-to-agent, threaded through packages
  - [[gasless-demo-target]] — gasless because users have no ETH (passkey only)
  - [[demo-web-treasury-flagship]] — the demo embodying this principle
  - [[ERC-7579-module-architecture]] — Smart Agents share a thin modular core
