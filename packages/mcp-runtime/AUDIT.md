# `@agenticprimitives/mcp-runtime` — Security & Architecture Audit

**Status:** alpha
**Last refreshed:** 2026-06-01 (R9 substrate coverage references + R11.1 fail-hard audit + R11.3 public-surface cleanup)
**Prior refresh:** 2026-05-20
**Owners:** mcp-runtime package CODEOWNERS
**System audit cross-reference:** [docs/architecture/product-readiness-audit.md](../../docs/architecture/product-readiness-audit.md)

## R9 substrate coverage (2026-06-01)

- **R8.1 + R11.1 substrate changes:**
  - **R8.1** — `withDelegation` is now production-strict at the TYPE level via TS function overloads + discriminated union (`ProductionWithDelegationOpts` requires `classification` + `auditSink`; `DevelopmentWithDelegationOpts` requires `developmentMode: true`). Forgetting either in production is a compile error AND a runtime throw.
  - **R11.1 fail-hard audit propagation.** Removed `try/catch` swallowing at 5 sites: `withDelegation`'s emit, `verifyDelegationForResource`'s emit, and all 3 `service-mac.{issue, reject, accept}` emit sites. Caller's sink composition (`composeSinks` fail-soft vs `composeFailHardSinks` fail-hard) now determines failure behavior.
  - Tests: `packages/mcp-runtime/test/unit/with-delegation.test.ts::R11.1` + `service-mac.test.ts::R11.1` (4 R11.1 tests).
- Downstream of: `delegation.verifyDelegationToken` (R11.1) + `tool-policy.evaluatePolicy` (N8 closure).

## 1. Charter

The MCP server-side request boundary. Owns: the `withDelegation`
middleware that wraps an MCP tool handler with delegation-token
verification, JTI store adapters (`createMemoryJtiStore`,
`createD1JtiStore`), the `declareResource` metadata helper, and the
`RequestContext` shape passed to wrapped handlers. **Cross-delegation
(`withCrossDelegation`, `verifyCrossDelegationForResource`) was removed
from the public surface in H7-B.8** (XPKG-002 / EXT-024 closure); it
will resurface behind `./experimental` per spec 100 §6 when the
cross-delegation work resumes.

Per its `CLAUDE.md`: imports `types`, `delegation`, `key-custody` (for
MAC primitives — not yet wired), `tool-policy`.

What this package does NOT own:
- Delegation core (`delegation`).
- Concrete KMS or AAD primitives (`key-custody`).
- Tool taxonomy / risk tiers (`tool-policy`).
- HTTP routing — consumers wire `withDelegation` into their own MCP
  server (e.g. demo-mcp uses Hono).

## 2. Security invariants (DO NOT BREAK)

1. **JTI is consumed atomically before handler runs.** The store
   must `INSERT ... ON CONFLICT ... RETURNING` so a replayed JTI
   loses the race and the handler is never invoked. Test:
   `test/unit/jti-stores.test.ts` (4) + the D1 atomic-insert pattern.
2. **Delegation verification failures map to a single external error
   shape.** Callers do not learn whether the failure was bad signature,
   bad JTI, bad caveat, or expired token. Test:
   `test/unit/with-delegation.test.ts` (4).
3. **The wrapped handler never sees an invalid delegation.** Either
   `verifyDelegationToken` returns ok and the handler runs, or the
   middleware short-circuits with a 401.
4. **MemoryJtiStore is process-local and test-only.** Production must
   use `createD1JtiStore` or equivalent. The factory does not validate
   this; consumers must (system **L2**).
5. **Service-to-service MAC will be load-bearing.** Once wired, every
   incoming MCP request must carry a MAC envelope verified against
   audience + route family + nonce. Currently NOT enforced — system
   **C1** open.
6. **`withCrossDelegation` was removed from the public surface (H7-B.8 / XPKG-002).** Returned "not implemented"; do
   not call it expecting the cross-delegation invariant. System **H5**.
7. **Policy enforcement is required**, not optional, but currently NOT
   wired. The middleware should call `tool-policy.evaluatePolicy()` and
   fail closed on deny. System **H2** open.

## 3. Public API surface (audit scope)

| Symbol | Kind | Trust boundary |
| --- | --- | --- |
| `withDelegation` | function | The MCP-server request boundary; verifies delegation token. |
| ~~`withCrossDelegation`, `verifyCrossDelegationForResource`~~ | — | **Removed from public surface in H7-B.8** (XPKG-002 / EXT-024). Will resurface behind `./experimental` per spec 100 §6 when implemented. |
| `declareResource` | function | Resource metadata helper (compile-time only). |
| `createMemoryJtiStore`, `createD1JtiStore` | factory | JTI store adapters. |
| `RequestContext` | type | Passed to wrapped handlers; carries principal address. |

## 4. Threat model

| Threat | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |
| Replay of delegation token | Medium | High (unauthorized tool call) | Atomic JTI consumption | Covered |
| Information leak via error messages | Medium | Low (auth probe) | Single external error shape | Covered |
| Policy-classified tool runs without policy check | High when scaled (multi-tool MCP) | High | `tool-policy.evaluatePolicy()` call | **Open: H2** |
| Replay across MCP servers (no audience binding) | High | High | MAC envelope with audience + route family | **Open: C1** |
| Memory JTI store accidentally used in production | Low (loud bug eventually) | High | Doc + production preflight | **Open: L2 / part of C4** |
| Cross-delegation forgery via stub | Low (returns "not implemented") | N/A | Stub returns error | **Open: H5** |

## 5. Findings (open)

