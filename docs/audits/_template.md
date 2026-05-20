# `@agenticprimitives/<package>` — Audit Template

This is the canonical template every `packages/<name>/AUDIT.md` follows.

Per the doctrine "each package is a product boundary", an external reviewer
asked to audit one package should be able to do so by reading just that
package's source + its `AUDIT.md`, with cross-references to the
**system-level audit** (`docs/architecture/product-readiness-audit.md`)
for cross-cutting concerns that span packages.

## Required sections

```markdown
# `@agenticprimitives/<package>` — Security & Architecture Audit

**Status:** {alpha | beta | rc | ga}
**Last refreshed:** YYYY-MM-DD
**Owners:** {package CODEOWNERS}
**System audit cross-reference:** [docs/architecture/product-readiness-audit.md](../../docs/architecture/product-readiness-audit.md)

## 1. Charter

What this package owns (one paragraph) + what it explicitly does NOT own.
Cite the package's `CLAUDE.md` "What this package owns" / "What this
package does NOT own" sections.

## 2. Security invariants (DO NOT BREAK)

Bulleted list of the package's load-bearing invariants. These are the
rules that, if violated, compromise the package's promises to consumers.
Each invariant should be:
- specific enough to be testable
- ideally backed by an existing test (cite the test path)
- traced to a downstream consumer if relevant

Example:
- **EIP-712 domain separator is canonical.** Test: `test/unit/hash.test.ts`.
  Consequence if broken: signature verification disagrees with on-chain
  DelegationManager → all delegation flows fail or, worse, accept forged
  delegations.

## 3. Public API surface (audit scope)

List every public export (from `src/index.ts` and subpath exports).
For each: one-line "what does it do" + "what's the trust boundary".

| Symbol | Kind | Trust boundary |
| --- | --- | --- |
| `mintSession` | function | Mints signed JWT; the server holds the secret. |
| `verifySession` | function | Verifies + parses; constant-time HMAC compare. |
| ... | ... | ... |

## 4. Threat model

Per-package threats. Cross-references to system audit for cross-cutting
risks (e.g. "see system audit C1 for the service-to-service HMAC gap
that affects how this package's exports are consumed in production").

| Threat | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |

## 5. Findings (open)

Reference the system audit's finding IDs (C1, H3, N2, etc.) for items
that this package owns. Add package-local findings prefixed with the
package's short name (e.g. `IA-1` for identity-auth's first local
finding) for issues that are too narrow to surface at the system level.

| ID | Severity | Finding | Status | Notes |
| --- | --- | --- | --- | --- |

## 6. Test posture

What's covered, what's missing.

- **Unit tests:** `test/unit/` count + coverage areas
- **Integration tests:** `test/integration/` count + coverage areas
- **Cross-package tests:** which other packages exercise this one
- **Forge tests (if applicable):** for contract-adjacent packages
- **E2E tests:** which Playwright specs exercise this surface
- **Gaps:** explicit list of un-tested invariants

## 7. Hardening backlog

Prioritized list of work to close findings. One line each, linking back
to finding IDs.

- [ ] (H1) wire CSRF middleware on demo-a2a routes consuming this package
- [ ] (IA-2) add property test for salt-collision-resistance

## 8. External audit readiness

What an external auditor would need from this package to evaluate it
end-to-end:

- A reproducible build (`pnpm build`)
- Test runner (`pnpm test`)
- Spec doc (`../../specs/<NNN>-<package>.md`)
- This audit doc
- Open findings list (from this doc + the system audit)
- Threat model rationale (this doc, §4)
- Code coverage report (TODO if not generated)

## 9. Accepted limitations / scope exclusions

What this package deliberately does NOT do. Cross-reference the
forbidden-imports manifest entries and the CLAUDE.md "drift triggers".
```

## When to update a per-package AUDIT.md

- Any PR that changes the package's public API surface.
- Any PR that fixes a finding in this package OR introduces a new one.
- Any PR that adds/removes a test class that affects the invariant table.
- During the periodic system-audit refresh.

Bump the `Last refreshed:` date in the same PR. CI should reject PRs
that touch `src/index.ts` without touching `AUDIT.md` (TODO: add this
check to `scripts/check-all.ts` once all packages have an audit).
