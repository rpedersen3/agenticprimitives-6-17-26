# `@agenticprimitives/key-custody` — Security & Architecture Audit

**Status:** alpha
**Last refreshed:** 2026-05-20 (pass 5b — audit emit wired)
**Owners:** key-custody package CODEOWNERS
**System audit cross-reference:** [docs/architecture/product-readiness-audit.md](../../docs/architecture/product-readiness-audit.md)

## 1. Charter

Provides concrete KMS backends behind the `Signer` interface from
`connect-auth`. Owns: `A2AKeyProvider` (envelope-encryption of session
data keys), `KmsAccountBackend` (signer abstraction), `LocalAesProvider`

- `LocalSecp256k1Signer` (dev-only), `GcpKmsProvider` + `GcpKmsSigner`
(production HSM-backed), `AwsKmsProvider` + `AwsKmsSigner` (stub),
`canonicalContextBytes` for AAD binding, the MAC provider primitive
(`buildMacProvider`).

What this package does NOT own (per its `CLAUDE.md`):

- The `Signer` interface itself (lives in `connect-auth`).
- Session lifecycle (`delegation.SessionManager`).
- HTTP routing or persistence; backends are stateless.
- Tool-policy decisions or delegation logic.

## 2. Security invariants (DO NOT BREAK)

1. `**LocalAesProvider` MUST fail closed when `NODE_ENV === 'production'`.**
  No fallback to a local-secret-derived key in production. Test:
   `test/unit/local-aes-provider.test.ts`. Consequence if broken:
   production runs with HKDF-from-local-secret session encryption — no
   real key custody.
2. **GCP KMS signer's algorithm guard rejects non-secp256k1 keys.** The
  provider hard-fails if the key's algorithm isn't
   `EC_SIGN_SECP256K1_SHA256`. Test: `test/unit/gcp-signer.test.ts`
   includes the algorithm check. Consequence if broken: a misconfigured
   P-256 key would silently produce non-EVM-compatible signatures.
3. `**GcpKmsProvider` envelope encryption uses AAD.** `Encrypt` /
  `Decrypt` pass `additionalAuthenticatedData` from
   `canonicalContextBytes`. AAD mismatch on decrypt → KMS returns
   "decryption failed". Test: `test/integration/data-key-round-trip.test.ts`.
4. **HMAC keys (when wired) are domain-separated.** `buildMacProvider`
  produces a MAC over a canonical context that includes audience +
   route family — never a raw payload-only HMAC.
5. **No private-key material in env vars in production paths.**
  `A2A_MASTER_PRIVATE_KEY` is tolerated ONLY when
   `A2A_KMS_BACKEND=local-aes` (which itself is dev-only per invariant
   1). The doctrine rail `scripts/check-no-app-private-keys.ts` enforces
   "no privateKeyToAccount in apps/".
6. `**getRelayOnlySigner` is for tx broadcast only.** It must never be
  used to sign user-authority operations.
7. **Per-tool executor isolation is the design.** Was `buildToolExecutorBackend(toolId)` —
   the v0 implementation routed to master silently (system **M2** open / PKG-KEY-CUSTODY-001).
   H7-B.1 made the lie loud: the function now throws with a redirect. The transitional API is
   `buildToolExecutorBackendNoIsolation(toolId, opts)` — refused in production; gated by
   `AP_ALLOW_NO_TOOL_ISOLATION=true` in dev. The production answer is per-tool HKDF mirroring
   `deriveSubjectSigner` (spec 235).

## 3. Public API surface (audit scope)