| ID | Severity | Finding | Status | Notes |
| --- | --- | --- | --- | --- |
| **C1** (system) | P0 | Service-to-service MAC not load-bearing. | **CLOSED 2026-05-20** | `verifyServiceMac` + `generateServiceMac` shipped; demo-mcp Hono middleware verifies before delegation parse. 18 unit tests cover happy path + tamper + audience/route/body mismatch + clock skew + replay + wrong-key. Production must set `A2A_MAC_SECRET` (or swap to GCP HMAC key via `buildMacProvider`). |
| **C3** (system) | P0 | No audit-event emission from `withDelegation`. | **CLOSED 2026-05-20 (pass 5f)** | `withDelegation` + `verifyServiceMac` accept an optional `auditSink` opt and emit `mcp-runtime.with-delegation.{accept,reject}` + `mcp-runtime.service-mac.{accept,reject}`. Accept-side for service-mac added in pass 5f for forensics symmetry — MAC and delegation are separate primitives with separate threat models, so anomaly-detection (accept rate per primitive, missing-pair detection) needs both as distinct rows. demo-mcp wires `composeSinks(console, d1)` with `X-Correlation-Id` stitching across the a2a boundary. |
| **H2** (system) | P1 | `tool-policy.evaluatePolicy()` not called. | **CLOSED 2026-05-20** | `withDelegation` now accepts `opts.classification` and calls `evaluatePolicy` after delegation verify. Fail-closed on `deny` + `requires-consent` (this runtime doesn't host a consent loop). demo-mcp passes `GET_PROFILE_CLASSIFICATION`. |
| **H5** (system) | P1 | `withCrossDelegation` was a public stub. | Mitigated H7-B.8 (XPKG-002 closure: removed from public surface). Re-implementation pending. | Returned not-implemented; now deleted from index.ts + manifest. |
| **L2** (system) | P3 | Memory JTI store is not distributed-safe. | Documented | Test-only; production must use D1. |
| ~~**N16** (system)~~ | ~~P2~~ | ~~Smart-account multi-sig + recovery policy not productized.~~ | **MOSTLY CLOSED 2026-05-20** (phase 6c.4) | This package's slice: `McpResourceVerifyConfig.quorumEnforcer?: Address` (consumer apps wire from deployments JSON); `withDelegation` reads `tool-policy.evaluateThresholdPolicy(classification)` and threads `requiresQuorum` / `requiresAcceptedOnChain` into `delegation.verifyDelegationToken` opts. H2 reconciliation: when `requiresAcceptedOnChain` is set + verify passes, the critical-risk `requires-consent` outcome is satisfied (the on-chain blessing IS the consent loop). `requiresUv` enforcement stays at signer time (UV is a WebAuthn signature flag the wallet sets at sign time; not re-checkable at verify without parsing the assertion). 4 new tests; 32 total in mcp-runtime. |
| **MR-1** | P3 | No live load test for JTI atomic insert under concurrent writers. | Open | The pattern is correct but unverified under D1 contention. |

## 6. Test posture

- **Unit:** 3 files, 28 tests as of 2026-05-20:
  `jti-stores.test.ts` (4), `with-delegation.test.ts` (4),
  `service-mac.test.ts` (20 — adds pass-5f accept-emit + fail-soft sink tests).
- **E2E:** Playwright `04-read-profile.spec.ts` and `05-passkey-login.spec.ts` exercise `withDelegation` end-to-end against the running demo-mcp.
- **Gaps:**
  - No cross-package integration test that exercises `withDelegation` with a synthetic delegation built by `delegation` and a JTI store backed by a real D1.
  - No test of the failure-case audit-event shape (because no audit events emitted yet).
  - No negative test for `withCrossDelegation` shape (acceptable while stub).
  - No load test (MR-1).

## 7. Hardening backlog

- [ ] **(C1)** Add MAC envelope verification at the top of `withDelegation` before any delegation parse, calling `key-custody.buildMacProvider`. Fail-closed on missing/bad MAC. Tests for replay + audience drift.
- [ ] **(H2)** Wire `tool-policy.evaluatePolicy()` after delegation verify; fail-closed on deny or unknown classification metadata. Tests.
- [ ] **(C3)** Emit audit events (accept + reject) including JTI, delegation hash, principal, caveat decisions.
- [ ] **(H5)** Implement `withCrossDelegation` behind `./experimental` (spec 100 §6) once `delegation.verifyCrossDelegation` lands. Negative tests for delegate-binding + data-scope.
- [ ] **(MR-1)** Add a contention test for `createD1JtiStore` (multiple simultaneous inserts of the same JTI).

## 8. External audit readiness

An external auditor evaluating this package needs:

- `pnpm build` + `pnpm test` (8 tests)
- `specs/205-mcp-runtime.md`
- This audit doc + system audit
- Source: `with-delegation.ts` (the request boundary), `jti-stores.ts` (atomic-insert pattern), `with-cross-delegation.ts` (stub)
- Consumer: `apps/demo-mcp/src/index.ts` (the wired-in usage)
- D1 schema for the JTI table (`apps/demo-mcp/migrations/`)

## 9. Accepted limitations / scope exclusions

- Does NOT define the delegation token shape (`delegation`).
- Does NOT define risk tiers (`tool-policy`).
- Does NOT issue tokens — verify only.
- `withCrossDelegation` is a stub.
- MAC envelope verification is not yet wired (C1).
- Policy enforcement is not yet wired (H2).
- Forbidden imports: `apps/*`, `connect-auth` (uses `delegation`'s `Signer` types via type re-export), `agent-account` (delegation handles ERC-1271).
