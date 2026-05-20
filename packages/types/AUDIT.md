# `@agenticprimitives/types` — Security & Architecture Audit

**Status:** alpha
**Last refreshed:** 2026-05-20
**Owners:** types package CODEOWNERS
**System audit cross-reference:** [docs/architecture/product-readiness-audit.md](../../docs/architecture/product-readiness-audit.md)

## 1. Charter

The type-only base of the dependency graph. Owns: `Address`, `Hex`,
`ChainId` (branded), `BrandedId<T>` (the brand-helper pattern). No
runtime code; consumed by every other `@agenticprimitives/*` package.

## 2. Security invariants (DO NOT BREAK)

1. **Zero runtime.** This package must compile to type-only output. No
   `console.log`, no side effects, no exports of functions or values.
   Consequence if broken: every downstream consumer gains a runtime
   dependency they don't expect.
2. **Branded types are non-erodable.** `BrandedId<T>` should reject
   plain `string` assignment without an explicit cast. This is the
   point of the brand.
3. **`Address` and `Hex` are EVM canonical forms.** `Address` is
   `\`0x${string}\`` (lower-case in production; checksum elsewhere).
   `Hex` accepts both 0x-prefixed and (per consumer) raw forms.

## 3. Public API surface (audit scope)

| Symbol | Kind | Trust boundary |
| --- | --- | --- |
| `Address` | type | EVM address wire type. |
| `Hex` | type | Generic 0x-prefixed string. |
| `ChainId` | branded type | EIP-155 chain ID. |
| `BrandedId<T>` | type helper | The brand pattern for downstream type definitions. |

## 4. Threat model

| Threat | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |
| Runtime code creeps in | Low | Low (build bloat; not security per se) | `tsc` emit verification | Trust check |
| `BrandedId` becomes leaky | Low | Low (lose type safety) | Brand pattern reviewed at each use | Covered by code review |
| Address case-sensitivity confusion (checksum vs lowercase) | Low | Low (UX, not security — downstream compares case-insensitively) | Document in consumers | Documented |

## 5. Findings (open)

| ID | Severity | Finding | Status | Notes |
| --- | --- | --- | --- | --- |
| **TYP-1** | P3 | No `expectTypeOf` tests asserting the branded type behaviour. | Open | Property of the type system, but a tiny vitest spec would lock the brand against accidental erosion. |

## 6. Test posture

- No unit tests today (type-only package).
- Cross-package: every other package imports this; their test suites are the de facto coverage.
- **Gap:** TYP-1 — no `expectTypeOf` lock.

## 7. Hardening backlog

- [ ] **(TYP-1)** Add a single `expectTypeOf` test that proves `BrandedId<'X'>` rejects plain `string` assignment.
- [ ] **(system M4)** Add this package to the future public-API type-lock CI step.

## 8. External audit readiness

- `pnpm typecheck` (no `pnpm test` needed for type-only package).
- Source: `src/index.ts` (currently 4 type definitions, ~10 lines).
- This is the lowest-risk package in the workspace; an auditor can verify it in minutes.

## 9. Accepted limitations / scope exclusions

- Type-only by design.
- No runtime exports.
- Should NEVER become a `shared` or `utils` package — per repo CLAUDE.md doctrine.
