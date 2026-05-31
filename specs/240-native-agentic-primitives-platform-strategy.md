# Spec 240 — Native Agentic Primitives Platform Strategy

**Status:** strategy doctrine · 2026-05-30  
**Scope:** repository packages, Ethereum contracts, audit posture, and roadmap
prioritization for engagement platforms.  
**Builds on:** specs 100, 101, 201, 202, 204, 206, 209, 214, 224, 229, 230,
234, 236.  
**Reference: smart-agent patterns to port:** `smart-agent/docs/specs/architecture.md`
(agent-first layered architecture), `smart-agent/docs/specs/engagement-shapes-plan.md`
(engagement UX shaped by the work being done), and
`smart-agent/docs/specs/validation-feedback-plan.md` (inspectable trust and
validation graph). We port the product and architecture patterns, not the repo
layout.

---

## 1. Product Strategy

`agenticprimitives` is a native platform for agentic engagement products, not a
thin integration wrapper around Privy, Safe, MetaMask Delegation Toolkit, or any
single wallet/account vendor.

The core bet:

> A tightly integrated set of first-party Smart Agent primitives, continuously
> reviewed by AI-assisted audit agents and backed by selective external review,
> will outpace a stack made from disjointed platform SDKs for the engagement
> products we are building.

This is a long-term ownership strategy. We optimize for:

- seamless onboarding;
- canonical Smart Agent identity;
- passkey-first personal secure homes;
- scoped, revocable app permissions;
- explainable trust and audit trails;
- package boundaries that AI agents can reason about quickly;
- contracts that remain thin, modular, and reviewable.

We do **not** assume we can match the operational maturity of Privy, Safe, or
MetaMask DTK in 3-6 months. We assume we can reach a stronger internal beta
foundation faster than SDK-dependent teams, then compound with focused external
pressure-testing.

## 2. Timeline Doctrine

| Window | Target | What it means |
| --- | --- | --- |
| 3-6 months | Strong foundation + beta readiness | Native primitives power internal demos and small pilots; AI-assisted review runs on every change; high-risk flows have explicit threat-model rows. |
| 6-9 months | Competitive pilot stack | External review or public contest covers the core package + contract surfaces; production runbooks and observability are credible. |
| 9-12+ months | Durable platform advantage | Native UX, lower integration debt, transparent audit evidence, and domain-specific engagement flows become hard for generic SDK stacks to match. |

The 3-6 month goal is **not** "Privy/Safe-grade ship-and-forget." It is
"defensible beta with faster learning loops."

## 3. Principles For Packages

### P1 — Native Primitives Over Glued SDKs

Each package exists because it owns a stable primitive boundary:

- `connect-auth`: prove a credential.
- `agent-account`: anchor identity in an ERC-4337 Smart Agent.
- `account-custody`: govern credential rotation and recovery.
- `connect`: issue cross-origin Smart Agent sessions.
- `delegation`: grant scoped authority.
- `tool-policy`: classify what an action may do.
- `mcp-runtime`: enforce authority at tool boundaries.
- `agent-naming`, `agent-profile`, `agent-relationships`: publish facets and
  graph context that point at the canonical Smart Agent.
- `key-custody`: protect runtime signing and service MAC material.
- `audit`: make evidence exportable and reviewable.

Packages should not become vendor facades. Adapters may exist later, but the
first-class model stays Smart Agent native.

### P2 — AI-Readable Boundaries Are Product Infrastructure

Every package keeps a small public surface, a `CLAUDE.md`, a manifest, and a
spec pointer because AI-assisted development and audit are part of the operating
model. A package that cannot be summarized, routed, and regression-tested by an
agent is not ready to scale.

### P3 — Engagement UX Drives Package Priority

Prioritize polish and examples for flows that matter in Western engagement
products:

- passkey secure-home onboarding;
- member/community sign-in;
- delegated RSVP / invite / profile-share actions;
- donor or event-spend approval;
- revocation and "connected apps" management;
- exportable audit logs for member trust and operator support.

The engagement core is `connect-auth + agent-account + connect + delegation +
tool-policy + audit`, with `mcp-runtime` and `key-custody` carrying the runtime
data-access path.

### P4 — Transparent Trust Beats Compliance Theater

For churches, donor portals, local communities, and event mobilization tools,
trust is built through clear user control, revocation, receipts, and readable
audit history. Formal stamps help, but they are not the product. The product is
an understandable journey where a person can see what they own and what each app
may do.

### P5 — No Silent Fallbacks, No Hidden Authority

The repository doctrine in ADR-0013 applies at strategy level: auth, resolution,
and authorization paths must be singular and explicit. If a path depends on an
external SDK, an indexer, or a cache, that dependency is named in the spec and in
the failure mode.

## 4. Ethereum Contract Strategy

The contracts are the authority substrate. They must stay smaller, more modular,
and more reviewable than the product surface above them.

### C1 — Smart Agent Address Is The Anchor

