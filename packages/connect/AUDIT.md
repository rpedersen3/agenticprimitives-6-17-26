# `@agenticprimitives/connect` — Security & Architecture Audit

**Status:** alpha
**Last refreshed:** 2026-05-30
**Owners:** connect package CODEOWNERS
**System audit cross-reference:** [docs/audits/2026-05-packages-contracts-production-readiness.md](../../docs/audits/2026-05-packages-contracts-production-readiness.md)

## 1. Charter

Owns the **Agentic Connect** broker primitives (spec 224 / ADR-0014):
- `mintIdToken` / `verifyIdToken` — server-minted OIDC-shaped tokens.
- `verifyAgentSession` — agent-session verification with `aud` / `iss` / `exp` binding.
- `importJwks` — JWKS loader for relying-app verification.
- `issueForResolution` — convergence over directory resolution (`0 → bootstrap`, `1 → issue`, `many → disambiguate`).

What this package does NOT own:
- The credential ceremony (passkey / SIWE / Google OIDC) → `connect-auth`.
- Directory resolution itself → `identity-directory` + `identity-directory-adapters`.
- Session storage / row shape → `delegation` (per ADR-0002).
- The broker's signing key — consumer wires from KMS or env at app layer.

## 2. Security invariants (DO NOT BREAK)

1. **`verifyIdToken.expectedAud` is REQUIRED.** Tokens issued for one audience must not verify for another. (PKG-CONNECT-001-sec — H7-B.4 will tighten `verifyAgentSession.expectedAud` to also-required.)
2. **`alg` lock at verify time.** ES256 + EdDSA only. Anything else (RS256, none) MUST fail. Test: `test/unit/token.test.ts` (extend per PKG-CONNECT-003).
3. **`exp` checked AND `iat` + clock skew checked.** PKG-CONNECT-002 currently open — `verifyAgentSession` lacks `iat` lower bound; add.
4. **JWKS `kid` matched + key reused** — no per-call refetch unless `kid` miss (cache-first).
5. **Convergence `kind: 'many'` MUST bound the array** — PKG-CONNECT-004; cap at deployment-config max.

## 3. Public API surface (audit scope)

See `src/index.ts` + `capability.manifest.json:publicExports`.

## 4. Known findings (cross-reference to system audit)

- **PKG-CONNECT-001-sec** — `verifyAgentSession.expectedAud` optional → must become required. H7-B.4.
- **PKG-connect-001-arch** — `mintIdToken` lacks `BoundMintIdTokenInput` shape. Add `enrollmentGrantId` + `delegationHash`. H7-B.5.
- **PKG-CONNECT-002** — no `iat` / `nbf` clock-skew check.
- **PKG-CONNECT-003** — `importJwks` silently drops mis-`alg` entries. Should return `{ keys, skipped }`.
- **PKG-CONNECT-004** — unbounded `kind: 'many'` array.
- **PKG-connect-002** — missing AUDIT.md (this doc closes).
- **PKG-connect-003** — coverage gap: 248 test LoC vs 532 src LoC; negative-test matrix missing.

## 5. Test posture

- Unit tests for `mintIdToken` happy path + `verifyIdToken` core.
- Missing matrix: alg confusion, kid mismatch, expired, audience mismatch, clock skew. Add in H7-B / H7-D.

## 6. Pre-publication checklist

- [x] License + AUDIT.md (H7-A).
- [ ] `BoundMintIdTokenInput` shape (H7-B.5).
- [ ] `verifyAgentSession.expectedAud` required (H7-B.4).
- [ ] Negative-test matrix.
- [ ] Convergence array cap config-pinned.
