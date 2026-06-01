# ADR-0022 — Authority MUST be declarative

**Status:** Accepted (2026-06-01).
**Drivers:** audit cost, regulatory readiness, enterprise procurement,
AI-agent verifiability, platform differentiation.
**Concrete process:** [`specs/237-audit-evidence-layer.md`](../../../specs/237-audit-evidence-layer.md).

---

## The rule

> **Authority MUST be a first-class declarative object, machine-
> readable and CI-enforced. The implementation MUST match the
> declaration, or CI refuses the PR. The declaration — not the
> implementation — is the source of truth for "who can do what,
> granted by whom, under what constraints."**

Every sensitive capability the platform offers MUST have a
manifest entry that names:

- the granting actor (typed by ontology term or CAIP-10 expression);
- the receiving actor;
- the proofs / preconditions the substrate enforces (`requires`);
- the negative space — what the capability MUST NOT permit (`denies`);
- evidence pointers — spec section, implementation file, locking
  invariant test, audit-event action.

This applies to:

- contract administrative entrypoints (`onlySelf`, `onlyGovernance`,
  `onlyEntryPoint`, custody-policy gated calls);
- delegation primitives (mint, redeem, revoke);
- MCP tool classifications + caveat requirements;
- relying-app authority grants;
- recovery flows;
- credential rotation;
- session lifecycle transitions.

## What this rule replaces

| What we used to rely on | What this rule replaces it with |
|---|---|
| Auditors reading `onlyOwner` / `onlyGovernance` / `onlySelf` modifiers across the codebase | A single manifest entry per capability, listing `grantedBy` / `grantedTo` |
| Auditors inferring delegation semantics from EIP-712 type definitions | A delegation-capability manifest entry that declares `chainId`, `audience`, `origin`, `nonce`, `expiry` requirements |
| Auditors tracing relying-app authority through OAuth scopes + token claims | A capability manifest entry on the relying-app's package that names what authority the Person SA actually granted |
| "Read the code" answers to procurement security questionnaires | `pnpm audit:evidence` outputs a versioned report |

## Why declarative wins

Three properties combine into a step-change:

**(P1) Implementation drift becomes a CI failure, not a runtime
incident.** If a manifest entry says
`denies: ["non-self caller"]` but a code path violates it (or
worse, no code path exists for the capability at all), the gate fires.

**(P2) Audit becomes graph verification.** With every capability
declared, an auditor — human or AI — can answer "show me all paths
that can move funds from Person X" by traversing the manifest graph,
not by reading 50,000 lines of code.

**(P3) The negative space is as auditable as the positive.** Most
audit findings are about what a capability **should not** permit
(replay, escalation, outliving its owner). `denies` makes the
negative space first-class — the auditor can ask the manifest
directly "what is forbidden here" instead of mentally enumerating
attack vectors.

## What stays in code

The implementation. This rule does NOT say "authority lives only in
manifests and is generated from them" — that would be a worse
architecture (manifests are not Turing-complete, and the runtime
substrate must enforce authority at the lowest layer regardless).

What stays in code:

- The actual `onlySelf` / custody-policy / caveat-evaluation
  enforcement.
- The EIP-712 typed-data structures.
- The runtime caveat evaluator.
- Every test (Foundry invariants, Halmos proofs, Echidna sequences,
  formal-verification spec).

What moves into manifests:

- The **claim** about each capability.
- The **pointers** to the spec / implementation / invariant test /
  audit-event that back the claim.
- The **negative-space declaration** (`denies`).

The rule is best stated as a pairing:

> Code implements authority. Manifests declare it. Audit checks the
> two match.

## What this enables

- **Trust-graph queries.** `@agenticprimitives/trust-model` (proposed
  in spec 237) becomes a read model over the manifest graph + the
  on-chain delegation registry. Audit queries become typed function
  calls.
- **Procurement readiness.** `pnpm audit:evidence` produces an
  `audit-readiness-report.md` consumable by enterprise security teams
  without our engineering team having to assemble the artifact each
  time.
- **AI-agent verifiability.** An AI auditor can consume the manifest
  graph as ground truth and run its own verification queries — same
  surface a human auditor uses.
- **Regulatory adaptability.** Future regulatory frameworks (MiCA,
  EU AI Act, US fintech delegation rules) increasingly demand
  evidence of authority controls. A declarative substrate produces
  the evidence by construction.

## Drift triggers — STOP and reroute

- "I added a new admin entrypoint to AgentAccount but didn't add a
  manifest entry." — **STOP.** The PR is incomplete; add the entry.
- "I added a new delegation caveat but didn't extend the
  `delegation.mint` capability's `requires` list." — **STOP.** Same.
- "I want to introduce authority through a database row in a
  relying-app's backend." — **STOP.** Either it's a delegation
  (typed object) or it's not authority — the database row pattern
  is what this ADR closes.
- "I want to encode authority in a Slither detector." — Acceptable
  as a CODE-side cross-check on the MANIFEST-side declaration, NOT
  as a primary source of truth. The detector's docstring MUST
  reference the manifest entry it backs.

## What this ADR is NOT

- NOT a generated-from-manifest code synthesis. Manifests describe;
  code enforces.
- NOT a replacement for security audits. The ADR makes audits
  efficient.
- NOT compatible with "we'll write the manifest later." If the rule
  is opt-in, it doesn't change the cost of audit. The Audit Evidence
  Layer phasing in spec 237 §8 ramps the gates so adoption is
  incremental, but the rule is final-state binding.

## Related ADRs

- ADR-0010 — Canonical Smart Agent Identifier (the identity
  substrate this authority graph anchors on).
- ADR-0011 — Credentials rotate; identity persists (authority
  granted to a SA persists across credential rotation).
- ADR-0015 — `identity-directory` is an evidence-backed read model
  (the pattern the proposed `trust-model` package mirrors).
- ADR-0018 — agenticprimitives-wide formal ontology (the type system
  the manifest entries are typed against).
- ADR-0019 — Relying-site authority is a scoped delegation (the
  archetype of declarative authority).
- ADR-0020 — Faceted agent identity doctrine (the rotation envelope
  the authority graph respects).
