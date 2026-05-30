# `@agenticprimitives/connect-auth` — Security & Architecture Audit

**Status:** alpha
**Last refreshed:** 2026-05-20
**Owners:** connect-auth package CODEOWNERS
**System audit cross-reference:** [docs/architecture/product-readiness-audit.md](../../docs/architecture/product-readiness-audit.md)

## 1. Charter

User-authentication primitives. Owns: JWT-cookie session minting +
verification (`mintSession`, `verifySession`, `SESSION_COOKIE`), CSRF
helpers (`csrfTokenFor`, `verifyCsrf`), salt-derivation helpers
(`deriveSaltFromLabel`, `deriveSaltFromEmail`), the `Signer` interface
family (`Signer`, `PasskeySigner`, `EOASigner`, `KMSSigner`), and the
auth-method subpaths: SIWE, passkey (WebAuthn ceremony + struct
builder + COSE parser), and Google OAuth (stub). Also owns the
universal-signature-validator client helpers (`verifyUserSignature`,
`verifyUserSignatureView`, `isErc6492Wrapped`) consumers use to delegate
on-chain verification.

What this package does NOT own (per its `CLAUDE.md`):
- Concrete KMS signers (`key-custody`).
- Smart-account state (`agent-account`).
- Delegation primitive (`delegation`).
- HTTP routing, cookie I/O, DB adapters (consumer territory).

## 2. Security invariants (DO NOT BREAK)

1. **JWT secret never logged.** Errors in session verification must
   redact the secret. Tests: `test/unit/sessions.test.ts` (11 tests).
2. **CSRF cookie + header are HMAC-bound to the JWT session.** A token
   minted for session A is invalid against session B. Test:
   `test/unit/csrf.test.ts` (7 tests).
3. **CSRF origin allowlist is exact-match URL parse**, never substring.
4. **Passkey WebAuthn challenges MUST be one-shot** (replay-protected
   via nonce in production). Currently the demo replays implicit by
   re-running the ceremony per call; the on-chain JTI handles replay
   at the delegation level. Production should bind a per-action nonce.
5. **Salt derivation is deterministic + uses keccak**, never raw labels.
6. **Constant-time HMAC compare** in CSRF + JWT-signature verify.
7. **`PasskeyAssertion`'s low-s normalization is applied.** Many
   authenticators emit high-s; the on-chain RIP-7212 accepts both, but
   off-chain verifiers (e.g. some EVM precompile-less paths) require
   low-s. Test: `test/unit/passkey.test.ts` — `normaliseLowS` boundary.
8. **`verifyUserSignature` falls back to `view` when `simulateContract`
   is unavailable.** Documented in `verify-signature.ts` JSDoc.

## 3. Public API surface (audit scope)

| Symbol | Kind | Trust boundary |
| --- | --- | --- |
| `mintSession`, `verifySession`, `SESSION_COOKIE`, `SESSION_TTL_SECONDS` | functions / consts | JWT minting + verification. |
| `csrfTokenFor`, `verifyCsrf` | functions | CSRF token binding to session. |
| `deriveSaltFromLabel`, `deriveSaltFromEmail` | functions | CREATE2 salt derivation. |
| `Signer`, `PasskeySigner`, `EOASigner`, `KMSSigner` | types | Architectural contract consumed by `agent-account`, `delegation`. |
| `verifyUserSignature`, `verifyUserSignatureView`, `isErc6492Wrapped`, `universalSignatureValidatorAbi`, `ERC1271_MAGIC`, `ERC6492_MAGIC`, `VerifyUserSignatureArgs`, `UniversalValidatorClient` | functions / consts / types | Universal validator client. |
| `JwtClaims`, `AuthenticatedUser`, `AuthMethod` | types | Shared shapes. |
| Subpath `./siwe`: `buildMessage`, `parseMessage`, `verify`, `verifyOnchain`, `parseAndValidate` | functions | SIWE message handling — `verifyOnchain` is the signer-agnostic path. |
| Subpath `./passkey`: full WebAuthn ceremony surface (`buildWebAuthnAssertion`, `parseAttestationObject`, `parseDerSignature`, `normaliseLowS`, `base64urlEncode/Decode`, `hashToWebAuthnChallenge`, `P256_N`) | functions / consts / types | WebAuthn ceremony. |
| Subpath `./google` | functions | **Stub** — throws. |