| Symbol                                                                                   | Kind      | Trust boundary                                                                  |
| ---------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------- |
| `Address`, `Hex`                                                                         | types     | Re-export from `@agenticprimitives/types`.                                      |
| `A2AKeyProvider`, `KmsAccountBackend`, `BuildOpts`, `KmsBackend`                         | types     | Backend contracts consumers (delegation, demo-a2a) depend on.                   |
| `buildKeyProvider`, `buildSignerBackend`, `buildMacProvider` | factories | Select concrete backend by config; failure mode here = misrouted key authority. |
| `buildToolExecutorBackend` | factory (deprecated; throws) | Closed in H7-B.1 (PKG-KEY-CUSTODY-001). Returns nothing usable; redirects via error message. |
| `buildToolExecutorBackendNoIsolation` | factory (dev-only) | Returns master signer (no isolation). Refused in production; opt-in flag required in dev. |
| `getRelayOnlySigner`                                                                     | function  | EOA for broadcasting txs only; not for user-authority signing.                  |
| `createKmsAccount`                                                                       | function  | Adapts `KmsAccountBackend` → viem-shaped account.                               |
| `canonicalContextBytes`                                                                  | function  | AAD derivation — must be deterministic & domain-separated.                      |
| `LocalAesProvider`, `LocalSecp256k1Signer`                                               | classes   | Dev-only; production-guard.                                                     |
| `AwsKmsProvider`, `AwsKmsSigner`                                                         | classes   | **Stub** — `not yet implemented in v0`.                                         |
| `GcpKmsProvider`, `GcpKmsSigner`                                                         | classes   | Production HSM-backed; secp256k1 + symmetric envelope key.                      |


## 4. Threat model


| Threat                                                   | Likelihood                          | Impact                              | Mitigation                                          | Status                           |
| -------------------------------------------------------- | ----------------------------------- | ----------------------------------- | --------------------------------------------------- | -------------------------------- |
| Local secret used in production                          | Medium                              | Critical (no real key custody)      | `NODE_ENV=production` hard-fail in LocalAesProvider | Covered (invariant 1)            |
| Wrong key algorithm (P-256 vs secp256k1) on GCP signer   | Medium                              | High (broken signatures)            | Algorithm guard at provider boot                    | Covered (invariant 2)            |
| AAD bypass on session decrypt                            | Low                                 | High (cross-session key reuse)      | AEAD with AAD via canonicalContextBytes             | Covered                          |
| HMAC key without domain separation                       | High when wired (system C1 open)    | High (replay across audience)       | Domain-separated MAC                                | Design-level only; not yet wired |
| Master key blast radius from tool compromise             | High when at scale (system M2 open) | High                                | Per-tool executor key (TODO)                        | **Open: M2**                     |
| GCP service account over-privileged                      | Medium                              | High (signing + envelope on one SA) | Split into separate SAs                             | **Open: M5 partial**             |
| AWS path returns runtime errors when consumers select it | Low                                 | Low (loud failure)                  | Currently throws                                    | **Open: M1**                     |
| Stale documentation describes provider as stub           | Low                                 | Low (reviewer confusion)            | Drift check                                         | **Open: M6**                     |


## 5. Findings (open)


| ID              | Severity | Finding                                                                                                      | Status     | Notes                                                                                  |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------- |
| **C1** (system) | P0       | Service-to-service HMAC not load-bearing; this package owns the MAC provider but it isn't enforced anywhere. | **CLOSED 2026-05-20** | `mcp-runtime.{generateServiceMac,verifyServiceMac}` now consume `buildMacProvider`. Wired into demo-a2a + demo-mcp; verified end-to-end in Playwright. Production swaps `local-aes` MAC for `gcp-kms` HMAC key via the same factory. |
| **M1** (system) | P2       | AWS KMS backend is advertised but not implemented.                                                           | Open       | Either hide from public API or implement.                                              |
| **M2** (system) | P2       | Per-tool executor keys not isolated.                                                                         | Mitigated H7-B.1; full closure pending  | `buildToolExecutorBackend()` now throws (PKG-KEY-CUSTODY-001 closure). Dev-only `buildToolExecutorBackendNoIsolation` is gated. True per-tool HKDF is the production answer (mirror `deriveSubjectSigner` from spec 235). |
| **M5** (system) | P2       | Local fallback / dev secret names still in production-shaped paths.                                          | Open       | Production preflight (system **C4** top-5) covers part of this.                        |
| **M6** (system) | P2       | Doc drift in `providers/gcp.ts` header (still claims "stub").                                                | Open       | Trivial fix.                                                                           |
| **KC-1**        | P2       | No per-key-permission split between signing SA + encrypt SA.                                                 | Documented | The demo uses one SA for both; production must split per principle of least privilege. |
| **KC-2**        | P3       | `LocalSecp256k1Signer` does not zeroise key material in memory.                                              | Documented | dev-only; acceptable.                                                                  |


