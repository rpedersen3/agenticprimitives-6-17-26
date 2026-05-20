# `@agenticprimitives/tool-policy` — Security & Architecture Audit

**Status:** alpha
**Last refreshed:** 2026-05-20
**Owners:** tool-policy package CODEOWNERS
**System audit cross-reference:** [docs/architecture/product-readiness-audit.md](../../docs/architecture/product-readiness-audit.md)

## 1. Charter

Protocol-agnostic, deterministic tool classification + policy decision
engine. Owns: `declareTool` (classification metadata), `exactCall` /
`matchesExactCall` (the exact-call DSL), `evaluatePolicy` (the
deterministic decision function), `clampTtlForRiskTier` /
`requiredCaveatsForRiskTier` (risk-tier mappings), and `lintClassification`
(developer-time classification check).

Per its `CLAUDE.md`: imports `types` only. No transport, no protocol,
no MCP, no HTTP.

What this package does NOT own:
- Enforcement at runtime (`mcp-runtime.withDelegation` should call
  `evaluatePolicy()`).
- Audit-event persistence (cross-cutting; system **C3**).
- Tool metadata declared at the consumer side; this package provides
  the DSL.

## 2. Security invariants (DO NOT BREAK)

1. **Deterministic decisions.** Same inputs → same output. No clock,
   network, or RNG inside `evaluatePolicy`. Test:
   `test/unit/decision.test.ts` (TODO if not present — see Gaps).
2. **Fail-closed on unknown metadata.** A tool with no classification
   should be treated as the highest-risk tier (or rejected outright);
   never default to "permit".
3. **`exactCall` matching is exact** — no glob, no prefix, no
   case-insensitive comparison. The DSL is meant to be auditable, not
   forgiving.
4. **Risk-tier clamps are floor + ceiling, both fail-closed.**
   `clampTtlForRiskTier(tier, requested)` must not return a TTL longer
   than the tier's ceiling — even if the caller asked for longer.
5. **No side-channel dependencies.** No `process.env`, no globals.
   `evaluatePolicy` is a pure function.

## 3. Public API surface (audit scope)

| Symbol | Kind | Trust boundary |
| --- | --- | --- |
| `declareTool` | function | Compile-time classification metadata; consumers use it to declare per-tool risk tier + exact-call sets. |
| `exactCall`, `matchesExactCall` | functions | Exact-call DSL primitives. |
| `evaluatePolicy` | function | The decision. **Must be called inside `withDelegation`.** Currently not wired (system **H2**). |
| `clampTtlForRiskTier`, `requiredCaveatsForRiskTier` | functions | Risk-tier mappings consumed during delegation issuance. |
| `lintClassification` | function | Developer-time linter. |

## 4. Threat model

| Threat | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |
| Non-deterministic decision (clock skew, env-dependent) | Low | Critical (decision audit reproducibility) | Pure function, no env reads | Covered by design |
| Permissive default on unknown tool | Medium when scaled | High (untracked tool can run) | Fail-closed default | Design-level; depends on consumer wiring |
| `exactCall` matcher gets too clever (glob/prefix) | Low | High (broader than intended permissions) | Strict matcher | Covered |
| Policy bypass because `evaluatePolicy` never called | High | High | Wire into `withDelegation` | **Open: H2** |
| Audit event of decision is missing | High | High (no forensic trail) | Emit on decision | **Open: C3** |

## 5. Findings (open)

| ID | Severity | Finding | Status | Notes |
| --- | --- | --- | --- | --- |
| **H2** (system) | P1 | `evaluatePolicy()` not invoked at any runtime path. | Open | `with-delegation.ts:6` marks it future; `apps/demo-mcp/src/index.ts:56` echoes "enforcement is v0.1". |
| **C3** (system) | P0 | No audit event emitted on policy decisions. | Open | When wired, emit `{toolName, principal, decision, reason}`. |
| **TP-1** | P2 | No property test for `evaluatePolicy` decisions. | Open | A random-input fuzz would catch ordering / precedence regressions. |
| **TP-2** | P3 | `lintClassification` developer-time check is not in CI. | Open | Should run as part of `pnpm check:all`. |

## 6. Test posture

- **Unit tests:** Package ships with the engine but the test suite is
  light. As of 2026-05-20, the package's full test count is included in
  the workspace total but not broken out here (see system audit for the
  count). Coverage areas: `decision.test.ts`, `exact-call.test.ts`,
  `risk-tier.test.ts` (where present).
- **Gaps:**
  - No property test (TP-1).
  - No integration test that exercises `evaluatePolicy` from inside
    `withDelegation` (because the wiring doesn't exist yet — system **H2**).
  - No CI gate for `lintClassification` (TP-2).

## 7. Hardening backlog

- [ ] **(H2)** Coordinate with `mcp-runtime` to wire `evaluatePolicy()` into `withDelegation`. Tests covering deny, permit, and unknown-classification paths.
- [ ] **(TP-1)** Add a property test that generates random `(classification, caveat-set, request)` and asserts decision determinism.
- [ ] **(TP-2)** Add `lintClassification` to `pnpm check:all`.
- [ ] **(system C3)** Emit audit events from `evaluatePolicy` when wired into the runtime path.

## 8. External audit readiness

An external auditor evaluating this package needs:

- `pnpm build` + `pnpm test`
- `specs/204-tool-policy.md`
- This audit doc + system audit
- Source: `decision.ts` (the pure decision function), `exact-call.ts` (the DSL), `risk-tier.ts` (the tier clamp logic), `classification.ts` (the metadata shape), `lint.ts` (the developer-time linter)
- The downstream wiring story (system **H2**): "where will `evaluatePolicy()` be called and how is the consumer expected to react to deny?"

## 9. Accepted limitations / scope exclusions

- Does NOT enforce decisions at runtime; consumer (mcp-runtime) is responsible.
- Does NOT define delegation tokens or caveats; reads classification only.
- Does NOT depend on MCP, HTTP, or transport.
- Forbidden imports: every other `@agenticprimitives/*` package except `types`. This is by design — keeps the decision engine pure.