## 4. Threat model

| Threat | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |
| JWT secret leaked via error message | Low | Critical (forge sessions) | Redaction in error paths; test for redaction | Covered |
| CSRF bypass (no header / wrong session) | Medium | High (state-changing browser requests) | HMAC-bound token | Helpers exist; **H1** open — not wired into demo-a2a routes |
| CSRF origin substring-match bypass | Low | High | Exact-match URL parse | Covered |
| WebAuthn challenge replay | Low | High (delegation replay) | JTI in MCP; per-action challenge derived from action hash | Covered indirectly via JTI; bind per-action nonce in product |
| Salt collision (two users → same address) | Low | Medium | keccak-derived | Covered |
| Constant-time compare violated | Low | High | `crypto.timingSafeEqual` / equivalent | Verified in existing tests |
| Google auth method called when stub | Low | Low (loud failure) | Throws "not implemented" | **Open: H4 partial** |

## 5. Findings (open)

| ID | Severity | Finding | Status | Notes |
| --- | --- | --- | --- | --- |
| **H1** (system) | P1 | CSRF helpers not enforced on demo-a2a mutating routes. | Open | This package ships the helpers; integration is consumer-side. **Top-5 hardening pass.** |
| **H4** (system) | P2 | Google auth method is a stub. | Open | Either implement or remove from `index.ts`. |
| **IA-1** | P3 | `PasskeyAssertion` legacy type vs `WebAuthnAssertion` structured type — naming is confusing. | Documented | `PasskeyAssertion` is the raw browser response (authenticatorData, clientDataJSON, signature); `WebAuthnAssertion` is the structured on-chain form. Comments call this out; spec 200 should too. |
| **IA-2** | P3 | No property test for salt-collision-resistance. | Open | A random-input fuzz over `deriveSaltFromLabel` would catch encoding regressions. |

## 6. Test posture

- **Unit:** 7 files, 68 tests as of 2026-05-20:
  `csrf.test.ts` (7), `passkey.test.ts` (19), `salt.test.ts` (7),
  `sessions.test.ts` (11), `siwe.test.ts` (9),
  `verify-signature.test.ts` (15), `auth-flow.test.ts` (3 integration).
- **E2E:** Playwright `02-siwe-login.spec.ts`, `05-passkey-login.spec.ts` exercise the SIWE + WebAuthn paths against running anvil + workers.
- **Gaps:**
  - No live test for CSRF (the helpers exist but aren't wired).
  - No property test (IA-2).
  - No type-lock for the public `Signer` interface (the architectural contract; downstream packages depend on its shape).

## 7. Hardening backlog

- [ ] **(H1)** Wire CSRF middleware in demo-a2a. This package's helpers are correct; consumer-side wiring is the gap. Top-5 pass.
- [ ] **(H4)** Implement Google OAuth OR remove the export. Mark experimental until a real implementation lands.
- [ ] **(IA-1)** Document the `PasskeyAssertion` (raw) vs `WebAuthnAssertion` (structured) distinction in `specs/200-connect-auth.md`.
- [ ] **(IA-2)** Add property test for `deriveSaltFromLabel`.
- [ ] **(system C3)** Emit audit events from `mintSession` / `verifySession` / SIWE `verifyOnchain` failures.

## 8. External audit readiness

An external auditor evaluating this package needs:

- `pnpm build` + `pnpm test` (68 tests)
- `specs/200-connect-auth.md`
- This audit doc + system audit
- Source: `sessions.ts`, `csrf.ts`, `salt.ts`, `verify-signature.ts`, `methods/passkey.ts`, `methods/siwe.ts`
- Notable test vectors: golden SIWE messages in `test/unit/siwe.test.ts`; passkey CBOR fixtures in `test/unit/passkey.test.ts`
- Cross-reference: `UniversalSignatureValidator.sol` (on-chain side of `verifyUserSignature`)

## 9. Accepted limitations / scope exclusions

- Does NOT implement concrete KMS-backed signers (`key-custody`).
- Does NOT issue delegation tokens or run policy (`delegation`, `tool-policy`).
- Google auth method is a stub.
- Does NOT manage HTTP framework — consumers wire the helpers into their own router.
- Forbidden imports: `apps/*`, any other `@agenticprimitives/*` package (this is a base; others depend on us).
