# `@agenticprimitives/identity-directory` — Security & Architecture Audit

**Status:** alpha (Phase 1 — indexer + on-chain confirm pattern; not on critical authority path at v0.1)
**Last refreshed:** 2026-06-01 (R9 substrate coverage references + R11.1 fail-hard audit + R11.3 public-surface cleanup)
**Prior refresh:** 2026-05-30
**Owners:** identity-directory package CODEOWNERS
**System audit cross-reference:** [docs/audits/2026-05-packages-contracts-production-readiness.md](../../docs/audits/2026-05-packages-contracts-production-readiness.md)

## R9 substrate coverage (2026-06-01)

- Read model — composes naming + profile + relationships. No direct on-chain claims; locked transitively via the upstream packages' R9 coverage. See [audit-evidence-index.md](../../docs/audits/audit-evidence-index.md).

## 1. Charter

Owns the directory resolution surface (spec 223):
- `resolveCredentialToSubject` — credential facet → canonical SA address (CAIP-10).
- `Resolution` + `Evidence` types — aggregation over multiple adapter results.
- Adapter port: `IdentityDirectoryAdapter` (consumed by `identity-directory-adapters`).
- Indexer-proposes + on-chain-confirms pattern (CN-6 floor).

What this package does NOT own:
- The credential ceremony → `connect-auth`.
- The adapter implementations themselves → `identity-directory-adapters`.
- Issuance / convergence over results → `connect`.
- The on-chain confirmation source itself (read via viem at app layer).

## 2. Security invariants (DO NOT BREAK)

1. **Indexer proposes; chain confirms.** Per ADR-0014 + CN-6: a resolution result without an on-chain-confirmed `Evidence` MUST NOT bubble up as `onchain-confirmed`.
2. **Non-EVM gate** (CN-8) — adapters returning non-EVM CAIP-10 subjects must be flagged + handled by the consumer.
3. **No silent fallback** between adapters (ADR-0013). Empty resolution is an answer, not a trigger.
4. **Cardinality aggregation is deterministic.** `Resolution.kind` ∈ {`none`, `one`, `many`}; tie-breakers fail-closed.

## 3. Public API surface (audit scope)

See `src/index.ts` + `capability.manifest.json:publicExports`.

## 4. Known findings (cross-reference to system audit)

- **PKG-identity-directory-001** — missing AUDIT.md (this doc closes).
- **PKG-identity-directory-002** — coverage gap (149 vs 303 src LoC); aggregation matrix tests insufficient. H7-D add.
- **PKG-IDENTITY-DIRECTORY-001** (sec) — architecture locked to spec 223; not deeply inspected at v0.1.

## 5. Test posture

- Unit tests for the aggregation core.
- Missing: full cardinality × evidence-shape matrix.

## 6. Pre-publication checklist

- [x] License + AUDIT.md.
- [ ] Aggregation matrix tests.
- [ ] Adapter port frozen.
