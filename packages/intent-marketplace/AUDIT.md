# @agenticprimitives/intent-marketplace — Audit Notes

**Status:** Foundational (W1) — code shipped; NOT production matching/routing authority.
**Last reviewed:** 2026-06-10 (audit-consolidation round 1).

## Charter
Spine Layers 2,3,5,6,7 (spec 239) — the Direct-Lane intent marketplace: `Intent` envelope +
`ConstraintSet`/`AssumptionSet` typed structures, `ResolutionReceipt` (AI-auditability), match classes, the
`Commitment` hand-off to `agreements`, the visibility-tier projections, and the W1 matcher.

## Findings (canonical status: `docs/audits/findings.yaml`)
- **Non-authoritative helper (audit warning, OPEN):** `computeTopicSimilarity()` returns `1.0` when *either*
  topic is missing. Acceptable for demo ranking; **unsafe as a production matching/routing or authorization
  gate** — a missing-topic intent would score as a perfect match. The matcher output is advisory ranking, not
  authority. Add a test proving downstream consumers don't treat the score as an enforcement gate before this
  package is used for real routing.
- `ResolutionReceipt.requiresUserConfirmation` (RR-INV-01) is an invariant the SDK ships but does not itself enforce
  at the boundary — consumers must gate on it.

## Security invariants
- `ConstraintSet`/`AssumptionSet` are first-class typed, never freeform payload (D-38).
- No vertical/faith vocabulary in package payloads (`check:no-domain-in-packages`); matcher weights are fixed in W1 (PD-18).

## Production readiness
W1-foundational. The matcher + similarity helpers are advisory and MUST NOT be treated as authorization. Needs a
threat model + negative tests + a lifecycle gate before production routing. Canonical invariants: `spec.md` + [`CLAUDE.md`](./CLAUDE.md).
