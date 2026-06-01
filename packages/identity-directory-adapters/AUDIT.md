# `@agenticprimitives/identity-directory-adapters` — Security & Architecture Audit

**Status:** alpha (thin wrapper — ADR-0015 firewall)
**Last refreshed:** 2026-06-01 (R9 substrate coverage references + R11.1 fail-hard audit + R11.3 public-surface cleanup)
**Prior refresh:** 2026-05-30
**Owners:** identity-directory-adapters package CODEOWNERS
**System audit cross-reference:** [docs/audits/2026-05-packages-contracts-production-readiness.md](../../docs/audits/2026-05-packages-contracts-production-readiness.md)

## R9 substrate coverage (2026-06-01)

- Adapter implementations for `identity-directory`. No direct on-chain claims; the adapters consume the same `agent-naming` + `agent-profile` + `agent-relationships` substrate covered above.

## 1. Charter

Concrete `IdentityDirectoryAdapter` implementations consumed by `@agenticprimitives/identity-directory`. Per **ADR-0015**, adapters live in their own package so the directory core stays vendor-/transport-agnostic.

What this package does NOT own:
- The `IdentityDirectoryAdapter` interface itself → `identity-directory`.
- Aggregation / convergence over multiple adapters → `identity-directory`.
- Credential ceremonies → `connect-auth`.

## 2. Security invariants (DO NOT BREAK)

1. **Adapters MUST be deterministic in semantics.** Same input → same kind of evidence row (the underlying source may rotate state, but adapter logic is fixed).
2. **No silent fallback inside a single adapter** (ADR-0013). An adapter that fails reports failure; aggregation is the consumer's responsibility.
3. **Adapters return CAIP-10 subjects, not raw addresses.** Verify on every adapter.
4. **No PII leakage in error messages** — McpAuthError-style (PKG-MCP-RUNTIME-003 family).

## 3. Public API surface (audit scope)

See `src/index.ts` + `capability.manifest.json:publicExports`.

## 4. Known findings (cross-reference to system audit)

- **PKG-identity-directory-adapters-001** — missing AUDIT.md (this doc closes).
- **PKG-identity-directory-adapters-002** — thin-wrapper risk; 176 LoC. Acceptable per ADR-0015 firewall; flag for v0.1 revisit.

## 5. Test posture

- Per-adapter unit tests; integration test against `identity-directory` core.
- Missing: failure-mode matrix per adapter.

## 6. Pre-publication checklist

- [x] License + AUDIT.md.
- [ ] Per-adapter failure-mode matrix.
- [ ] PII-error split (cross-cuts with PKG-MCP-RUNTIME-003 / F1).