Every person, organization, service agent, and treasury is identified by its
Smart Agent address. Names, profiles, secure-home domains, passkeys, OAuth
subjects, and relationship records are facets pointing at that anchor.

### C2 — Thin ERC-4337 Core, Modules For Policy

`AgentAccount.sol` remains a thin ERC-4337 / ERC-1271 / ERC-7579 core. Policy,
recovery, spend, sessions, treasury, and advanced passkey behavior belong in
modules or separate contracts when they are optional, policy-heavy, high-risk, or
likely to change.

Spec 209 is the implementation doctrine for this rule.

### C3 — Delegation Is Authority, Custody Is Control

Relying apps receive scoped authority. They do not become custodians. Credential
add / replace / recovery remains a custody operation. Delegations must survive
credential rotation because the principal is the Smart Agent address, not the
credential.

### C4 — Contract Interfaces Must Be AI-Auditable

Contracts should expose:

- small typed surfaces;
- explicit invariants;
- event emissions suitable for audit evidence;
- bounded loops and clear gas assumptions;
- no app-specific branch logic in core contracts;
- per-contract `AUDIT.md` where risk is non-trivial.

### C5 — External Review Targets The Narrow Core

External audits and contests should focus first on:

1. `AgentAccount` core and factory;
2. `CustodyPolicy`;
3. delegation manager and enforcers;
4. revocation / disabled-delegation path;
5. paymaster and bridge-signing surfaces;
6. upgrade and deployment scripts.

The goal is not to audit every demo app before every pilot. The goal is to audit
the small authority substrate that every app depends on.

## 5. AI-Assisted Audit Doctrine

AI audit is mandatory, but not sufficient by itself.

### A1 — AI On Every Change

Every package or contract PR should run:

- static analysis where available (`forge`, Slither/Aderyn style tooling);
- targeted AI review prompts for the changed package boundary;
- regression tests for any security invariant touched;
- manifest / dependency / forbidden-term rails.

### A2 — AI Finds Known Patterns Fast

Use AI aggressively for:

- known smart-contract bug classes;
- EIP-712 hashing drift;
- replay and nonce checks;
- exact-match origin / redirect validation;
- package boundary violations;
- stale docs and threat-model drift;
- copy/paste inconsistencies across demo apps.

### A3 — Humans And External Review Cover Novel Context

Do not ask AI to be the final authority on:

- novel cross-package business logic;
- privacy and consent semantics;
- upgrade safety;
- custody recovery;
- legal-risk language;
- incident response;
- production operational readiness.

For those, use senior review plus lightweight external signals: annual firm
audit, scoped contest, or public bounty depending on surface maturity.

## 6. Production Gates For Engagement Products

For low-stakes Western engagement pilots, the gates are pragmatic:

1. **Internal staging:** AI review + internal red-team + all package checks.
2. **Small pilot:** P0/P1 closed, explicit accepted demo cuts, clear revocation
   UX, monitored onboarding drop-off and support tickets.
3. **Broader beta:** external review of core package + contract surfaces,
   production runbooks, audit export, key-rotation practice.
4. **Scale:** bug bounty or contest, recurring external review, public audit
   dossier, operational SLOs.

User metrics are part of readiness. If onboarding drop-off, recovery friction, or
support tickets spike, the system is not production-ready even if the contracts
pass tests.

## 7. Roadmap Implications

### Package Priority

1. Harden the engagement core: `connect-auth`, `agent-account`, `connect`,
   `delegation`, `tool-policy`, `audit`.
2. Close runtime access: `mcp-runtime`, `key-custody`, and the A2A/MCP service
   boundary.
3. Keep discovery coherent: `agent-naming`, `agent-profile`,
   `agent-relationships`, then agent skills / geo / validation when they earn
   their package boundary.
4. Defer broad adapters until the primitives prove repeatable across at least
   three app consumers.

### Contract Priority

1. Keep `AgentAccount` small.
2. Move policy-heavy behavior to ERC-7579 modules.
3. Make revocation and recovery boring and test-heavy.
4. Treat every new enforcer as a security product with its own fixtures and
   audit notes.
5. Prefer one simple on-chain invariant over many compensating app checks.

### Documentation Priority

Each new architecture decision should answer:

- Which primitive owns this?
- Which Smart Agent address is the subject?
- Is this custody or authority?
- What is the revocation path?
- What evidence will an auditor inspect?
- What user metric proves the flow is usable?

## 8. What Success Looks Like

The successful version of this strategy is not "we rebuilt Privy, Safe, and
MetaMask DTK." It is:

- a person creates a personal secure home and understands what they own;
- a relying app receives only the permission the person approved;
- an organization or treasury is a Smart Agent facet, not a bolted-on account;
- an operator can export evidence for what happened;
- an auditor can follow package, contract, and app responsibilities without
  tribal knowledge;
- a small team can ship weekly without surrendering the core user journey to
  disjointed vendors.

That is the native platform advantage.

