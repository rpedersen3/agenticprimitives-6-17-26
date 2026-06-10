# @agenticprimitives/fulfillment — Audit Notes

**Status:** Foundational (W1) — code shipped; not production enforcement.
**Last reviewed:** 2026-06-10 (audit-consolidation round 1).

## Charter
Spine Layers 10–12 (spec 244): the `FulfillmentCase` operational container + lifecycle state machine, Task/
Message/Artifact case-binding (Task substrate lives in `mcp-runtime`/a2a per spec 245), the `HandoffPolicy`
authority object for cross-agent handoffs, and `EvidenceCredential`/`OutcomeCredential` promotion.

## Findings (canonical status: `docs/audits/findings.yaml`)
- No first-class audit findings filed against this package yet. Its authority surfaces — `HandoffPolicy`
  enforcement (FLF-INV-09/10) and the `OutcomeCredential`-requires-`EvidenceCredential` rule (FLF-OUT-1/D-40) —
  are **invariants, not yet negative-tested end to end**; that gap is the package's main audit risk.

## Security invariants
- Handoffs MUST pass the `HandoffPolicy` check; no handoff to a lower-privacy assignee under `preservePrivacyTier`.
- Messages/Artifact bodies never go on chain (hash-anchored only); lifecycle `archived` requires reconciled agreement status.

## Production readiness
W1-foundational. Authority binding (handoff policy, outcome citation) needs explicit negative tests + a threat
model before production. Canonical invariants: `spec.md` + [`CLAUDE.md`](./CLAUDE.md).
