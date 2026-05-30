# `@agenticprimitives/ontology` — Security & Architecture Audit

**Status:** experimental (v0.1 — package-boundary question per XPKG-004-arch)
**Last refreshed:** 2026-05-30
**Owners:** ontology package CODEOWNERS
**System audit cross-reference:** [docs/audits/2026-05-packages-contracts-production-readiness.md](../../docs/audits/2026-05-packages-contracts-production-readiness.md)

## 1. Charter

Owns the off-chain ontology context + SHACL shape artifacts (spec 226 family):
- A-box / T-box / C-box JSON-LD contexts.
- SHACL shape definitions consumed by `identity-directory` for typed profile validation.
- Browser-safe core + Node-only `./artifacts` subpath split.
- Zero `@agenticprimitives/*` deps; pure static-artifact + helper package.

What this package does NOT own:
- The on-chain ontology registries (`OntologyTermRegistry`, `ShapeRegistry`) — those live in `packages/contracts/src/ontology/`.
- Vocabulary tagging at the runtime layer → app config.

## 2. Security invariants (DO NOT BREAK)

1. **Browser-safe core.** No `node:fs`, `node:path`, etc. in `src/index.ts`. Node-only access goes through `./artifacts` subpath.
2. **Static artifacts are immutable per release.** Bumping a shape MAJOR-bumps this package (changesets, H7-E.3).
3. **No vendor PII in any artifact.** Verified by `check:no-domain-in-packages` + `check:forbidden-terms` (ADR-0021).
4. **Shape decoding is fail-closed.** Unknown predicates / malformed shapes MUST NOT default to `valid`.

## 3. Public API surface (audit scope)

See `src/index.ts` + `capability.manifest.json:publicExports` (top-level + `./artifacts` subpath).

## 4. Known findings (cross-reference to system audit)

- **PKG-ontology-001** — package-boundary justification thin at v0.1; only one internal consumer (`identity-directory`). Per spec 100 §2, only "static-artifact + zero deps" branch of S3 supports the split. Revisit when second consumer appears.
- **PKG-ontology-002** — missing AUDIT.md (this doc closes).
- **PKG-ontology-003** — `./artifacts` subpath split correct; informational.

## 5. Test posture

- Unit tests around shape loading + context resolution.
- Missing: golden-vector tests against published JSON-LD context.

## 6. Pre-publication checklist

- [x] License + AUDIT.md.
- [ ] Golden-vector test on context hash.
- [ ] Boundary revisit at v0.1 (second consumer triggers OR fold into `identity-directory`).
