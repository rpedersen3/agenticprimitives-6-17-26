# @agenticprimitives/intent-resolver — Audit Notes

**Status:** Skeleton (W1) — types + `PassThroughResolver` only; full engine deferred to W2.
**Last reviewed:** 2026-06-10 (audit-consolidation round 1).

## Charter
Spine Layer 4 (spec 239 §4.5) — the resolver interface (`IIntentResolver`), the `ResolvedOrder` type, and the
single trivial `PassThroughResolver` that returns the intent's own constraints/assumptions unchanged with
`confidence = 1.0`, `requiresUserConfirmation = false`. The package name + interface are reserved so the W2
LLM-driven resolver can grow without restructuring `intent-marketplace`.

## Findings (canonical status: `docs/audits/findings.yaml`)
- No first-class findings. The only audit-relevant fact: `PassThroughResolver` sets `confidence = 1.0` /
  `requiresUserConfirmation = false` by design (it does no inference) — consumers must NOT read that as a
  trust signal. Any real resolution (W2) MUST produce a full `ResolutionReceipt` (RR-INV-04) and honor the
  user-confirmation gate (RR-INV-01).

## Security invariants
- W1 surface is deterministic — no LLM client in the W1 dependency graph.
- Every resolution emits a `ResolutionReceipt`, even PassThrough.

## Production readiness
Intentionally a skeleton; the real (authority-relevant) resolver is W2 and must land with provenance + negative
tests. Canonical invariants: `spec.md` + [`CLAUDE.md`](./CLAUDE.md).