## 6. Test posture

- **Unit:** 7 files, 55 tests as of 2026-05-20:
`canonical-context.test.ts` (6), `create-kms-account.test.ts` (4),
`gcp-provider.test.ts` (6), `gcp-signer.test.ts` (20),
`local-aes-provider.test.ts` (10), `local-secp256k1-signer.test.ts` (7 —
adds C3 audit-emit + fail-soft sink tests),
`data-key-round-trip.test.ts` (2 integration).
- **Integration:** `data-key-round-trip.test.ts` covers
`LocalAesProvider` + `GcpKmsProvider` end-to-end (mocked GCP REST).
- **Live smoke:** demo-a2a's `/agent/identity` endpoint is the canonical
smoke test — hitting it proves GCP KMS signing works in production.
- **Gaps:**
  - No test that confirms `NODE_ENV=production` hard-fails LocalAesProvider with the exact expected error message (existing tests check the throw, not the production-shaped envelope).
  - No test for `buildMacProvider` integration since MAC isn't wired anywhere.
  - No live-canary that exercises envelope encryption against the production GCP key on a schedule (N5).

## 7. Hardening backlog

- **(M6)** Fix stale `providers/gcp.ts` header comment that claims the provider is a stub.
- **(C1)** Wire `buildMacProvider` into `mcp-runtime`'s `withDelegation` so MAC verification is load-bearing.
- **(M1)** Decide: implement AWS KMS provider+signer OR remove from `src/index.ts` and `package.json` exports.
- **(M2)** Implement per-tool HKDF (mirror `deriveSubjectSigner` from spec 235) and surface it as a non-throwing replacement for `buildToolExecutorBackend` / `buildToolExecutorBackendNoIsolation`.
- **(KC-1)** Document the "split service accounts" requirement in `specs/203-key-custody.md` + CLAUDE.md.
- **(C3)** **PARTIAL — 2026-05-20.** `LocalSecp256k1Signer` and `GcpKmsSigner` now accept `auditSink` via `BuildOpts.auditSink` and emit `key-custody.sign` on every `signA2AAction` call. Raw sessionId never logged — emit hashes it (`keccak256(sessionId).slice(0,18)`) and surfaces `toolId` / `actionId` from `auditContext`. Fail-soft: sink errors don't propagate. Envelope encrypt/decrypt emission (`LocalAesProvider`, `GcpKmsProvider`) is the remaining slice — tracked as **C3-leftover**.

## 8. External audit readiness

An external auditor evaluating this package needs:

- `pnpm build` + `pnpm test` green (52 tests)
- `specs/203-key-custody.md`
- This audit doc + the system audit
- Source: `providers/gcp.ts` (HSM-backed signer + envelope provider), `providers/local.ts` (dev fallback + production guard), `aad.ts` (AAD derivation), `factories.ts` (backend selection logic)
- GCP IAM setup for the test environment + key-naming convention (documented in spec 120)
- A read of the integration test against a real GCP project (the test currently mocks the REST surface; live integration would need a project credential)

## 9. Accepted limitations / scope exclusions

- Does NOT define the `Signer` interface (that's `connect-auth`).
- Does NOT manage session lifecycles (`delegation`).
- Does NOT define the tool-policy decision (that's `tool-policy`).
- AWS KMS is exported but throws — see M1.
- HMAC MAC primitive exists but not wired into runtime (see C1).
- Forbidden imports: `apps/`*, `delegation`, `mcp-runtime`, `tool-policy`, `agent-account` (would create back-edges).

