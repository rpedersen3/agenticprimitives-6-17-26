# Packages + Contracts Production-Readiness Audit

| Field | Value |
|---|---|
| **Date opened** | 2026-05-30 |
| **Scope** | `packages/*` source + `packages/contracts/{src,test,script}` ONLY. Demo apps and any specs that describe app integration (spec 234 white-label, spec 236 JP adoption, spec 232/229/230§6) are **explicitly out of scope**. |
| **Trigger** | User-requested focused audit: *"I am purely interested in building a production ready set of packages and Ethereum contracts and want a critical audit of that material."* |
| **Method** | Two specialist sub-audits run in parallel — `security-auditor` (per-package source review + Foundry contract review; ~430 lines of findings) + `technical-architect-auditor` (doctrine sweep + dependency-graph + manifest verification + CI/build/publish posture; ~415 lines). Forge test suite (358/358 pass) and `forge coverage --ir-minimum` executed inside the architecture audit. **2026-05-30 update:** a third external review (life-safety-context CTO lens) was integrated — its in-library findings appear as `EXT3-*` rows in §4. |
| **Companion docs** | `docs/audits/2026-05-pre-production-readiness.md` (the original audit, which is **app-focused**; out-of-scope under this lens, but each row is reclassified in §6 below). `docs/audits/threat-model.md`, `evidence-checklist.md`, `architecture-diagram.md` (still stale per ARCH-005). |
| **Execution plan** | [`docs/hardening-waves/H7-packages-contracts.md`](../hardening-waves/H7-packages-contracts.md) — the consolidated wave plan that closes the rows in this doc. |
| **Status** | Living tracker — opened 2026-05-30. Body tally (2026-05-31, post-R5.2): **45 CLOSED / 2 ACCEPTED / 145 OPEN** of 193 findings. **ZERO Critical findings remain OPEN.** R1 closed CROSS-STACK-001 + CON-AgentAccount-003 + XCON-003. R3.1 flipped 8 stale H7 closures (KEY-CUSTODY-001/-002, DELEGATION-001/-002, CONNECT-001-sec, WEBAUTHN-001, NAMING-001, P256-001). R3.2 closed PKG-agent-relationships-001 (privacy fork). R3.3 closed CON-DelegationManager-001 (coverage 95.77%). R3.5 closed CON-AgentAccount-001 (coverage 91.25%/84.51%/100%). R5.1 closed PKG-AUDIT-001 (composeSinks split). R5.2 flipped 4 more stale H7 closures: PKG-DELEGATION-003 (TTL ceiling), PKG-MCP-RUNTIME-001 + PKG-mcp-runtime-001 (JTI migrate + verifyCrossDelegation removed), PKG-CONNECT-AUTH-002 (deriveSaltFromEmail secret-required). Top-7 in §1 below regenerated 2026-05-31 (post-R5.2) — only 2 of the original 7 ranks remain OPEN. |

## Status legend

| Symbol | Meaning |
|---|---|
| 🔴 OPEN | Finding active; not yet addressed. |
| 🟡 IN PROGRESS | Wave assigned + work started. |
| 🟢 CLOSED | Patched + verified; remediation logged. |
| ⚪ ACCEPTED | Risk accepted with written justification. |
| 📝 DOC | Documentation-only fix. |

---

## 1. Executive summary

> **Bottom line (security auditor):** *"The library is closer to 'audit-ready' than 'third-party-consumable production-ready'; a customer-grade consumer cannot mitigate items PKG-DELEGATION-001, PKG-CONNECT-AUTH-001, PKG-KEY-CUSTODY-001, CON-NAMING-001, or CON-WEBAUTHN-001 from outside the package without forking."*
>
> **Bottom line (architecture auditor):** *"The off-chain library suite is C+: doctrine is strong, the dep graph is acyclic with no back-edges, the rename mostly held in code, but `check:all` is RED, every package says UNLICENSED, two public exports are unconditional 'not-implemented' errors, and 62 stale `agent-identity` refs leak into the public agent-profile artifacts. The contract suite is C: forge tests all pass but coverage is below external-audit floor on the four most consequential contracts."*

### Top 7 risks a senior reviewer will lead with

*Regenerated 2026-05-31 (post-R3.1). After R3.1 audit-row reconciliation, only one Critical finding remains OPEN — the rest of the top-7 is High-severity. See header Status for the closure tally.*

| Rank | ID | Severity | Component | One-line |
|---|---|---|---|---|
| 1 | ~~**PKG-agent-relationships-001**~~ | 🟢 CLOSED (R3.2) | `packages/agent-relationships/*` | Privacy Fork closure — README top-of-page ⚠ callout; package labelled `"stability": "experimental"`. |
| 2 | ~~**PKG-AUDIT-001**~~ | 🟢 CLOSED (R5.1 / H7-B.7) | `packages/audit/src/index.ts` `composeSinks` | Split into `composeFailSoftSinks` + `composeFailHardSinks` with `composeSinks` kept as fail-soft alias. |
| 3 | ~~**PKG-DELEGATION-003**~~ | 🟢 CLOSED (R5.2 / H7-B) | `packages/delegation/src/token.ts` `mintDelegationToken` | `DEFAULT_MAX_TTL_SECONDS = 60 * 60`, `DEFAULT_MAX_USAGE_LIMIT = 100`, `acceptElevatedRisk: boolean` opt-in. |
| 4 | **PKG-DELEGATION-004 / PKG-KEY-CUSTODY-003** | 🟠 High — **STILL OPEN** | `packages/delegation/src/token.ts` + `packages/key-custody/src/providers/local.ts:197-244` | No low-s normalization on the EIP-191 sign+recover path or on `LocalSecp256k1Signer.signA2AAction`. Noble defaults to low-s today; invariant undocumented. Future noble bump or `lowS: false` callsite is a silent signature-malleability regression. JTI tracking uses `claims.jti` value (good) so reply-tracking holds, but auditors will flag this. GCP signer already does explicit `normalizeLowS(s)` — local signer should mirror. *(R5.3 wave assigned.)* |
| 5 | ~~**PKG-MCP-RUNTIME-001 / 002**~~ | 🟡 PARTIAL CLOSED (R5.2 / H7-B.6+B.8) | `packages/mcp-runtime/src/{jti-stores.ts, with-delegation.ts, index.ts}` | (a) JTI DDL CLOSED — `migrate()` explicit step; calling `trackUsage` without prior `migrate()` throws. (b) `verifyCrossDelegationForResource` REMOVED from public surface (H7-B.8). (c) `withDelegation`'s `requires-consent` recompute-twice ergonomic issue still open — small refactor, low risk, low priority. |
| 6 | ~~**CON-DEPLOY-001 / XCON-001-sec**~~ | 🟢 CLOSED (R5.4 / 2026-05-31) | `script/Deploy.s.sol` | Hand-off is now a hard precondition: `GOVERNANCE_MULTISIG` env var REQUIRED on production networks; reverts the deploy if unset. Testnet falls back to deployer with multi-line warn. 12 unit tests lock all three branches. (XCON-001 separate row tracks aggregate coverage — that's the contract-coverage push, not the deployer-aggregation issue.) |
| 7 | ~~**PKG-CONNECT-AUTH-002**~~ | 🟢 CLOSED (R5.2 / H7-B.10) | `packages/connect-auth/src/salt.ts` `deriveSaltFromEmail` | Now requires per-deployment `{ secret }` ≥ 16 chars; preimage is `keccak256("${email}:${rotation}:${secret}")`. Address-from-email enumeration vector closed. |

**Replacement entries to consider for ranks 1, 2, 3, 5, 7 (now open):**
- **PKG-KEY-CUSTODY-004** (High) — `findRecoveryByte` writes `digest`/`r`/`s`/`knownPubKey` to `console.error` on failure (info-disclosure via worker logs; fingerprintable).
- **CON-FACTORY-001** (High) — Factory governance set at construction immutable; `setBundlerSigner`/`setSessionIssuer` `onlyGovernance` with no timelock + no multi-sig. Cross-cuts with CT-1.
- **PKG-agent-profile-001** (High) — 62 stale `[agent-identity]` error-message prefixes from the rename to `agent-profile`.
- **CON-AgentAccount-002** (Medium) — 1327 LoC monolith vs spec 209's "thin ERC-7579 core"; next extraction (signature-verification dispatcher → validator module) overdue.
- **XCON-002-sec** (Medium) — No system-wide pause/kill switch at the DelegationManager / Factory level; consumer cannot easily implement "stop new account creation" lever.

**Honorable mentions** (rank 8+ but worth a senior reviewer's attention):
- **PKG-CONNECT-AUTH-002** (High) — `deriveSaltFromEmail(email, rotation)` makes the SA address publicly enumerable from an email; pre-compute target's SA + link addresses across services.
- **PKG-agent-profile-001** (High) — 62 stale `[agent-identity]` error-message prefixes from the rename to `agent-profile`. Sweep `[agent-identity]` → `[agent-profile]`.
- **CON-FACTORY-001** (High) — Factory governance immutable at construction, no timelock, no multi-sig on `setBundlerSigner`/`setSessionIssuer`. Cross-cutting with CT-1.
- **CON-DEPLOY-001 / XCON-001** — Single deployer-EOA controls all governance/roles/TLDs. Aggregation risk; consumer following deploy script as documented inherits it.

### Two more "won't survive an external review" findings

- **CON-DEPLOY-001 / XCON-001** — `script/Deploy.s.sol` deploys all 22 contracts under the same deployer EOA + makes that EOA governance for the factory + paymaster + owner of `.agent`/`demo.agent`/`acme.agent`/OntologyTermRegistry/ShapeRegistry/RelationshipTypeRegistry/AgentProfileResolver. **Single-key compromise = total system takeover.** Already tracked as CT-1; the contract surface itself has no defense.
- **CON-P256-001** — `P256Verifier.sol` dispatcher tries RIP-7212 precompile, on failure silently falls through to `DAIMO_VERIFIER` at the hardcoded address `0xc2b78104907F722DABAc4C69f826a522B2754De4` if that address has code. This is `try fast catch slow` (direct ADR-0013 violation) + an un-version-pinned third-party dependency. If that address is squatted on a fork or upgraded by Daimo with admin keys, every WebAuthn signature check accepts whatever the malicious verifier says.

### Per-package + per-contract scorecard

**Per-package grades** (security + architecture combined):

| Package | Grade | Headline blocker |
|---|---|---|
| `types` | B+ | Zero-tests; add `tsd` fixtures |
| `audit` | B− | `composeSinks` fail-soft on security-critical events; free-string action registry |
| `connect-auth` | B− | Email-derived salt (PKG-CONNECT-AUTH-002 / EXT-030); RPC-vs-invalid conflation |
| `connect` | C+ | `mintIdToken` no bound-mint surface (PKG-CONNECT-001); aud optional (PKG-CONNECT-001-sec) |
| `delegation` | B− | Caveat evaluator default-accepts (PKG-DELEGATION-001); `verifyCrossDelegation` stub |
| `agent-account` | B− | Quorum signature packing duplicated with account-custody; 55% contract coverage drags |
| `account-custody` | B | Missing AUDIT.md; leaf today |
| `key-custody` | **C** | `check:public-exports` RED; `buildToolExecutorBackend` master-leak; AWS provider throws "not implemented" |
| `tool-policy` | B | Lint subpath Node-only; unclassified-tool fail-closed enforcement to verify |
| `mcp-runtime` | C+ | JTI store DDL in hot path; `McpAuthError.reason` PII surface; `verifyCrossDelegationForResource` stub |
| `agent-naming` | B+ | Clean post log-walker removal |
| `agent-profile` | C+ | 62 stale `[agent-identity]` error-message prefixes + doc refs; dist drift |
| `agent-relationships` | **D** | Privacy Fork (EXT-019); mark experimental loudly |
| `ontology` | C | Justify package boundary at v0.1; missing AUDIT.md |
| `identity-directory` | B− | Missing AUDIT.md; thin tests |
| `identity-directory-adapters` | C+ | Thin wrapper; missing AUDIT.md |

**Per-contract grades** (Foundry coverage + role clarity + storage discipline):

| Contract | Grade | Coverage | Headline blocker |
|---|---|---|---|
| `AgentAccount` | C+ | 55% lines / 38% branches | 1327 LoC monolith; spec 209 next extraction overdue |
| `AgentAccountFactory` | A | 100% | Clean shape |
| `DelegationManager` | C | 42% | Worst coverage of any load-bearing contract; SB-1/SB-2 invariants under-tested |
| `CustodyPolicy` | C+ | 70% lines / 30% branches | Stack-too-deep blocks `--via-ir` coverage; matrix coverage needed |
| `SmartAgentPaymaster` | C+ | 52% | Validation-mode matrix under-tested; CT-1 governance aggregation |
| `UniversalSignatureValidator` | A− | 94% | SB-4 closure clean |
| `ApprovedHashRegistry` | A | 100% | Tiny + correct |
| Enforcers (5) | B+ | 75-95% | Per-enforcer AUDIT.md; QuorumEnforcer 95%, others 75-88% |
| **`WebAuthnLib`** | **D** | **16%** | Security-critical P-256 parsing + WebAuthn verification under-tested; also lacks RP-ID / origin / UP / UV checks |
| **`P256Verifier`** | **D** | **0%** | No direct line coverage; Daimo fallback un-version-pinned |
| `SignatureSlotRecovery` | C | 68% / 47% | Signature-format dispatcher under-tested + bounds-check missing on v=0/v=2 paths |
| `MultiSendCallOnly` | B− | 65% | No-value branch uncovered |
| Naming/Identity/Ontology/Relationships | C+ to B− | 50-93% | Acceptable as v0 read-models; flag for closure |

**Aggregate Solidity coverage: 59% lines / 55% statements / 46% branches.** External audit firm bar is typically ≥ 90% lines + ≥ 80% branches.

**Overall:** library suite is **C+**, contract suite is **C**. The repo can publish a **research-grade alpha** today with explicit "experimental, do not adopt in production" labels. To survive a senior architect's review for production-library status, the seven gating items in §1 must close.

---

## 2. Per-package findings

Each finding's source noted as `[SEC]` (security auditor) or `[ARCH]` (architecture auditor). Where the same root issue was surfaced by both, both IDs appear with cross-reference.

### `@agenticprimitives/types`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| PKG-types-001 | Low | `packages/types/package.json` test script | Zero tests (`"echo 'no tests yet' && exit 0"`); add `tsd` fixture to assert brand semantics (`CanonicalAgentId` cannot be constructed without builder). | ARCH | 🔴 OPEN |
| PKG-types-002 | ℹ️ | `packages/types/src/` | Purity intact — no MCP/Cloudflare/Next imports. Clean leaf. | ARCH | 🟢 CLOSED-CONFIRMED |

### `@agenticprimitives/audit`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| PKG-AUDIT-001 / PKG-audit-001 | 🟠 High | `packages/audit/src/index.ts:182-200` `composeSinks` | Fail-soft swallows per-sink errors with only `console.error`; **security-critical events (delegation grant, custody change, signing operations) need durable-before-commit semantics**. Split into `composeFailSoftSinks` (telemetry) vs `composeFailHardSinks` (security-critical; throws on first failure). Spec 214 OP-2 unmet by current API shape. EXT-022 in tracker — re-cast at package level. | SEC + ARCH | 🟢 CLOSED (H7-B.7) — `packages/audit/src/index.ts` now exports both `composeFailSoftSinks` (existing fail-soft behavior, retained for telemetry) and `composeFailHardSinks` (new: every sink still gets a chance to record, but `await write(event)` rejects with the first sink's error if any failed). `composeSinks` is kept as a thin alias of `composeFailSoftSinks` for backward-compat. The header comment of the alias explicitly tells consumers to switch to `composeFailHardSinks` for delegation grants, custody changes, and signing actions — domain-agnostic at the audit layer, with the emitting package documenting which actions belong to the fail-hard class. Manifest publicExports lists all three. Closure marker on the impl: "PKG-AUDIT-001 / EXT-022 / CT-11". |
| PKG-audit-002 | 🟡 Medium | `packages/audit/src/index.ts` | Free-string `action` will drift. Ship canonical `AuditActionRegistry` (dot-notation: `delegation.mint`, `key-custody.sign`, etc.) — schema stays open but emitters get type-checked names. EXT-037 re-cast. | ARCH | 🔴 OPEN |
| PKG-audit-003 | 🟢 Low | `packages/audit/src/index.ts` PII guardrail | `createPiiGuardrailSink` is defense-in-depth, not primary. Doc this in CLAUDE.md (likely already done — verify). | ARCH | 🔴 OPEN |
| PKG-AUDIT-002-sec | 🟢 Low | `packages/audit/src/index.ts:204+` `MetricsSink` interface | Interface has no fail-soft wrapper around `increment/observe/gauge` calls in `withDelegation`. Verified `with-delegation.ts:174-175` wraps in try/catch (good in practice), but not enforced at the interface. | SEC | 🔴 OPEN |

### `@agenticprimitives/connect-auth`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| **PKG-CONNECT-AUTH-001** | 🔴 High | `src/verify-signature.ts:108-147` `verifyUserSignature{,View}` | `catch { return false }` conflates "signature invalid" with "RPC timed out" / "validator contract not deployed". Caller cannot distinguish chain-down from forged-sig. Direct ADR-0013 violation. Caller cannot mitigate without monkey-patching `args.client.readContract`. **Remediation pending — open task for hardening wave:** return `{ ok: true } \| { ok: false, reason: 'invalid' \| 'rpc' }`. | SEC | 🟢 CLOSED (H7-B.3) — `packages/connect-auth/src/verify-signature.ts` now returns the audit-recommended typed result: `{ ok: true } \| { ok: false; reason: 'invalid' } \| { ok: false; reason: 'rpc'; details?: unknown }`. File header documents the closure ("H7-B.3: typed result; chain errors propagate as `reason: 'rpc'` so the caller can distinguish chain-down from forged-sig"). ADR-0013 honored — no silent fallback. |
| **PKG-CONNECT-AUTH-002 / PKG-connect-auth-001** | 🔴 High | `src/salt.ts:22-30` `deriveSaltFromEmail` | Canonical Smart Agent address is a public deterministic function of the user's email. Address-from-email enumeration; cross-product correlation; linkability across services. Contradicts ADR-0010 (SA address IS the canonical identifier — no public function from side-channel identifier to that address). EXT-030 re-cast at the package API surface. | SEC + ARCH | 🟢 CLOSED (H7-B.10) — `packages/connect-auth/src/salt.ts:56-75` now requires a per-deployment `{ secret }` opt (≥ 16 chars) mixed into the keccak preimage: `keccak256(\`${email}:${rotation}:${secret}\`)`. The salt stays deterministic for the deployer (address derivation reproducible) but external parties can no longer enumerate addresses from emails alone. The positional legacy form is removed; callers MUST pass `{ secret }` or get a hard throw with a self-explanatory error. spec 200 §4 updated. Closure marker: "PKG-CONNECT-AUTH-002 / EXT-030". |
| PKG-CONNECT-AUTH-003 | 🟡 Medium (external P1-1) | `src/sessions.ts:108-151` `verifySession` | Does not pin `aud`/`iss`/`sub`; caller MUST do additional checking. Multiple tokens issued for different audiences with the same HS256 key are mutually replayable. Also: `loadKeys()` called inside `verifySession` — caller cannot inject the secret outside of `process.env`. EXT-028 re-cast. | SEC | 🟢 CLOSED (R5.10 / 2026-05-31) — External audit P1-1 closure. `JwtClaims` (src/types.ts) extended with required `iss`, `aud` (string \| string[]), `sid`, optional `nonce`. `mintSession` auto-generates a 16-byte hex `sid` when not supplied. `verifySession(cookie, opts?: VerifySessionOpts)` adds `expectedIss` / `expectedAud` / `clockSkewSec` / `developmentMode` opts. Verifier now (a) cross-checks `claims.iss === expectedIss`, (b) requires `expectedAud` to appear in `claims.aud` (handles string OR string[] per RFC 7519 §4.1.3), (c) rejects future-iat tokens (`iat - skew > now`) with a default 30s skew, (d) applies the same skew to the exp check. **Production gate (mirrors `withDelegation` H1 pattern):** when `NODE_ENV=production` AND `developmentMode !== true`, `verifySession` THROWS if `expectedIss` or `expectedAud` is missing — there is no meaningful way to use the function in production without binding both, and a silent permissive fallback would re-open the audit finding. `DEFAULT_SESSION_CLOCK_SKEW_SEC` constant + `VerifySessionOpts` type exported from `src/index.ts`. The `loadKeys()`-injection sub-finding remains unaddressed in this row (separate row would be opened if/when the consumer-injection refactor lands). 21 new R5.10 tests; 102/102 connect-auth tests green (was 81). Demo-a2a callsites updated. |
| PKG-CONNECT-AUTH-004 | 🟡 Medium (external P1-2) | `src/csrf.ts` | Reads `origin` from the token itself; caller responsible for binding actual request `Origin` header. Tokens not bound to path/method/body/session — a token usable on `POST /transfer` is also usable on `POST /grant-admin`. EXT-029 re-cast. | SEC | 🟢 CLOSED (R5.11 / 2026-05-31) — External audit P1-2 closure. **Breaking API change:** `csrfTokenFor(origin: string)` → `csrfTokenFor(opts: CsrfMintOpts)`; `verifyCsrf(token, allowedOrigins[])` → `verifyCsrf(token, opts: CsrfVerifyOpts)`. The verifier now REQUIRES `actualOrigin` (the inbound `Origin` header or parsed `Referer`) and rejects unless `stamp.origin === actualOrigin AND actualOrigin ∈ allowedOrigins`. The actualOrigin binding is the load-bearing P1-2 fix; the allowlist becomes defense in depth. New optional `method` / `path` / `sessionSid` bindings (CsrfBindings) close the audit's secondary concern — both mint AND verify must agree on these or the verifier rejects, so a token minted for `POST /transfer` cannot be replayed at `POST /grant-admin`. Empty matches empty so legacy origin-only callers stay wire-compatible. **Production gate:** `NODE_ENV=production` + `developmentMode !== true` + empty `actualOrigin` → THROWS with remediation message (mirrors the R5.10 verifySession gate). 16 new R5.11 tests + 7 updated existing csrf tests = 23 csrf tests total; 97/97 connect-auth tests green. New types `CsrfBindings`, `CsrfMintOpts`, `CsrfVerifyOpts` exported from `src/index.ts`. Demo-a2a callsites updated: middleware passes `actualOrigin: reqOrigin ?? ''` with `developmentMode: true` for testnet (spec 227 will tighten); `/auth/csrf` issuer passes `{ origin: parsedOrigin }`. |
| PKG-CONNECT-AUTH-005 | 🟡 Medium | `src/methods/passkey.ts:119-151` `buildWebAuthnAssertion` | Only DECODES the assertion; doesn't verify challenge / rpId / UP/UV flags. JSDoc says "the contract decodes this struct from the signature blob" but exporting a builder named `buildWebAuthnAssertion` strongly implies validated. A consumer wiring an MCP step that signs+stores will not do client-side verification. | SEC | 🔴 OPEN |
| PKG-CONNECT-AUTH-006 | 🟢 Low | `src/methods/passkey.ts:181-236` | `parseAttestationObject` / `parseAuthData` discard `aaguid`; never verified against authenticator allowlist. Production passkey deployments often pin a curated AAGUID list. | SEC | 🔴 OPEN |
| PKG-connect-auth-003 | 🟡 Medium | `src/methods/passkey.ts` raw primitives | `parseAttestationObject`, `parseAuthData`, `normaliseLowS` — correct primitives but senior consumer shouldn't need them to call `mintSession`. Documentation should direct at high-level surface first. | ARCH | 🔴 OPEN |

### `@agenticprimitives/connect`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| **PKG-connect-001 (arch)** | 🔴 High | `packages/connect/src/token.ts:179-207` `MintIdTokenInput` | No `enrollmentGrantId` / `caveatsHash` in the shape. The package surface that exists *invites* the app-level SEC-001/-002 mistakes — any code path with `aud + sub` can mint. **The package didn't help.** Add `BoundMintIdTokenInput` + `verifyEnrollmentGrantBinding` helper. **This is the one finding that should drive a package change from an app-level audit signal — the cleanest fix is in the package.** | ARCH | 🔴 OPEN |
| **PKG-CONNECT-001 (sec)** | 🟠 High | `src/token.ts:121-156` `verifyAgentSession` | `expectedAud` and `expectedIss` are OPTIONAL. If a caller forgets `expectedAud`, the audience is not verified. Token issued for audience-A accepted at audience-B. Contract should be `expectedAud: string` (required). `verifyIdToken` (line 211-217) DOES require these — the AgentSession variant is the regression. | SEC | 🟢 CLOSED (H7-B.4) — `packages/connect/src/token.ts` now declares `expectedAud: string` (required) in the interface and `verifyAgentSession` explicitly rejects when `typeof opts.expectedAud !== 'string' \|\| opts.expectedAud.length === 0` with reason `'expectedAud is required (H7-B.4)'`. Variant parity with `verifyIdToken` restored. |
| PKG-CONNECT-002 | 🟡 Medium | `src/token.ts:152` `verifyAgentSession` | Checks `payload.exp <= nowSec` but not `iat <= now + clockSkew` (no `nbf`/iat check). A future-dated token (clock skew on the broker) is accepted. | SEC | 🔴 OPEN |
| PKG-CONNECT-003 | 🟡 Medium | `src/token.ts:272-287` `importJwks` | Silently skips JWKs whose `alg` isn't `EdDSA`/`ES256`. A JWKS that legitimately contains both broker keys and an RS256 key for a different purpose silently drops the broker keys if a typo flips the alg field. Better: return `{ keys, skipped }`. | SEC | 🔴 OPEN |
| PKG-CONNECT-004 | 🟡 Medium | `src/token.ts` `convergence` | Returns `kind: 'many'` for `agents.length > 1` but does not bound the array. A bug in directory resolution that returns 10k duplicates → unbounded array allocated, then serialized to client. | SEC | 🔴 OPEN |
| PKG-connect-002 | 🟡 Medium | Missing `AUDIT.md` | Spec 100 §8 lists AUDIT.md as required. Missing from `connect`, `account-custody`, `identity-directory`, `identity-directory-adapters`, `ontology`. | ARCH | 🔴 OPEN |
| PKG-connect-003 | 🟢 Low | Coverage | 248 test LoC vs 532 src LoC — vitest passes, but `mintIdToken`/`verifyIdToken` lack negative-test matrix (alg confusion, kid mismatch, expired, audience mismatch). | ARCH | 🔴 OPEN |

### `@agenticprimitives/delegation`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| **PKG-DELEGATION-001** | 🔴 **Critical** | `src/evaluator.ts:42,53,65` `evalValue`, `evalAllowedTargets`, `evalAllowedMethods` | Returns `allowed: true` when context is missing ("context-less; enforced on-chain"). **Boundary trap**: any consumer using `evaluateCaveats` off-chain (MCP gate, A2A pre-check, any non-redeem path) silently permits the call. Verify path: `verifyDelegationToken` in `src/token.ts:545-554` calls `evaluateCaveats` — for tools that don't target a smart-contract call, none of the three "context-less" caveats fire. **Remediation:** require explicit `enforceOnChain: true` opt that callers pass when they will redeem; reject the caveat type otherwise. | SEC | 🟢 CLOSED (H7-B) — strict mode is now the default in `packages/delegation/src/evaluator.ts`. Missing context for `Value`/`AllowedTargets`/`AllowedMethods` returns `allowed: false` with reason `context-required (caveat type is on-chain-only; set EvaluateOpts.enforceOnChain to opt in)`. Callers that genuinely will redeem on-chain (and only those) opt in via `{ enforceOnChain: true }`, which then returns `allowed: true, reason: 'enforced-on-chain'`. |
| PKG-delegation-001 (arch) | 🟠 High | `src/token.ts:668` `verifyCrossDelegation` | Unconditionally returns `{ error: '… lands in v0.1' }`. Re-exported by `src/index.ts:28`. Spec 100 §6 says experimental surface goes behind `./experimental` subpath. Move OR throw OR document `quorum_off_chain_not_implemented` fail-closed contract. EXT-024 re-cast. | ARCH | 🔴 OPEN |
| PKG-DELEGATION-002 | 🟠 High | `src/token.ts:485-490` revocation fail-mode | Resolves `revocationFailMode` to `closed` only when `process.env.NODE_ENV === 'production'`. In Cloudflare Workers, `NODE_ENV` often undefined unless explicitly set. **The pattern should not key off `NODE_ENV` at the library layer; default to `closed` and require explicit `'open'`.** | SEC | 🟢 CLOSED (H7-B) — `packages/delegation/src/token.ts:489` now uses `const revocationFailMode = opts.revocationFailMode ?? 'closed';`. No NODE_ENV branch; library default is fail-closed everywhere (Workers, SES, Node). Callers wanting the permissive behavior set `revocationFailMode: 'open'` explicitly. |
| PKG-DELEGATION-003 | 🟠 High | `src/token.ts:131-230` `mintDelegationToken` | Defaults `ttlSeconds` to 10 min but production ceiling is 60 min. A consumer copying-and-extending from a demo can set TTL up to 1 hour without `acceptElevatedRisk`. 1-hour token with `usageLimit: 100` is real production blast radius. Recommend hard ceiling of 15 minutes and `usageLimit: 10` without `acceptElevatedRisk`. | SEC | 🟢 CLOSED (H7-B) — `packages/delegation/src/token.ts:126-153` now declares `DEFAULT_MAX_TTL_SECONDS = 60 * 60` (1h) + `DEFAULT_MAX_USAGE_LIMIT = 100` as the production ceiling, with `acceptElevatedRisk: boolean` opt-in required to exceed either. The JSDoc on `mintDelegationToken` explicitly tells consumers that LOOSER values require `opts.acceptElevatedRisk: true`. Demo flows that intentionally use longer TTLs document it; the default-path consumer can't accidentally extend the blast radius. |
| PKG-DELEGATION-004 | 🟠 High | `src/token.ts` EIP-191 sign + recover | No low-s normalization on off-chain sign or verify. Not a forgery vector but breaks JTI-replay assumption that token text is unique per call — a malicious holder can produce a second token with the same canonical claims but different signature bytes, both recovering to the same session key. JTI uses `claims.jti` value not token bytes (good), so tracking is fine — but auditors will flag this. | SEC | 🟢 CLOSED (R5.3 / 2026-05-31) — `packages/delegation/src/session-manager.ts:283` now passes `{ lowS: true }` explicitly to `secp256k1.sign`. noble defaulted to low-s before this; the change makes the invariant load-bearing at the call site so a future noble bump or `lowS: false` mistake fails review rather than silently regressing. Comment block at the call site explains the audit lineage. |
| PKG-DELEGATION-005 | 🟡 Medium | `src/token.ts:58-80` `canonicalJSON` | (a) `Number.isFinite(v) ? String(v) : 'null'` silently coerces `NaN`/`Infinity` to `'null'` — asymmetry between sign-time and verify-time canonicalization is a footgun. (b) `Object.keys(obj).sort()` uses default JS string sort; ASCII-only is fine, but non-ASCII claim keys cross-runtime drift possible. | SEC | 🔴 OPEN |
| PKG-DELEGATION-006 | 🟡 Medium | `src/token.ts:632` `verifyDelegationToken` JTI tracking | `jtiStore.trackUsage` is AFTER all chain reads. 100 parallel replays trigger 100 concurrent chain reads BEFORE any JTI store hit. JTI is atomic; but caveat evaluation, ERC-1271 checks, revocation checks fire 100 times. Cap-protected JTI doesn't bound RPC load. | SEC | 🔴 OPEN |
| PKG-DELEGATION-007 | 🟡 Medium | `packages/delegation/src/onchain.ts` revoke | Off-chain SDK may expose a `delegationHash`-only revoke path (deprecated to revert in contract). Review and remove if present. | SEC | 🔴 OPEN |
| PKG-DELEGATION-008 / PKG-delegation-001 | 🟢 Low | `src/token.ts:668-677` `verifyCrossDelegation` | Returns a hard-coded "not implemented" error string. Should be typed error OR throw at module-load when symbol not yet implemented. Cross-ref EXT-024. | SEC | 🔴 OPEN |
| PKG-delegation-002 | 🟠 High | `src/token.ts` `requireQuorumCaveat` quorum-proof shape | Spec 214 OA-3 says `verifyDelegationToken` must refuse caveat-presence as quorum proof; requires explicit `quorumProof`. Verify implemented; verify `_quorumProof` payload binding matches spec 214 SB-1. Add regression test that proves a caveat-only assertion is rejected. | ARCH | 🔴 OPEN |
| PKG-delegation-003 | 🟡 Medium | Strict-mode caveat evaluator (EXT-023) | CLAUDE.md security invariant says fail-closed; verify all caveat-context-missing paths return `deny` not `allow`. Matrix test of every caveat type × missing context field. | ARCH | 🔴 OPEN |

### `@agenticprimitives/agent-account`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| PKG-AGENT-ACCOUNT-001 | 🟡 Medium | `src/client.ts:350-416` `buildCallUserOp` gas | `verificationGasLimit` 500_000n default. On chains with RIP-7212 over-pays; on chains without, not enough (Daimo fallback ~330k + WebAuthn pre-decode ~50-70k → close to ceiling). Per-chain config object would surface this. CT-N4 re-cast. | SEC | 🔴 OPEN |
| PKG-AGENT-ACCOUNT-002 | 🟡 Medium | `src/client.ts` base-fee fallback | `block.baseFeePerGas ?? 100_000_000n` — 0.1 gwei base fee on Ethereum mainnet would underpay; userOp fails to land. Fail-closed instead of guessing. | SEC | 🔴 OPEN |
| PKG-AGENT-ACCOUNT-003 | ℹ️ | `kms-viem-account.ts:79-89` `signTransaction` | Accepts `transaction: any`. EIP-4844 blob tx can't rely on type system to catch incompatible fields. | SEC | 🔴 OPEN |
| **PKG-AGENT-ACCOUNT-005** | 🟠 High (relayer-pattern gap, follow-on to PKG-KEY-CUSTODY-009/010) | Sponsored-deploy invariant missing | Relying brokers that sponsor an SA deploy or sign an action for a client-supplied target SA address have no package-level helper to verify the client's claimed address is the canonical derivation from the verified credential. Demo-a2a's `/session/direct-deploy` (and the Google×KMS bootstrap in demo-sso-next, spec 235) deploy a `body.smartAccountAddress` chosen by the client — a financial DoS / fund-misdirection vector when the broker pays gas. The gate primitive was inlined per-route (or worse, omitted). | SEC + ARCH | 🟢 CLOSED (R5.12c / 2026-05-31) — New `AgentAccountClient.assertSaMatchesCustodianDerivation({ claimed, custodians, mode?, salt?, trustees?, passkey? })` method + exported `SaMismatchError` class. Computes the deterministic SA address via the existing `getAddressForAgentAccount(spec)` (which delegates to the on-chain factory CREATE2 view so TS + Solidity stay in lock-step). Case-insensitive comparison (checksum-agnostic). Defaults match the canonical "SIWE wallet → mode-0 SA" flow (`mode = 0`, `salt = 0n`, no trustees, no passkey); overrides for non-default shapes (mode 1-3 multisig, passkey-direct, custom salt) are first-class opts. Returns the verified address on match; throws `SaMismatchError` (carries `claimed`, `derived`, `spec` for forensics) on mismatch. The same primitive is the spec 235 Google×KMS gate; sharing it across brokers prevents drift. 8 new tests cover: happy path, case-insensitive claimed addr, mismatch throws, error carries forensic fields, default spec is mode=0/salt=0n, non-default overrides honoured, the financial-DoS scenario (client supplies a target derived from a different custodian than the verified one — rejected), and the correct-claim happy path. 67/67 agent-account tests green. New export from `src/index.ts`. |
| **PKG-agent-account-001 / XPKG-008** | 🟡 Medium | `src/quorum.ts` `packSafeSignatures` vs `account-custody/src/quorum-slots.ts` `packQuorumSigs` | Two implementations of same Safe-format slot packing. Drift hazard — single bug fix has to land twice. Consolidate to `account-custody/quorum-slots` (spec 213 carve-out moved custody vocab there). | ARCH | 🔴 OPEN |
| PKG-agent-account-002 | 🟢 Low | `src/index.ts:31-34` comment | Says "the WebAuthn ceremony live in the identity-auth package" — renamed to `connect-auth` half a year ago. Search-and-replace overdue. | ARCH | 🔴 OPEN |
| PKG-agent-account-003 | 🟡 Medium | Test coverage gap | Off-chain library wraps `AgentAccount.sol` (55% Foundry coverage). vitest suite doesn't exercise Wave 2A authority-closure paths. | ARCH | 🔴 OPEN |
| **PKG-agent-account-004** | 🟡 Medium | `test/unit/abis.test.ts` + `test/unit/create-account-from-pk.test.ts` | **Pre-existing test failures discovered 2026-05-30 during H7-A.** `abis.test.ts` expects `createAgentAccount` `inputs[1].type === 'uint32'` but the deployed ABI now has `'uint32[7]'`. `create-account-from-pk.test.ts` expects `call.args[1] === 0` but receives `[0,0,0,0,0,0,0]`. ABI ↔ TS-fixture drift. Verified by stashing all H7-A edits and re-running on master HEAD — same 2 failures reproduce. Fold into H7-D Foundry coverage wave (re-derive fixtures from contract artifacts). | run-time | 🟢 CLOSED (H7-D) — fixtures updated to the deployed ABI shape (`uint32[7]` timelock overrides). |
| **PKG-delegation-004 (sec/arch)** | 🟡 Medium | `packages/delegation/test/unit/eip712-domain.test.ts` (or equivalent — `signTypedData.mock.calls[0]![0].message.caveats[0].args` assertion) | **Pre-existing test failure discovered 2026-05-30 during H7-A.** 1/84 test failing: `caveats[0].args` expected `'0x'`; actual differs. Same stash test confirms pre-existing on master HEAD. Fold into H7-B / H7-D fixes. | run-time | 🟢 CLOSED (H7-D) — test was asserting the wrong invariant; rewritten to lock the audit-F1-correct invariant (`args` is intentionally absent from the EIP-712 Caveat type). |
| **CROSS-STACK-001 (sec)** | 🟠 High | `packages/contracts/src/agency/DelegationManager.sol:68` ↔ `packages/delegation/src/hash.ts:14-21` | **NEW finding discovered 2026-05-30 during H7-D.9.** Contract `DELEGATION_TYPEHASH` is computed over the NON-standard EIP-712 type string `Delegation(...bytes32 caveatsHash,...)` (inlining the precomputed caveats digest as a `bytes32` field), while the off-chain `DELEGATION_EIP712_TYPES` uses the standard form `Delegation(...Caveat[] caveats,...)` (viem `hashTypedData` derives the typehash from the canonical string which includes `Caveat[]` + the `Caveat(...)` definition). These produce DIFFERENT typehashes → different structHashes → different signed digests. A signature produced off-chain by viem may not verify on-chain via the contract's `hashDelegation`. Either the contract should standardize to `Caveat[]` (recommended; the off-chain side already does this) OR the off-chain should mirror the contract's inline form. Locked by `packages/delegation/test/integration/cross-stack-typehashes.test.ts` to catch any future drift. Fix in a follow-up wave. | run-time | 🟢 CLOSED (R1 / 2026-05-30) — contract converged to standard EIP-712: typehash string is now `Delegation(...Caveat[] caveats,...)Caveat(address enforcer,bytes terms)` (matches viem's canonical encoding). Both sides hash to `0x52f4b7596c22f77177e8e563e6502ad014a696bfc92f9c6cabcaf5738c4ed265`. Cross-stack signatures now round-trip. Forge test `test_DELEGATION_TYPEHASH_is_a_known_constant` + the inverted-to-equality `cross-stack-typehashes.test.ts` both lock the converged byte value. **Breaking change** for any consumer that signed `Delegation` typed data against the old typehash — pre-R1 signatures will not verify post-R1. Released in `0.1.0-alpha.2`. |

### `@agenticprimitives/account-custody`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| PKG-account-custody-001 | 🟡 Medium | Missing `AUDIT.md` | Spec 100 §8 lists AUDIT.md as required; `check:package-docs` does NOT enforce it (divergence between doctrine and guard). Decide: update spec 100 §8 (optional) or update guard (required) + add missing files. Same applies to `connect`, `identity-directory`, `identity-directory-adapters`, `ontology`. | ARCH | 🔴 OPEN |
| PKG-account-custody-002 | 🟢 Low | Leaf-status documentation lag | CLAUDE.md correctly says "leaf today". Spec 213's planned `agent-account`/`delegation` consumers documented but not wired. Verify spec 213 itself flags the actual wiring as a future wave. | ARCH | 🔴 OPEN |
| PKG-account-custody-003 / XPKG-008 | ℹ️ | Duplication with agent-account | See PKG-agent-account-001. | ARCH | 🔴 OPEN |

### `@agenticprimitives/key-custody`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| **PKG-KEY-CUSTODY-001 / PKG-key-custody-002** | 🔴 Critical | `src/factories.ts:89-96` `buildToolExecutorBackend` | Returns master signer with `void toolId` and comment "v0 demo returns the master signer". Function exported via `src/index.ts`; JSDoc says "per-tool isolation". Consumer reading API reasonably assumes toolId provides isolation; in fact zero effect. Any tool calling `buildToolExecutorBackend('my-tool', opts).signA2AAction(...)` signs with master key. EXT-020 re-cast. **Library-level**: API surface, not demo. **Remediation:** rename to `buildToolExecutorBackendNoIsolation` until per-tool KDF lands, OR throw in non-test environments. | SEC + ARCH | 🟢 CLOSED (H7-B.1) — `buildToolExecutorBackend` now throws at call with explicit error pointing callers to `buildToolExecutorBackendNoIsolation` (which honestly returns the master and refuses in production unless `AP_ALLOW_NO_TOOL_ISOLATION=true` is set in dev) OR `deriveSubjectSigner` for genuine per-(iss,sub) isolation. Verified at `packages/key-custody/src/factories.ts`. |
| **PKG-KEY-CUSTODY-002 / PKG-key-custody-001** | 🔴 Critical | `src/index.ts` + `capability.manifest.json:publicExports` | `pnpm check:public-exports` FAILS. `src/derive-subject.ts` exports `deriveSubjectSigner`, `deriveSubjectPrivateKeyHex`, `subjectCanonicalMessage`, `SubjectId`, `DeriveSubjectOpts` (spec 235 Google × KMS work). NONE in manifest. **`deriveSubjectPrivateKeyHex` leaks the raw master + per-subject derivation** — returns per-subject private key as hex string in memory. ARCH-006 / ARCH-038 STILL failing. **Single most embarrassing find.** | SEC + ARCH | 🟢 CLOSED (H7-B.1) — `pnpm check:public-exports` passes (16/16 packages). `deriveSubjectPrivateKeyHex` is intentionally NOT re-exported from `packages/key-custody/src/index.ts` (module-internal / test-only); the public surface (`deriveSubjectSigner`, `subjectCanonicalMessage`, `SubjectId`) and the `capability.manifest.json` agree. ARCH-006 / ARCH-038 closed alongside. |
| PKG-KEY-CUSTODY-003 | 🟠 High | `src/providers/local.ts:197-244` `LocalSecp256k1Signer.signA2AAction` | Uses `secp256k1.sign(input.digest, this.priv)` without enforcing low-s normalization. Noble defaults to low-s (canonical TODAY), but invariant undocumented — future noble bump or callsite passing `lowS: false` is silent signature-malleability regression. SB-2 marked `partial` in evidence checklist; GCP signer does `normalizeLowS(s)` explicitly, local does not. | SEC | 🟢 CLOSED (R5.3 / 2026-05-31) — `packages/key-custody/src/providers/local.ts:231` now passes `{ lowS: true }` explicitly to `secp256k1.sign`. noble flips `recovery` when normalizing so the emitted v byte stays consistent. New `local-secp256k1-signer.test.ts` regression: signs 100 distinct digests + asserts every `s ∈ (0, N/2]`. Mirrors the GCP signer's `normalizeLowS(s)` invariant. SB-2 evidence-checklist marker can move to `confirmed`. |
| PKG-KEY-CUSTODY-004 | 🟠 High | `src/providers/gcp.ts:296-330` `findRecoveryByte` | On failure does `console.error` with `digest`, `r`, `s`, `knownPubKey`. In worker logging pipelines these are searchable; the digest is the userOp hash. Not secret but fingerprintable. P3 info-disclosure. | SEC | 🟢 CLOSED (R5.5 / 2026-05-31) — `packages/key-custody/src/providers/gcp.ts:318-329` now logs only `keccak_256`-derived 8-hex-char tags (`digestTag`, `rTag`, `sTag`, `knownPubKeyTag`) instead of the raw bytes. Operators can still correlate the same digest across runs (same input → same tag) without leaking the values to log-indexing pipelines. The `attempts` array (recovered-pubkey strings from each tried v-byte) is retained — load-bearing for the actual debug path and not key material. |
| PKG-KEY-CUSTODY-005 | 🟡 Medium | `src/types.ts:14` `BuildOpts.config: Record<string, string>` | Raw private keys, session secrets, KMS service-account JSON flow as plain strings with no opaque branded type. No compile-time wall between "ordinary config string" and "32-byte private key hex". A consumer logging `opts.config` for debugging dumps the master private key. Use `Secret<string>` brand or loader functions. | SEC | 🔴 OPEN |
| PKG-KEY-CUSTODY-006 | 🟡 Medium | `src/providers/local.ts:46-64` LocalAesProvider | `A2A_ALLOW_LOCAL_ENVELOPE_KEY=true` override is loud (warn once) but consumer cannot programmatically disable the override path — only env var. Should be gated by a runtime API the consumer can opt out of. | SEC | 🔴 OPEN |
| PKG-KEY-CUSTODY-007 | 🟡 Medium | `src/providers/aws.ts` `AwsKmsProvider`/`AwsKmsSigner` | Throws `not yet implemented`. Public API exports + manifest list them. Consumer relying on "AWS KMS supported" per docs gets runtime throw. Either implement or remove from public exports. Already M1. | SEC | 🔴 OPEN |
| PKG-KEY-CUSTODY-008 | 🟡 Medium | `src/providers/gcp.ts:581-585` `GcpKmsProvider.decryptSessionDataKey` | Only checks against `this.keyVersion = 'gcp-kms:v1'`. On GCP key-rotation (rotates active version under same KEY name without changing name), encrypted payload remains decryptable indefinitely. keyVersion string meaningless as rotation marker. | SEC | 🔴 OPEN |
| **PKG-KEY-CUSTODY-009** | 🟠 High (relayer-pattern gap) | `apps/*` reaching for `privateKeyToAccount(env.X_PRIVATE_KEY)` | No "use me for funded relayer ops" entry point in `key-custody`. The package had all the primitives (`buildSignerBackend` + `createKmsViemAccount`) but no convention, no audit emission tagged by operator role, and no documented pattern. App authors reached for `privateKeyToAccount(DEPLOYER_PRIVATE_KEY)` because it was the obvious 1-line idiom. **The result:** raw key material in app config (trips `check:no-app-private-keys` doctrine — CI red on master since the check landed), no audit trail tagged by operator role (every relayed tx is forensically indistinguishable). Recurring across every future relying app that needs funded relayer / operator ops. | SEC + ARCH | 🟢 CLOSED (R5.12a / 2026-05-31) — New `createRelayerAccount(backend, opts: { role, auditSink? })` factory in `packages/key-custody/src/relayer-account.ts`. Returns a viem `LocalAccount` (drop-in replacement for `privateKeyToAccount(...)`) that delegates digest signing to the inner `createKmsViemAccount(backend)` AND emits a `key-custody.relay.sign` audit row on every sign op tagged with `role`. Audit context carries `{ role, signerAddress, opType ∈ {message, transaction, typed-data}, to, value, digestFingerprint }`. `digestFingerprint = keccak256(digest).slice(0, 18)` — 9 bytes of hash, never the digest itself (matches `LocalSecp256k1Signer` redaction). Fail-soft audit emission so a sink outage cannot break the relay flow; consumers who want fail-hard wrap with `composeFailHardSinks`. Exported from main index AND `/relayer` subpath. New `docs/relayer.md` doctrine doc explains when to reach for `createRelayerAccount` vs `createKmsViemAccount`, the role taxonomy convention, and the migration path off `privateKeyToAccount(env.X_PRIVATE_KEY)`. 13 new R5.12a tests + 94/94 key-custody tests green (was 81). **Companion follow-ups:** R5.12b adds `createSpendCappedAccount` for funding-only signers (caps per-tx ETH BEFORE the KMS round-trip — closed). R5.12c adds `assertSaMatchesCustodianDerivation` in `agent-account` for sponsored-deploy gates (closed). **R5.12d (closed)** — demo-a2a's 4 `privateKeyToAccount(DEPLOYER_PRIVATE_KEY)` callsites migrated onto the new pattern via `apps/demo-a2a/src/relayer.ts` (`getRelayerAccount` + `getPaymasterTopupAccount`). `DEPLOYER_PRIVATE_KEY` removed from the worker's `Env` interface entirely. **`pnpm check:no-app-private-keys` is GREEN on demo-a2a** — the chronic CI red that's been on master since the check landed is finally closed. 4 routes wired: `/session/direct-deploy` (now gated by `assertSaMatchesCustodianDerivation` when client supplies `body.smartAccountAddress`), `/session/register-name`, `/session/custody-{schedule,apply}` (via the new `relayDeployer(env, sink)` helper), `/admin/topup-paymaster` (uses `getPaymasterTopupAccount` which wraps `createRelayerAccount` with `createSpendCappedAccount({ capWei: PAYMASTER_TOPUP_CAP_WEI ?? 0.002 ETH })`). |
| **PKG-KEY-CUSTODY-010** | 🟠 High (relayer-pattern gap, follow-on to PKG-KEY-CUSTODY-009) | No per-tx ETH spend cap on funded operator keys | A funded relayer / operator key (e.g. paymaster top-up) had no signing-time gate against draining the worker balance in one tx. The cap was only enforceable operationally: monitor on-chain balance, hope to catch a drain in time, rotate keys after the fact. A compromised app process holding the signer could drain the entire balance in one shot. | SEC | 🟢 CLOSED (R5.12b / 2026-05-31) — New `createSpendCappedAccount(inner: LocalAccount, opts: { capWei, auditSink? })` wrapper in `packages/key-custody/src/spend-capped-account.ts`. Wraps any viem `LocalAccount` (composes with `createRelayerAccount` from R5.12a). `signTransaction` inspects `transaction.value` against `capWei`: under or AT cap → delegates to inner; over cap → throws `SpendCapExceededError` BEFORE any HSM round-trip (HSM never sees the digest — proven by `vi.spyOn(inner.signTransaction)` test). `signMessage` / `signTypedData` forward verbatim (no on-chain value to cap). Value normalisation handles `bigint` (canonical) / `number` / `string` / `undefined` (→ 0n) / unknown shapes (→ MAX_UINT256, fail-closed). `capWei: 0n` is permitted + meaningful — blocks all positive-value txs while allowing zero-value contract writes. Audit emission ONLY on reject (`key-custody.relay.spend-cap.reject`, outcome `denied`); success path stays silent (the inner relayer's `key-custody.relay.sign` event carries the success). Fail-soft audit: sink throw does NOT swallow the SpendCapExceededError. Negative `capWei` rejected at construction. Exported from main index AND `/spend-cap` subpath. New `docs/spend-capped.md` doctrine doc covers composition with `createRelayerAccount`, boundary semantics, value normalisation, what the wrapper is NOT (not a rolling budget, not calldata-aware, not a rate limiter). 22 new R5.12b tests + 103/103 key-custody tests green. |
| PKG-key-custody-003 | 🟡 Medium | LocalAesProvider opt-in coverage | KH-2 says local-AES throws on `NODE_ENV=production` unless explicit opt-in. Guard exists; verify covers all entry points including new `deriveSubjectSigner` path (`derive-subject.ts:107` `loadDerivationMaster`). Unit test that asserts production-env throws on every backend path. | ARCH | 🔴 OPEN |

### `@agenticprimitives/mcp-runtime`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| **PKG-MCP-RUNTIME-001 / PKG-mcp-runtime-002** | 🔴 High | `src/jti-stores.ts:53-108` `createSqliteJtiStore` / `createPostgresJtiStore` | Silently run `CREATE TABLE IF NOT EXISTS` with runtime DB credentials. Production deploys following least-privilege fail silently or noisily — Postgres: first `trackUsage` throws if app role lacks DDL (JTI store down, no signal); SQLite: CREATE runs at construction. **Should require separate `migrate()` step the consumer calls in bootstrap, not bake DDL into auth hot path.** EXT-027 re-cast at library-API level. | SEC + ARCH | 🟢 CLOSED (H7-B.6) — `packages/mcp-runtime/src/jti-stores.ts` now extends the `JtiStore` interface with `migrate(): Promise<void>`. SQL / pg adapters MUST be migrated once at bootstrap before any `trackUsage` is called; calling `trackUsage` without a prior `migrate()` throws a setup error. The DDL is no longer issued from the auth hot path. The file header comment explicitly documents the pattern. |
| PKG-MCP-RUNTIME-002 | 🟠 High | `src/with-delegation.ts:286-307` `withDelegation` | Treats `decision.decision === 'requires-consent'` as "ok when threshold-policy satisfiesByOnChainBlessing". Semantics correct, encoding fragile: `evaluateThresholdPolicy(opts.classification).requiresAcceptedOnChain` is computed AGAIN even though `requireAcceptedOnChain` already threaded into verify. Could go out of sync on future refactor. | SEC | 🔴 OPEN |
| PKG-MCP-RUNTIME-003 / PKG-mcp-runtime-003 | 🟡 Medium | `McpAuthError.reason` PII surface | Public error surface includes structured `reason` fields. Relying app forwarding `error.reason` to client leaks denial-cause. Split `PublicMcpAuthError` (opaque code) vs `PrivateAuthFailureContext` (internal id + reason). Spec 214 OA-5 requires this. EXT-026/EXT-032 re-cast. | SEC + ARCH | 🔴 OPEN |
| PKG-mcp-runtime-001 | 🟠 High | `src/with-delegation.ts:357-358` `verifyCrossDelegationForResource` | Pair to PKG-delegation-001 (arch). Public export, stub. Experimental subpath OR throw OR delete. | ARCH | 🟢 CLOSED (H7-B.8) — `verifyCrossDelegationForResource` removed from the public surface; `packages/mcp-runtime/src/index.ts` header comment ("H7-B.8: `withCrossDelegation` + `verifyCrossDelegationForResource` removed") confirms. Will resurface behind a `./experimental` subpath per spec 100 §6 when cross-delegation work resumes. Paired with PKG-delegation-001 closure. |
| PKG-MCP-RUNTIME-004 | 🟡 Medium | `src/service-mac.ts:213` `verifyServiceMac` | `if (!args.provider.generateMac) return reject('verifier provider lacks generateMac')`. Reject logged as string reason; operators can't distinguish "wrong key" from "wiring broken" without reading reason off audit row. | SEC | 🔴 OPEN |
| PKG-MCP-RUNTIME-005 | 🟡 Medium | `verifyServiceMac` clock skew | Accepts default 60s. TYPE allows `maxClockSkewMs: 86_400_000`. No upper bound check. Consumer passing "a day" disables clock-skew protection. | SEC | 🔴 OPEN |
| PKG-MCP-RUNTIME-006 | ℹ️ | `generateServiceMac` | No `auditSink` argument; CT-9 on tracker. | SEC | 🔴 OPEN |
| PKG-mcp-runtime-004 | 🟢 Low | `service-mac` vs app `bridge-hmac` | ARCH-027/-028 — **app-level** drift (apps duplicated). Package is fine. Re-verify `service-mac` `audience` field is flexible enough to absorb app's "bridge" use case without parallel impl. Informational. | ARCH | 🔴 OPEN |
| **PKG-MCP-RUNTIME-007** | 🔴 Critical (external P0-3) | `src/with-delegation.ts:389-405` `verifyDelegationForResource` | **Public helper called `verifyDelegationToken` with ONLY `audience`/`chainId`/`rpcUrl`/`delegationManager`/`enforcerMap`/`jtiStore`/`toolName`/`requireDeployed`/`now` — NONE of classification, auditSink, environment, quorumProof, requireQuorumCaveat, requireAcceptedOnChain.** A consumer using this helper (instead of the `withDelegation` wrapper) silently skipped the entire production policy layer that `withDelegation` enforces (audit H1/H2/H3): no threshold-policy decision, no policy engine, no audit trail, no quorum gate. External senior-architect audit P0-3. | SEC | 🟢 CLOSED (R5.8 / 2026-05-31) — `verifyDelegationForResource` signature and body refactored to mirror `withDelegation` exactly. New `VerifyDelegationForResourceOpts` type: `{ toolName, timestamp, classification, auditSink, correlationId, metricsSink, traceparent, environment, developmentMode, quorumProof }`. The construction-time gate (H1) now also fires here: in production, missing classification or auditSink THROWS at call time with a clear remediation message. Threshold-policy (`evaluateThresholdPolicy`) decision derives `requireQuorumCaveat` + `requireAcceptedOnChain` and threads them into `verifyDelegationToken` opts. Post-verify, `evaluatePolicy` runs the classification policy decision (allow / deny / requires-consent with the on-chain-blessing satisfier). Audit events emit as `mcp-runtime.verify-resource.{accept,reject}` on the supplied sink. Public surface returns `{ principal, grants } | { error: 'auth-failed' | 'auth-misconfigured' }` — the H7-F.1 info-leak rule applies: error strings are opaque codes only, the private reason lands on the audit row. 9 new R5.8 tests + 62/62 mcp-runtime tests green. `VerifyDelegationForResourceOpts` exported from `src/index.ts`. |

### `@agenticprimitives/tool-policy`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| PKG-TOOL-POLICY-001 | 🟢 Low | `src/lint.ts:36-64` `lintClassification` | Walks filesystem synchronously. Returns `{passed: false, errors}` — does NOT throw. Consumer wiring as CI gate who forgets `throw if (!result.passed)` silently lets unclassified tools ship. | SEC | 🔴 OPEN |
| PKG-TOOL-POLICY-002 / PKG-tool-policy-002 | 🟡 Medium | `evaluatePolicy` + classification registry | Pure and fail-closed (good). `KNOWN_TOOL_KINDS`/`KNOWN_AUTH_KINDS`/`KNOWN_RISK_TIERS` constants in source — consumer cannot extend without forking (by design — security boundary). Document in CLAUDE.md explicitly. Classification registry load-bearing — verify `evaluatePolicy` denies unclassified tools (fail-closed). EXT-034 re-cast. | SEC + ARCH | 🔴 OPEN |
| PKG-tool-policy-001 | 🟢 Low | `src/lint.ts:8-9` Node-only imports | `node:fs`, `node:path`. Add comment + verify `package.json` exports document Node-only constraint, OR add top-level `// @internal` marker. | ARCH | 🔴 OPEN |
| PKG-tool-policy-003 | ℹ️ | Transport-agnostic invariant | No MCP/A2A imports. Clean. | ARCH | 🟢 CLOSED-CONFIRMED |

### `@agenticprimitives/agent-naming`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| PKG-AGENT-NAMING-001 | 🟡 Medium | Naming integration | NA-1..NA-5 covered in evidence-checklist. NM-6 (round-trip reverse) open; without it universal resolver may return name whose forward record points elsewhere. | SEC | 🔴 OPEN |
| PKG-agent-naming-001 | ℹ️ | Log-walker | Per CLAUDE.md + ADR-0012, `reverseResolve` log-fallback removed once `reverseResolveString` shipped. Manifest `forbiddenImports` covers re-introduction. Verified clean. | ARCH | 🟢 CLOSED-CONFIRMED |
| PKG-agent-naming-002 | 🟡 Medium | Off-chain library symmetry vs `AgentNameUniversalResolver.sol` (80%) | Off-chain library 1658 src LoC + 636 test LoC needs symmetric coverage on resolution path. Verify normalization unit tests cover full ENSIP-15 surface. | ARCH | 🔴 OPEN |

### `@agenticprimitives/agent-profile`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| **PKG-agent-profile-001** | 🟠 High | `src/errors.ts:4,14,22,29` + `src/client.ts:50,52,55,95` + docs | Rename from `agent-identity` → `agent-profile` left source error messages stamped `[agent-identity]`. Users of `@agenticprimitives/agent-profile` get errors with old package name. 62 stale refs across CLAUDE.md, AUDIT.md, README.md, spec.md, docs/, src/. **Sweep `[agent-identity]` → `[agent-profile]`.** | ARCH | 🟢 CLOSED (R5.5 / 2026-05-31) — `grep -r "\[agent-identity\]" packages/agent-profile/` returns 0 hits across the whole package. All errors in `src/errors.ts` use the `[agent-profile]` prefix: `InvalidProfileError`, `ProfileHashMismatchError`, `EndpointVerificationError`, `InvalidCaip10Error`, etc. Closed by the rename sweep folded into an earlier H7 wave; audit row was just stale. |
| PKG-agent-profile-002 | 🟡 Medium | Stale `dist/` artifact | ARCH-018 — build artifact carries pre-rename text. Rebuild + CI dist-drift guard. | ARCH | 🔴 OPEN |

### `@agenticprimitives/agent-relationships`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| **PKG-agent-relationships-001** | 🔴 Critical-when-published | All | Public on-chain edge model **structurally incompatible** with any confidentiality requirement a third-party adopter brings (EXT-019, the Privacy Fork). CLAUDE.md / spec.md must label `"stability": "experimental"` and document threat model loudly. Add top-of-README "do not use for confidential edges" callout. Spec 239 (private relationship store) is the alternative. | ARCH | 🟢 CLOSED (R3.2 / 2026-05-31) — `capability.manifest.json` sets `"stability": "experimental"` (was already set). `packages/agent-relationships/README.md` now opens with a ⚠️ callout block: "Experimental — do NOT use for confidential edges", enumerates the public exposure surface (subject, object, type, role set, status, actor address per state transition), names the use-cases this is structurally incompatible with (financial counterparty graphs, medical referrals, NDA partnerships, household membership), points adopters needing confidentiality to off-chain stores until the future v2 private-edge variant ships. Privacy Fork is now explicit on every reader's first impression. |

### `@agenticprimitives/account-custody` (additional)

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| PKG-ACCOUNT-CUSTODY-001 | ℹ️ | CR-1..CR-5 evidence | Contract side closes per evidence-checklist. Cross-check action builders for `bytes32 == bytes32(0)` semantic checks. No findings to add at this read. | SEC | 🟢 CLOSED-CONFIRMED |

### `@agenticprimitives/ontology`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| PKG-ontology-001 | 🟡 Medium | Package boundary | 99 src LoC, no internal deps, one internal consumer (`identity-directory`). Per spec 100 §2, only "static-artifact + zero deps" branch of S3 supports the split. Acceptable for now; revisit when second consumer (on-chain ontology resolver?) appears. | ARCH | 🔴 OPEN |
| PKG-ontology-002 | 🟡 Medium | Missing `AUDIT.md` | See PKG-account-custody-001. | ARCH | 🔴 OPEN |
| PKG-ontology-003 | 🟢 Low | `./artifacts` subpath split | Correct (browser-safe core + Node loader split). Informational. | ARCH | 🟢 CLOSED-CONFIRMED |

### `@agenticprimitives/identity-directory` + `identity-directory-adapters`

| ID | Severity | Component | One-line | Source | Status |
|---|---|---|---|---|---|
| PKG-identity-directory-001 | 🟡 Medium | Missing `AUDIT.md` | See PKG-account-custody-001. | ARCH | 🔴 OPEN |
| PKG-identity-directory-002 | 🟢 Low | Test coverage | 149 test LoC vs 303 src LoC. Verify `Resolution`/`Evidence` aggregation matrix unit-tested across cardinality cases (0/1/many). | ARCH | 🔴 OPEN |
| PKG-identity-directory-adapters-001 | 🟡 Medium | Missing `AUDIT.md` | See PKG-account-custody-001. | ARCH | 🔴 OPEN |
| PKG-identity-directory-adapters-002 | 🟢 Low | Thin-wrapper risk | 176 LoC; correctly placed per ADR-0015 firewall. No action; flagged for v0.1 revisit. | ARCH | 🔴 OPEN |
| PKG-IDENTITY-DIRECTORY-001 | ℹ️ | Architecture | Spec 223-locked. Not deeply inspected. | SEC | 🟢 CLOSED-CONFIRMED |

---

## 3. Per-contract findings

### `AgentAccount.sol` (1327 LoC)

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| **CON-AgentAccount-001** | 🟠 High | Forge coverage | **55% lines / 52% statements / 38% branches.** Below "production-library" bar for ERC-4337 + UUPS-upgradeable + ERC-7579 module-host + WebAuthn-supporting account. Critical uncovered: `executeFromModule` callback edges, `_authorizeUpgrade`, hook iteration limits (`MAX_HOOKS`), `addPasskey`/`removePasskey` lifecycle from `RecoverAccount`. **Target ≥90% lines / ≥80% branches before any external audit.** Add invariant/fuzz tests for: passkey set membership consistency, custodian count ≡ externalCustodianCount + piaCount, module installed flag ↔ installedList[type] membership. | 🟢 CLOSED (R3.5 / 2026-05-31) — coverage **91.25% lines / 90.65% statements / 84.51% branches / 100% functions** (was 55.94%/52.99%/42.25%/62.07%). Both ≥90 lines and ≥80 branches production-library targets hit. R3.4 added `test/AgentAccountCoverage.t.sol` (45 tests covering every public getter, `execute`/`executeBatch` happy + revert + value-forwarding + EntryPoint-caller + empty array, upgrade-lifecycle entry points, session-delegation accept + query, custodian add/remove + onlySelf gating, `supportsInterface` ERC-165 sentinels, `setDelegationManager`, `passkeyIdentity` determinism, full `executeFromBundler` ERC-4337 outer-gate with FactoryNotSet/NotBundler/happy/InvalidInnerSignature covering `_verifySignerEcdsa` + inner `_validateSig`). R3.5 added `test/AgentAccountCoveragePart2.t.sol` (36 tests covering: upgrade lifecycle via `vm.store`-injected `_pendingUpgrade` to exercise `setUpgradeTimelock` revert, `executePendingUpgrade` not-ready + ready paths (which exercise `_authorizeUpgrade` via real UUPS `upgradeToAndCall`), `cancelPendingUpgrade` valid + bad sig; ERC-7579 module install with zero-address / unsupported-type / duplicate / outer-caller / hook-MAX_HOOKS limit / `onInstall` revert rollback; module uninstall with not-installed / unsupported-type / non-self caller / `onUninstall` revert / middle-element list compaction; ERC-4337 `validateUserOp` direct entry covering `_validateSignature` ECDSA + bad-sig + WebAuthn-type-prefix routing; `executeFromModule` not-installed revert + happy + target-revert; hook pre/postCheck iteration for both `execute` and `executeBatch`; small branches `isCustodian(self)` + `removeCustodian` last-custodian + non-custodian reverts + empty-sig + ERC-6492 wrapped sig unwrap). `scripts/check-forge-coverage.ts` accepted-debt entry deleted; contract now held to standard SRC tier floor. Total forge tests: 524 (was 426 pre-R3, +98 new). **Remaining 3 uncovered branches** are deeply-edge-case constructor / factory-not-set paths (`_factory == address(0)` getters, init-time `_isAgenticPrimitivesAgent` self-reference, init-time custodian-duplicate) — not feasible to exercise in normal deploy flow. WebAuthn happy path requires real P-256 signing — left for spec-level test infrastructure work. |
| CON-AgentAccount-002 | 🟡 Medium | Single-file 1327 LoC monolith | Inherits 8 interfaces/contracts AND inlines passkey storage, module storage, signature dispatch, upgrade authority, factory-init logic. Spec 209 says "thin ERC-7579 modular core" with thresholds/guardians/spend/sessions as modules. `CustodyPolicy` IS extracted; next extraction (per spec 209) should be the signature-verification dispatcher (validator-module per ERC-7579) so the core shrinks to ≤600 LoC. | 🔴 OPEN |
| CON-AgentAccount-003 | 🟡 Medium | Storage layout 50-slot gap, ERC-7201 namespaces for passkeys + modules | Layout correct; storage doc good. **Add automated storage-layout snapshot test (`forge inspect AgentAccount storageLayout`) committed so any future ordering bug fails CI.** | 🟢 CLOSED (R1.3 / 2026-05-30) — closed alongside XCON-003: `pnpm check:storage-layouts` snapshots `AgentAccount` (+ `CustodyPolicy`, `DelegationManager`, `SmartAgentPaymaster`) under `packages/contracts/test/storage-layouts/<C>.snap.json` and runs in CI after the forge-coverage gate. |
| CON-AgentAccount-004 | ℹ️ | Wave 2A authority closure | `setDelegationManager`, `installModule`, `uninstallModule`, `upgradeToWithAuthorization` are `onlySelf`. `LegacyUpgradePathDisabled` revert unconditional. Factory-init one-shot exception consumed by boolean flag. Verified. | 🟢 CLOSED-CONFIRMED |
| **CON-AgentAccount-005** | 🔴 **High (R6 headline)** | `AgentAccount.sol` system-pause coverage | **R6.1 recon (`docs/audits/r6-contracts-recon-2026-05-31.md` § 2.2) identified that AgentAccount has ZERO pause checks across 13 mutating external functions.** When governance pauses the system via `AgenticGovernance.setPaused(true)`, every deployed account continues operating normally — funds keep moving, modules keep installing, upgrades keep landing. R5.7's paymaster refuses to sponsor gas (H7-C.10) but the account itself doesn't refuse. **Largest defensive gap in the codebase for an engagement platform.** | SEC | 🟢 CLOSED (R6.5 / 2026-05-31) — New `whenNotPaused` modifier + `_systemPaused()` helper in `AgentAccount.sol`. The helper chains `staticcall(_factory) → factory.governance()` then `staticcall(governance) → isPaused()`; any non-conforming hop returns `false` (legacy / test compatibility, mirrors `GovernanceManaged._pausedSafe()`). New `IAgentAccountFactoryView.governance()` interface fn + `IAgentAccountPauseView.isPaused()` interface. New `error SystemPaused()`. Modifier applied to **6 mutating entrypoints**: `execute`, `executeBatch`, `executeFromModule`, `installModule`, `executePendingUpgrade`, `addCustodian`. **3 recovery primitives deliberately left UNGUARDED** — operator must always be able to REMOVE attack surface during an incident: `uninstallModule`, `cancelPendingUpgrade`, `removeCustodian`. **3 `onlySelf` ceremonies also unguarded** (already gated by owner sig + self-recovery shaped): `setUpgradeTimelock`, `setDelegationManager`, `acceptSessionDelegation`. `executeFromBundler` is `view` (validation only — the EntryPoint then calls `execute` which IS paused), so not in scope. 14 new R6.5 regression tests in `test/AgentAccountPauseR65.t.sol`: 6 paused-reverts (one per guarded fn), 3 recovery-still-works-when-paused, 3 ceremony-still-works-when-paused, 1 unpaused-doesn't-revert-with-SystemPaused, 1 legacy-EOA-governance-never-pauses. 14/14 R6.5 tests + 558/559 full suite (only failure: pre-existing R5.9 env-bleed in `DeployAuthorityResolution.t.sol`, unrelated). |
| CON-AGENT-ACCOUNT-001 | ℹ️ | `executeFromBundler` (line 533-560) | `view` defense-in-depth wrapper; doesn't execute userOp. Exposes a free signature-validation oracle (not a vulnerability). | 🟢 CLOSED-CONFIRMED |
| CON-AGENT-ACCOUNT-002 | 🟢 Low | `_verifyWebAuthn` (line 1080-1089) | Wraps `decodeWebAuthnAssertion` in try/catch (audit C-7 closure). Adds ~700 gas success path. Acceptable. | 🟢 CLOSED-CONFIRMED |
| CON-AGENT-ACCOUNT-003 | 🟢 Low | `executeBatch` (line 925-953) intentionally not `nonReentrant` | Documented at line 917-924; auth gate `_requireForExecute` only checks msg.sender ∈ {EntryPoint, self, DM}. If DM has a reentrancy bug, batch path exposed. Documented mitigation (DM has own nonReentrant) — verify on every DM upgrade. | 🔴 OPEN |
| CON-AGENT-ACCOUNT-004 | 🟢 Low | `_verifyEcdsa` (line 1040-1049) | Tries raw hash then eth-signed-message. Deliberate compatibility (v0.7 + v0.8 EntryPoints differ). Two "valid" signature shapes for same hash, doubling surface for downstream signature-malleability. | 🔴 OPEN |
| CON-AGENT-ACCOUNT-005 | 🟢 Low | `_isAgenticPrimitivesAgent` (line 1169-1178) | ERC-165 try/catch. Malicious contract can return false to escape "no AP-agent as custodian" invariant. Acceptable per threat model; document explicitly. | 🔴 OPEN |

### `AgentAccountFactory.sol` (269 LoC)

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| **CON-FACTORY-001** | 🟠 High | Governance (line 84) | Set at construction immutable; rotation paths `setBundlerSigner`/`setSessionIssuer` (97-107) `onlyGovernance` with **no timelock and no multi-sig requirement**. Deploy script sets governance to deployer EOA. No contract-side defense — trusts deploy script to set a multisig. Cross-cutting with CT-1. Factory itself exposes no `transferGovernance` — governance is immutable. To rotate, redeploy. | 🔴 OPEN |
| CON-FACTORY-002 | 🟡 Medium | `createAgentAccount` idempotent | Documented behavior: same params → existing account. Consumer mapping params→params on second call silently gets existing account, including state changes between calls. | 🔴 OPEN |
| CON-FACTORY-003 | 🟢 Low | `_buildValidatorInitData` (240-268) | Hardcodes `T3 high-value ceiling = 0.01 ether` and `approvedHashRegistry = address(0)`. Disables v=1 pre-approved-hash path for factory-deployed accounts. Wire through constructor or document constraint. | 🔴 OPEN |
| CON-AgentAccountFactory-001 | ℹ️ | Coverage 100% | Excellent. CREATE2 derivation + mode-axis validation + capability-role rotation under governance. Defensible. | 🟢 CLOSED-CONFIRMED |

### `agency/DelegationManager.sol` (328 LoC)

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| **CON-DelegationManager-001** | 🟠 High | Forge coverage | **42% — worst of any load-bearing contract.** Spec 214 SB-1/SB-2 invariants live here. Uncovered branches: caveat-args runtime injection, multi-caveat ordering, deep delegation chains. **Target ≥85% before external audit.** Fuzz tests for delegation chain length × caveat enforcer dispatch. | 🟢 CLOSED (R3.3 / 2026-05-31) — coverage raised to **95.77% lines / 97.12% statements / 88.24% branches / 100% functions** via new `test/DelegationManagerRedeemCoverage.t.sol` (17 tests) exercising: happy single + chain-of-two delegations with EOA delegators, system-pause gate (paused, unpaused, EOA-governance skip, bad-data skip), all `_validateDelegation` branches (revoked, leaf-delegate mismatch, non-root without parent, broken authority chain, chain delegate mismatch), `_validateSignature` (invalid sig revert + contract delegator via ERC-1271 mock accept/reject), `_executeFromDelegator` via mock-SA `execute()` callback, and caveat hooks via `TimestampEnforcer` happy path + unknown-enforcer revert. `scripts/check-forge-coverage.ts` accepted-debt entry deleted; contract now held to standard SRC tier floor. |
| CON-DelegationManager-002 | 🟡 Medium | Legacy `revokeDelegation(bytes32)` | Reverts with `LegacyRevocationDisabled`. Defensible per DoS-surface rationale but clients probing via 4-byte selectors still see "function exists". Document in package README's "what we deliberately keep". | 🔴 OPEN |
| CON-DelegationManager-003 | ℹ️ | `nonReentrant` on `redeemDelegation` | SC5 §6.2 closed. | 🟢 CLOSED-CONFIRMED |
| CON-DelegationManager-004 | ℹ️ | Singleton-redeploy, 50-slot gap | Clean. | 🟢 CLOSED-CONFIRMED |
| CON-DELEGATION-001 | 🟢 Low | `_executeFromDelegator` (277-296) `abi.encodeWithSignature` | Literal string `"execute(address,uint256,bytes)"`. Future refactor renaming account proxy function silently breaks. Use `abi.encodeCall(IAgentAccount.execute, …)` for type safety. | 🔴 OPEN |
| CON-DELEGATION-002 | 🟢 Low | `_runBeforeHooks` (233-252) | No gas limit per enforcer call; hostile enforcer can grief by consuming all gas. Delegator chose enforcer at signing time, trust model is "delegator trusts enforcers they pick" — consistent. Document. | 🔴 OPEN |
| CON-DELEGATION-003 | ℹ️ | `_hashCaveats` (319-327) | `encodePacked` of array safe since entries ARE `bytes32`. Verified. | 🟢 CLOSED-CONFIRMED |

### Enforcers (`src/enforcers/*`)

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| CON-Enforcers-001 | 🟢 Low | Per-enforcer AUDIT.md | Each enforcer (AllowedMethods, AllowedTargets, QuorumEnforcer, Timestamp, Value) has own `.AUDIT.md`. Excellent pattern; smart-agent practice. | 🟢 CLOSED-CONFIRMED |
| CON-Enforcers-002 | 🟡 Medium | `CaveatEnforcerBase.sol` 0% coverage | Abstract base — exercised via concretes (likely is, coverage tool not crediting). | 🔴 OPEN |
| CON-ENFORCERS-001 | ℹ️ | `abi.decode(terms)` on malformed terms | Reverts (default Solidity, fail-closed on shape) — but uninformative `Panic(0x32)`. Consider explicit validation with custom errors. | 🔴 OPEN |
| **CON-ENFORCERS-002 / XPKG-001** | 🟢 Low | `TimestampEnforcer` boundary | On-chain: `block.timestamp > validUntil` (strict). Off-chain `packages/delegation/src/evaluator.ts:34`: `ts >= validUntil`. **Boundary differs by 1 second**: redeem at `block.timestamp == validUntil` succeeds on-chain; off-chain pre-check denies. Structural cross-stack discrepancy. | 🔴 OPEN |
| CON-QUORUM-001 | ℹ️ | QuorumEnforcer binding | C-4 correctly implemented; `expectedPayloadHash` recomputed + compared (135-150). Solid. | 🟢 CLOSED-CONFIRMED |
| CON-QUORUM-002 | 🟢 Low | `_inSet` O(N×M) | Linear search per slot × per signer. Practical quorum (≤10) fine. | 🔴 OPEN |
| CON-QUORUM-003 | 🟢 Low | Excess sig blob beyond `threshold * 65` | Silently ignored (documented at line 67-70). Acceptable. | 🟢 CLOSED-CONFIRMED |

### `UniversalSignatureValidator.sol` (136 LoC)

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| CON-UniversalSignatureValidator-001 | ℹ️ | Coverage 94% | Excellent. Spec 214 SB-4 closure (one entry, no per-app variant) holds. | 🟢 CLOSED-CONFIRMED |
| CON-UNIVERSAL-001 | 🟢 Low | `_ecdsaRecover` (121-135) | Tries raw hash then eth-signed-prefix. Same pattern as `AgentAccount._verifyEcdsa`. Acceptable. | 🔴 OPEN |
| CON-UNIVERSAL-002 | 🟢 Low | `isValidSig` state-changing mode | Deploys account counterfactually (63-66). `factory.call(factoryCalldata)` doesn't pass value; factory requiring payment silently fails and verifier returns false. Acceptable. | 🔴 OPEN |

### `SmartAgentPaymaster.sol` (266 LoC)

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| **CON-SmartAgentPaymaster-001** | 🟠 High | Forge coverage | **52% — validation modes (dev / allowlist / verifying) all need branch coverage.** `verifyingSigner` path uncovered branches: malformed `paymasterAndData` length, ECDSA recover-to-zero, signature `v` outside {27,28}. Matrix test of all three modes × edge inputs. | 🔴 OPEN |
| CON-SmartAgentPaymaster-002 | 🟢 Low | `setDevMode(true)` + production preflight | OP-1 says `check:production-deploy` fails on dev-mode. Verify preflight reads `_dev` via public getter; contract exposes `dev()` only as private state. Verify `isDev()` or equivalent exists. | 🟢 CLOSED (R5.7 / 2026-05-31) — Superseded by **PKG-PAYMASTER-002** (R5.7) which removed the implicit `_dev=true` default entirely. The constructor now takes explicit `bool devMode_` + `address verifyingSigner_` args; `Deploy.s.sol` passes `paymasterDevMode = _isTestnetNetwork(network)` so production deploys ship with `_dev=false` from block 1 — no post-broadcast `setDevMode(false)` race window. `devMode()` is the public getter (was always there; the row's "verify it exists" check is satisfied). Preflight check on a chain-state `devMode() == true` for a deployed paymaster on a production network is a separate-and-still-open follow-up (would require RPC access from CI). |
| CON-PAYMASTER-001 | 🟡 Medium | `_validatePaymasterUserOp` line 198 | `if (governance.code.length > 0) { if (IGovernanceView(governance).isPaused()) revert SystemPaused(); }`. Governance = EOA → pause check skipped. No enforcement governance must be a contract. | 🔴 OPEN |
| CON-PAYMASTER-002 | 🟡 Medium | `setDevMode(true)` reachable by governance any time (123-126) | With governance = leaked deployer (CT-1), paymaster can flip back to dev/accept-all for arbitrary sponsorship. Need timelock + multisig governance. | 🔴 OPEN |
| CON-PAYMASTER-003 | 🟡 Medium | `verifyingSigner` rotation (143-147) immediate | New signer effective next userOp; old signed envelopes (with `validUntil` in future) become invalid. Document. | 🔴 OPEN |
| CON-PAYMASTER-004 | 🟢 Low | `getHash` (167-187) | Omits `paymasterAndData` (standard) AND EntryPoint address. Future EntryPoint deploy means paymaster-signed envelope replayable in new world. Bind to entryPoint. | 🔴 OPEN |
| **PKG-PAYMASTER-002** | 🔴 Critical (external P0-2) | `SmartAgentPaymaster.sol` constructor + `Deploy.s.sol` | **Pre-R5.7 the constructor unconditionally set `_dev = true`. Every fresh deploy started in accept-all mode and remained that way until governance ran a post-broadcast `setDevMode(false) + setVerifyingSigner(...)` ceremony. A production deploy that forgot or delayed step 7 of `Deploy.s.sol` would sponsor any arbitrary userOp.** External senior-architect audit P0-2. | 🟢 CLOSED (R5.7 / 2026-05-31) — Constructor now takes `bool devMode_` + `address verifyingSigner_` EXPLICITLY (no default). `Deploy.s.sol` line ~218 computes `bool paymasterDevMode = _isTestnetNetwork(network)` and passes it directly into `new SmartAgentPaymaster(...)`, alongside `vm.envOr("PAYMASTER_VERIFYING_SIGNER", address(0))`. Production networks ship with `devMode=false` from block 1; testnet networks ship with `devMode=true` from block 1; the post-broadcast `setDevMode(false)` race window is gone. `DeployPaymaster.s.sol` (incremental deploy) defaults `PAYMASTER_DEV_MODE=false` and requires explicit env opt-in for dev. Production deploys without a verifying signer print a loud multi-line warning + start in fail-closed allowlist mode (`SenderNotAccepted` reverts until governance opts senders in). 32/32 SmartAgentPaymaster tests pass including 4 new R5.7 tests: `test_R5_7_constructed_with_devMode_false_starts_in_production_mode`, `test_R5_7_constructed_with_verifyingSigner_wires_it_atomically`, `test_R5_7_constructed_with_verifyingSigner_emits_event`, `test_R5_7_constructed_with_zero_verifyingSigner_does_not_emit`. 540/540 contract suite green. CON-SmartAgentPaymaster-002 superseded by this row. CON-PAYMASTER-002 (governance can flip `_dev=true` later — needs timelock) is a SEPARATE row and remains OPEN. |

### `naming/AgentNameRegistry.sol`

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| **CON-NAMING-001** | 🔴 **High** | `initializeRoot` (135-163) + `script/Deploy.s.sol:170-175` | **Fully permissionless TLD initialization.** Any mempool observer can frontrun the deployer's first `initializeRoot("agent", attackerAddress, …)` and own `.agent` forever. Same for any future TLD. Deploy script doesn't bundle deploy+init atomically. Mitigation: bundle atomically OR make callable only by deployer / governance. **`.agent` TLD is part of the naming protocol per CLAUDE.md; takeover = attacker controls every name resolution under that root.** | 🟢 CLOSED (H7-C.4) — `AgentNameRegistry.initializeRoot` is now atomically bundled with deploy (see `packages/contracts/src/naming/AgentNameRegistry.sol:75` "H7-C.4 / CON-NAMING-001" closure header). Deploy script bundles `deploy + initializeRoot` in the same transaction; permissionless front-run vector closed. |
| CON-NAMING-002 | 🟡 Medium | `setPrimaryName` (264-269) | Accepts any registered node; does NOT verify caller owns forward record. Universal resolver enforces round-trip on reads (NM-6 still open) — but registry itself accepts squatting. Consumer reading `primaryName(agent)` directly bypasses resolver, sees squatted name. | 🔴 OPEN |
| CON-NAMING-003 | 🟡 Medium | `register` (184-215) expiry semantics | Calls `_requireNotExpired(parentNode)` but no expiry check on child being registered against previously-expired sibling. Name registered/expired/not-renewed permanently lost if `_records[childNode].registeredAt != 0`. Consumer wanting expired-and-released semantics needs to clear on expiry — `renew()` doesn't. | 🔴 OPEN |
| CON-NAMING-004 | 🟢 Low | `backfillLabel` (223-229) | Owner-gated and one-shot. Good. | 🟢 CLOSED-CONFIRMED |
| CON-Naming-001 (arch) | 🟡 Medium | `AgentNameUniversalResolver.sol` 80%, `AgentNameRegistry.sol` 93% | Good. | 🟡 ACCEPTABLE |

### `naming/PermissionlessSubregistry.sol`

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| CON-SUBREGISTRY-001 | 🟢 Low | Per-caller one-claim limit | Trivially bypassed by caller holding multiple EOAs. Documented as "designed for demos / sybil-resistant rollups". Acceptable. | 🔴 OPEN |
| CON-SUBREGISTRY-002 | 🟢 Low | `MIN_LABEL_LENGTH = 3` immutable | Subregistry wanting 4+ chars can't configure without redeploy. | 🔴 OPEN |
| **CON-SUBREGISTRY-003** | 🟠 High (Slither reentrancy-no-eth) | `register(string,address)` lines 80-92 | **CEI violation.** `claimedBy[msg.sender] = childNode` was written AFTER the external `REGISTRY.register(...)` call. If the registry (or any resolver it invokes) re-enters `register()`, the second call passes the `prior != bytes32(0)` guard because the write hasn't happened. **R6.1 recon doc § 1.1 / § 4.1.** | 🟢 CLOSED (R6.2 / 2026-05-31) — `PermissionlessSubregistry` now inherits from OpenZeppelin's `ReentrancyGuard`; `register()` carries the `nonReentrant` modifier. The outer call holds the global lock; any nested call to `register()` reverts with `ReentrancyGuardReentrantCall`. New regression test `test_R6_2_reentrancyGuardBlocksNestedRegister` uses a `MaliciousRegistry` mock whose `receive()` re-enters the subregistry — the reentry is blocked and the outer call reverts as expected. Companion test `test_R6_2_sequentialCallsFromDifferentSendersStillWork` confirms the modifier resets between calls. 13/13 PermissionlessSubregistry tests pass; 547/547 contracts suite green. |

### `custody/CustodyPolicy.sol` (839 LoC)

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| **CON-CustodyPolicy-001** | 🟠 Medium | Forge coverage | **70% lines / 30% branches.** Surface huge (16 CustodyAction × 6 tiers × schedule/apply/cancel). Unhappy paths (timelock not expired, threshold not met, recovery-quorum recursion) under-covered. Matrix-driven Foundry fixtures (Wave 2B/2C scaffolding suggests these exist for QuorumEnforcer binding; replicate for CustodyPolicy). | 🔴 OPEN |
| **CON-CustodyPolicy-002** | 🟠 Medium | `_verifyQuorum` stack-too-deep under `--via-ir` | Coverage required `--ir-minimum`. **Coverage report is approximation of what deployed contract executes.** Simplify `_verifyQuorum` argument list (struct-pack verify context) so contract compiles under deployment settings. | 🔴 OPEN |
| CON-CustodyPolicy-003 | 🟢 Low | `permanentlyUninstalled` flag | AC-4 closure. Verify set under all uninstall paths (not just nominal). | 🔴 OPEN |
| CON-CUSTODY-001 | 🟡 Medium | `_approvalsValue` (544-548) returns 1 when per-tier threshold unset | Direct-installed CustodyPolicy omitting T1 thresholds → implicit-1. Consumer custom factory passing `thresholds[1] = 0` silently gets single-sig T1. Make `_approvalsValue` revert on unset. | 🔴 OPEN |
| CON-CUSTODY-002 | 🟡 Medium | `cancelScheduledChange` for `RecoverAccount` during 24h primary cancel | Requires only T4. T4 = "admin" can be 1. Single compromised custodian repeatedly cancels legitimate recovery during 24h, indefinite DoS. Recommend recoveries-pending counter that increments + forces escalating quorum on repeated cancels. | 🔴 OPEN |
| CON-CUSTODY-003 | 🟢 Low | `_applyRecoverAccount` (785-823) | Iterates `r.addOwners`/`r.removeOwners` calling `_execute` per element. Per-call bound for adversarial recovery with 100 addOwners. | 🔴 OPEN |
| CON-CUSTODY-004 | 🟢 Low | `_applyRotateAllOwners` (709-742) | Emits `OwnersRotated` with only `added` count, ignoring `removed` (ABI compat note at line 738). Documented. | 🟢 CLOSED-CONFIRMED |
| CON-CUSTODY-005 | 🟢 Low | `_effectiveTierFor` for `ChangeApprovalsRequired` | Decodes (uint8 targetTier, uint8 newCount). Malformed args revert inside view; schedule call reverts cleanly. | 🟢 CLOSED-CONFIRMED |

### `libraries/SignatureSlotRecovery.sol`

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| **CON-Libraries-003 / CON-SIG-SLOT-001** | 🟠 Medium-High | Coverage 68% / 47% | Signature-format dispatcher (ECDSA, eth_sign, ERC-1271, ApprovedHash) — exactly the surface attackers will probe. **Per-`v`-byte-discriminator test matrix needed.** | 🔴 OPEN |
| **CON-SIG-SLOT-001** | 🟡 Medium | `v == 0` (ERC-1271) path (90-112) | Loads `s` as byte offset into `signatures`, then reads length-prefixed sig tail. **No bounds check** that `sigOffset + 32 + sigLen` is within `signatures.length`. Malformed slot can read arbitrary memory past array end. Undefined Solidity behavior. **Add explicit bounds check.** | 🔴 OPEN |
| **CON-SIG-SLOT-002** | 🟡 Medium | `v == 2` (WebAuthn) path (120-146) | Same bounds-check gap as v=0. | 🔴 OPEN |
| CON-SIG-SLOT-003 | 🟢 Low | `v > 30` (eth_sign) path | Subtracts 4; legitimate `v ∈ {31, 32}` recovers. `v == 30` rejected via `revert InvalidSignature(v)`. Boundary correct. | 🟢 CLOSED-CONFIRMED |

### `libraries/WebAuthnLib.sol`

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| **CON-WEBAUTHN-001** | 🔴 **High** | All | Library checks challenge bytes in `clientDataJSON` and `"type":"webauthn.get"` at `typeIndex`. **Does NOT check:** (1) RP ID hash in `authData[0..32]`; (2) UP flag (bit 0 of `authData[32]`); (3) UV flag (bit 2 of `authData[32]`); (4) `clientDataJSON.origin`; (5) `clientDataJSON.crossOrigin`. **Adversary controlling a signing oracle can produce a P-256 signature over `sha256(authenticatorData \|\| sha256(clientDataJSON))` where `clientDataJSON.origin = adversary.example` and the on-chain verifier ACCEPTS.** Credential was registered at legitimate RP, but signature is being relayed. **Library should accept `expectedRpIdHash` parameter and pin it.** | 🟢 CLOSED (H7-C.1) — `WebAuthnLib.verify` now takes `bytes32 expectedRpIdHash` and calls `_checkAuthData(authData, expectedRpIdHash, requireUv)` which enforces RP-ID hash equality + UP flag (bit 0 of `authData[32]`) + optional UV flag. Cross-origin signing oracle vector closed. See `packages/contracts/src/libraries/WebAuthnLib.sol:58-88`. |
| **CON-Libraries-001** | 🔴 **High** | Coverage 16% line / 9% statement / 14% branch | P-256 verification + WebAuthn-assertion parsing security-critical and under-tested. SB-3 says malformed assertion → return false, not revert; verify negative paths covered. **Comprehensive test corpus of malformed-assertion inputs; cross-check against FIDO Alliance public test vectors.** | 🔴 OPEN |
| CON-WEBAUTHN-002 | 🟢 Low | `_checkClientData` 43-byte base64url challenge length (67) | 43 = ceil(32 * 4 / 3) without padding. Locked to 32-byte challenges. Document. | 🔴 OPEN |

### `libraries/P256Verifier.sol`

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| **CON-P256-001** | 🔴 **High** | Dispatcher | Tries RIP-7212 precompile, on failure **silently falls through to `DAIMO_VERIFIER` at hardcoded address `0xc2b78104907F722DABAc4C69f826a522B2754De4`** if that address has code. **`try fast catch slow` pattern — direct ADR-0013 violation** + unverified third-party dependency. Attacker squatting Daimo address on fork (or chain admin deploying malicious contract) → every WebAuthn signature check accepts whatever malicious verifier says. **Require chain operator explicitly configure verifier path; reject address(0) sentinel.** | 🟢 CLOSED (H7-C.2) — `P256Verifier.sol` now uses **RIP-7212 precompile only**. Daimo fallback removed entirely (no `try fast catch slow`, ADR-0013 honored, no hardcoded third-party address). Chains without RIP-7212 must wire a separate, explicitly-configured pure-Solidity verifier at the consumer layer (intentionally not hardcoded in this library). Header comment documents which chains are RIP-7212-native (Base, Polygon zkEVM, Optimism, Scroll, Linea) vs. need explicit config (pre-Pectra mainnet). |
| CON-P256-002 | 🟡 Medium | No version pinning of Daimo verifier | Library trusts whatever code at that address. If Daimo verifier upgradeable/has admin keys, upgrade compromises every account on every chain that fell back to Daimo. | 🔴 OPEN |
| **CON-Libraries-002** | 🔴 **High** | Coverage 0% direct line | Exercised transitively via `WebAuthnLib` but direct test target with edge cases (point at infinity, signature with s > n/2, malformed coords) missing. **Add `test/P256Verifier.t.sol` with Wycheproof-style edge vectors.** | 🔴 OPEN |

### `libraries/MultiSendCallOnly.sol`

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| CON-MULTISEND-001 | 🟢 Low | Standard Safe pattern | No findings. | 🟢 CLOSED-CONFIRMED |
| CON-Libraries-004 | 🟢 Low | Coverage 65% | No-value branch uncovered. Acceptable. | 🔴 OPEN |

### Naming + Identity + Ontology + Relationships (read-side contracts)

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| CON-Identity-001 | 🟡 Medium | `AgentProfileResolver.sol` 59% coverage | ERC-1056-style resolver; mostly read-only; `setProfile` paths under-covered. Flag for closure pre-launch. | 🔴 OPEN |
| CON-Ontology-001 | 🟡 Medium | `AttributeStorage` 51% / `ShapeRegistry` 62% / `OntologyTermRegistry` 90% | SHACL shape registry under-covered; on-chain ontology = vocabulary root, soundness matters. | 🔴 OPEN |
| CON-Relationships-001 | 🟡 Medium | `AgentRelationship.sol` 92% | Decent. EXT-019 (public on-chain edge model incompatible with confidentiality) applies. Mark contract `experimental` in deployments JSON. | 🔴 OPEN |
| CON-ONTOLOGY-001 / CON-PROFILE-001 | ℹ️ | Architecture | Not deeply audited at this read; not on critical authority path. Per-package SHACL/cardinality checks appropriate fail-loud. | 🟢 CLOSED-CONFIRMED |

### `script/Deploy.s.sol`

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| **CON-DEPLOY-001** | 🔴 High | All | Deploys EntryPoint + DelegationManager + CustodyPolicy + Factory + Paymaster + Validator + Naming + Ontology + Relationships + Identity all under same deployer EOA. Deployer becomes: governance for factory + paymaster; owner of `.agent`, `demo.agent`, `acme.agent`, OntologyTermRegistry, ShapeRegistry, RelationshipTypeRegistry, AgentProfileResolver. **Single-key compromise = total system takeover.** CT-1 is one finding; many roles aggregated under same EOA. | 🟢 CLOSED (R5.4 / 2026-05-31) — `script/Deploy.s.sol` now routes every governance / ownership / pause role through a single resolved `authority` address. Three branches: (a) `GOVERNANCE_MULTISIG` env var set → use it (with `.code.length > 0` invariant so an EOA misconfig is rejected); (b) testnet network (anvil / base-sepolia / sepolia) + env unset → fall back to deployer with loud multi-line warn; (c) production network + env unset → revert with explicit `GOVERNANCE_MULTISIG env var REQUIRED for network <name>` error. The documented hand-off ceremony is now a hard precondition for the broadcast. BUNDLER_SIGNER + SESSION_ISSUER are operationally separate hot-keys with their own env-overrides, falling back to authority. New `test/DeployAuthorityResolution.t.sol` (12 tests, all pass) locks every branch including the production-revert path. Roles routed via `authority`: TimelockController proposer+executor+admin, AgenticGovernance guardian+initialSigners, SmartAgentPaymaster initialOwner, OntologyTermRegistry owner, ShapeRegistry owner, AgentNameRegistry .agent root owner, RelationshipTypeRegistry owner. AgentNameRegistry constructor stays at deployer (one-shot initializer required-by-contract for the same-tx initializeRoot frontrun gate per H7-C.4 / CON-NAMING-001). |
| CON-DEPLOY-002 | 🟡 Medium | `vm.writeFile` artifact + `--private-key` JSDoc | Script run with `--private-key 0xac0974…` (anvil default printed in JSDoc 53) — broadcast can echo key into Forge logs. "Never do this in production" appears in JSDoc but script doesn't enforce. | 🔴 OPEN |
| CON-DEPLOY-003 | 🟡 Medium | `_bootstrapAgentNameOntology` + `_bootstrapRelationshipTypes` | If any fail (predicate hash collision), script reverts after some contracts already deployed. **State stranding mid-deploy.** | 🔴 OPEN |
| CON-DEPLOY-004 | 🟢 Low | `vm.envOr("PAYMASTER_STAKE_WEI", uint256(0.0005 ether))` | 0.0005 ETH too low for mainnet, appropriate for testnet. Document. | 🔴 OPEN |
| **PKG-DEPLOY-002** | 🔴 High (external P0-1 extension) | `script/Deploy.s.sol` per-role authority | **R5.4 collapsed every governance / admin / ownership role onto a single resolved `authority` address (`GOVERNANCE_MULTISIG`).** That closes the deployer-aggregation failure mode but leaves every role (timelock admin / proposer / executor, AgenticGovernance guardian + initial signer, paymaster owner, naming-root owner, ontology / shape / relationship-type admins) co-located on the same multisig. External senior-architect audit P0-1 wanted role separation: an operator should be able to point each role at a distinct multisig. | 🟢 CLOSED (R5.9 / 2026-05-31) — Per-role env-var matrix added. Each of `TIMELOCK_ADMIN`, `TIMELOCK_PROPOSER`, `TIMELOCK_EXECUTOR`, `GOVERNANCE_GUARDIAN`, `GOVERNANCE_SIGNER`, `PAYMASTER_OWNER`, `NAMING_ROOT_OWNER`, `ONTOLOGY_ADMIN`, `SHAPE_ADMIN`, `RELATIONSHIP_TYPE_ADMIN` is independently env-overridable. Unset env vars fall back to the resolved `authority` (preserving R5.4 single-multisig ergonomics for operators who don't need separation). New `Roles` struct holds the bundle; new `_resolveContractRole` helper enforces `.code.length > 0` on production networks for multisig-shaped roles (EOA-shaped hot keys `BUNDLER_SIGNER` / `SESSION_ISSUER` skip that check). Wired to: TimelockController (proposer / executor / admin all per-role), AgenticGovernance (guardian + initialSigners per-role), SmartAgentPaymaster initialOwner, OntologyTermRegistry / ShapeRegistry / RelationshipTypeRegistry owners (each per-role), AgentNameRegistry `.agent` root owner. 5 new R5.9 tests cover: env-set-with-contract on production, env-unset-returns-default, EOA-rejected-on-production, EOA-accepted-on-testnet, every role string round-trips. 545/545 contracts suite green. |
| CON-Deploy-001 (arch) | 🟡 Medium | CREATE2 determinism | Documented but unverified. Verify salt-management script asserts deployment addresses match across networks by recomputing CREATE2 + reverting on mismatch. | 🔴 OPEN |
| CON-Deploy-002 (arch) | 🟢 Low | `deployments-base-sepolia.json` flat JSON | Single object, no chainId scoping for multi-chain. Defensible v0 (testnet only); future multi-chain needs `{chainId: {…}}` shape. | 🔴 OPEN |

### Foundry tests

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| CON-TESTS-001 | 🟡 Medium | Test coverage breadth | Missing: fuzzing/invariant tests for enforcer composition; WebAuthn signature malleability fuzzing; QuorumEnforcer adversarial signature blobs. `SignatureSlotRecovery.sol` bounds-check (CON-SIG-SLOT-001) is the kind of bug fuzz would catch. | 🔴 OPEN |
| CON-TESTS-002 | 🟡 Medium | No integration test exercising off-chain `delegation.hashDelegation` vs on-chain `DelegationManager.hashDelegation` byte-exactly | Audit-F1 fix relies on byte-exactness. **Add property test: random `Delegation` structs hash to same bytes32 in TS and Solidity.** | 🔴 OPEN |
| CON-TESTS-003 | 🟢 Low | No integration test exercising off-chain `tool-policy.evaluateThresholdPolicy` → `delegation.verifyDelegationToken.requireQuorumCaveat` → `QuorumEnforcer.beforeHook` | Cross-stack assertions documented but not auto-verified. | 🔴 OPEN |

---

## 4. Cross-cutting findings

### Package-level cross-cutting

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| **XPKG-001** | 🟠 High | All `packages/*/package.json` | Every package's `license` is `UNLICENSED` despite repo-root MIT LICENSE. npm and supply-chain scanners read the package field. EXT-011 closed only the repo root. **Closure:** set `"license": "MIT"` in all 16 manifests + add `LICENSE` to each package's `files` array. | 🟢 CLOSED (R5.6 / 2026-05-31) — `python3 -c "for pj in sorted(Path('packages').glob('*/package.json')): print(json.load(open(pj)).get('license'))"` returns `MIT` for all 17 publishable packages. supply-chain scanners now read the correct field; the audit-row remediation is fulfilled. |
| **XPKG-002** | 🟠 High | `packages/delegation` + `packages/mcp-runtime` | `verifyCrossDelegation` stub in two packages. Public symbols whose existence implies capability the runtime can't do. ADR-0013 violation. Decide once: experimental subpath OR delete. | 🟢 CLOSED (H7-B.8) — removed from BOTH public surfaces. `packages/delegation/src/index.ts:28` comment: "H7-B.8: verifyCrossDelegation removed from the public surface (XPKG-002 / EXT-024)". `packages/mcp-runtime/src/index.ts:5` comment same. `packages/delegation/src/token.ts:676` retains a no-op stub with comment "H7-B.8 (XPKG-002 / EXT-024 closure)" pointing future cross-delegation work to the `./experimental` subpath per spec 100 §6 when it resumes. |
| **XPKG-003** | 🟠 High | `specs/100` + `docs/architecture/{vocabulary-map,task-routing,product-readiness-audit}.md` + 62 in-package refs (chiefly `agent-profile`) | Doctrine docs name `identity-auth` / `agent-identity` / `custody` — renamed half a year ago to `connect-auth` / `agent-profile` / `account-custody`. A first-pass reviewer cannot trust spec corpus to describe code in front of them. Mass-rename sweep. | 🔴 OPEN |
| **XPKG-001-sec (off-chain vs on-chain semantics)** | 🟡 Medium | `TimestampEnforcer.sol` `>` vs `evaluator.ts:34` `>=` | Boundary differs by 1 second at `validUntil`. Cross-stack discrepancy. | 🔴 OPEN |
| **XPKG-002-sec (evaluator inert)** | 🟠 High | `delegation/src/evaluator.ts:87-133` `evalInert` | Dispatcher for on-chain-only enforcers (`DATA_SCOPE_ENFORCER`, `DELEGATE_BINDING_ENFORCER`, `taskBinding`, `callDataHash`, `recovery`, `rateLimit`). Returns `allowed: true` after shape check. Correct ONLY when call definitely will be redeemed on-chain. For MCP-only flows call never reaches on-chain enforcer. Same root cause as PKG-DELEGATION-001. | 🟢 CLOSED (H7-B.2) — paired closure with PKG-DELEGATION-001 (R3.1). `packages/delegation/src/evaluator.ts:127` comment: "(by verifyCrossDelegation or on-chain). In strict mode (H7-B.2) we refuse". `evalInert` now respects `EvaluateOpts.enforceOnChain`: strict mode (the default — off-chain pre-checks must use it) returns `allowed: false` with reason `context-required`; only callers that explicitly opt into `{ enforceOnChain: true }` get the inert "passes on assumption of on-chain redeem" behavior. |
| **XPKG-003-sec (typehash byte-exact)** | 🟠 High | `packages/delegation/DELEGATION_EIP712_TYPES.Caveat` ↔ `DelegationManager.CAVEAT_TYPEHASH` | Match currently. **No automated CI check that verifies typehash bytes match — audit-F1 fix relies on this.** Add TS test that recomputes typehash and asserts equality with contract constant read via RPC. | 🔴 OPEN |
| **XPKG-004-sec** | 🟠 High | `key-custody` master-signer leak via `buildToolExecutorBackend` | PKG-KEY-CUSTODY-001. Cross-cuts any "agent calls tools" loop consumer builds. Primitive-level API ergonomics failure. | 🔴 OPEN |
| **XPKG-005** | 🟡 Medium | `process.env.NODE_ENV` keyed defaults | Multiple packages key off `NODE_ENV` to switch production-safe / dev-permissive: `delegation/src/token.ts:488-490`, `key-custody/src/factories.ts:18-25`, `mcp-runtime/src/with-delegation.ts:38-45`, `mcp-runtime/src/jti-stores.ts:24-25`. Cloudflare Workers don't have `NODE_ENV` unless explicit. Fallback differs per file — `delegation` falls open, `mcp-runtime` falls closed (good). **Library should not rely on `NODE_ENV` for safety-critical defaults; require explicit `environment: 'production' \| 'development'` at API.** CT-12 re-cast. | 🔴 OPEN |
| **XPKG-006** | 🟡 Medium | No package ships per-IP / per-account rate limits | `mcp-runtime` has JTI usage tracking but no rate-limit primitive. Consumers wiring a worker without external rate limiter inherit zero protection against authentication-floods. Library should ship `createRateLimitGate` primitive consumers can compose. | 🔴 OPEN |
| **XPKG-004-arch** | 🟡 Medium | Capability-manifest `stability` field unaudited | Spec 100 §6 reserves "experimental" semantics behind subpath, but several thin packages (`ontology`, `identity-directory-adapters`, `agent-relationships`) read as `experimental` in manifests yet ship top-level exports. Either upgrade or hide. | 🔴 OPEN |
| **XPKG-005-arch** | 🟡 Medium | Five packages missing `AUDIT.md` | `account-custody`, `connect`, `identity-directory`, `identity-directory-adapters`, `ontology`. Spec 100 §8 lists as required; `check:package-docs` doesn't enforce. Decide doctrine vs guard alignment. | 🔴 OPEN |
| **XPKG-006-arch** | 🟡 Medium | peer-dep range `viem ^2.21.0` in packages vs `^2.50.0` in apps | EXT-005. Tighten to `^2.21.0 \|\| ^2.50.0` explicitly OR bump all packages + document floor. | 🔴 OPEN |
| **XPKG-007** | 🟡 Medium | Test surface uneven | `types` 0 tests. `connect` 248 test vs 532 src LoC. `delegation` 1245 vs 1740 — solid. Mean disguises worst case. **Add per-package coverage threshold to CI** (`vitest --coverage` + fail if package < 60% lines). | 🔴 OPEN |
| **XPKG-008** | 🟡 Medium | Two `quorum-signature` packing impls | `agent-account/src/quorum.ts` + `account-custody/src/quorum-slots.ts`. Decide canonical owner. | 🔴 OPEN |
| **XPKG-009** | 🟢 Low | Versions all `0.0.1`; no changesets/release flow | Consumer installs `@agenticprimitives/delegation@0.0.1` today and `@0.0.1` tomorrow may get different code with no signal. Adopt `changesets` before external alpha. | 🔴 OPEN |
| **XPKG-010** | ℹ️ | Vocabulary-map drift | ARCH-036/-037 are **app-level** (apps re-used `delegate` for three things; apps introduced `bridge`). Packages themselves use terms consistently. Out-of-scope for package recommendation. | 📝 DOC |

### Contract-level cross-cutting

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| **XCON-001** | 🔴 High | Aggregate Solidity coverage 59% lines / 55% statements / 46% branches | Industry threshold for external audit firm typically ≥ 90% lines + ≥ 80% branches on security-critical. Worst: `WebAuthnLib` (16%), `P256Verifier` (0%), `DelegationManager` (42%), `AgentAccount` (55%), `SmartAgentPaymaster` (52%). | 🔴 OPEN |
| **XCON-001-sec** | 🟠 High | Single deployer-EOA controls all governance/roles/TLDs | Cross-cutting consequence of CON-DEPLOY-001 + CON-FACTORY-001 + CON-NAMING-001 + CON-PAYMASTER-002. **No separation between deploy/governance/TLD/module-registration authority.** Consumer following deploy script as documented inherits this aggregation. | 🟢 CLOSED (R5.4 / 2026-05-31) — closed alongside CON-DEPLOY-001. The deploy script's resolved `authority` address takes every governance/TLD/registry-ownership role at construction time. Operator following the documented deploy now passes `GOVERNANCE_MULTISIG=0x...` (the SA address) on the forge script command; the post-broadcast state has the multisig holding the authority surface, not the deployer EOA. CON-NAMING-001 (H7-C.4 atomic initializeRoot) + CON-DEPLOY-001 (this) close the worst of the aggregation; CON-FACTORY-001 (no-timelock rotation paths) + CON-PAYMASTER-002 (paymaster owner separation) are separate rows; with this fix, "consumer following deploy script as documented inherits aggregation" no longer holds. |
| **XCON-002** | 🟠 High | `--via-ir` forces `--ir-minimum` coverage compile | Stack-too-deep in `CustodyPolicy._verifyQuorum` means `forge coverage` won't run under same compile settings as deployed bytecode. **Coverage report is approximation.** Struct-pack call args until coverage compiles under deployment settings. | 🔴 OPEN |
| **XCON-002-sec** | 🟡 Medium | No on-chain pause/kill switch at system level | `GovernanceManaged.whenNotPaused` exists but unused. No system-wide pause for DelegationManager, no kill switch for Factory. In incident, only response is wind down Paymaster (which has dev-mode toggle). Consumer cannot easily implement "stop new account creation" lever without forking factory. | 🔴 OPEN |
| **XCON-003** | 🟡 Medium | No storage-layout snapshot tests | None of `AgentAccount`, `CustodyPolicy`, `DelegationManager` commit a `forge inspect storageLayout` snapshot. UUPS upgrade safety on `AgentAccount` is code-review-only invariant today; layout drift bug ships silently. | 🟢 CLOSED (R1.3 / 2026-05-30) — `scripts/check-storage-layouts.ts` runs `forge inspect <C> storageLayout --json`, normalizes struct/enum AST IDs, and diffs against `packages/contracts/test/storage-layouts/<C>.snap.json` for `AgentAccount`, `CustodyPolicy`, `DelegationManager`, `SmartAgentPaymaster`. Wired in `.github/workflows/ci.yml` after the forge-coverage step. Drift fails CI; rotate snapshots intentionally via `pnpm check:storage-layouts --update`. |
| **XCON-003-sec** | 🟡 Medium | EIP-712 domain name collisions across contracts | `DelegationManager.DOMAIN_SEPARATOR`: `name = "AgentDelegationManager"`, `version = "1"`. `CustodyPolicy._domainSeparator`: `name = "agenticprimitives.CustodyPolicy"`, `version = "1"`. Both version "1" — independent rotations not possible without contract redeploy. Bumping version recommended when typehash material changes; current contracts have no version-bump path (`internal constant`). | 🔴 OPEN |
| **XCON-004** | 🟡 Medium | No documented re-deploy migration plan | `deployments-base-sepolia.json` carries 22 addresses for one chain. Spec 214 §4.9 DS-1 acknowledges "every contract redeploy strands user state cleanly" but production-readiness needs migration / state-transfer plan for at least AgentAccountFactory + CustodyPolicy redeploy axes. | 🔴 OPEN |
| **XCON-005** | 🟢 Low | Generic `error InvalidSignature();` across DelegationManager + Paymaster | Opaque errors correct (spec 214 OA-5) but SAME error name in multiple contracts hurts client-side disambiguation. Namespace error names (`DelegationManager_InvalidSignature`, `Paymaster_InvalidSignature`). | 🔴 OPEN |

---

## 4b. External review #3 (life-safety-context CTO lens, 2026-05-30)

A third external review framed the packages + contracts under a "secure faith-tech / life-safety platform" CTO lens. The review scoped to `packages/` only (didn't see `packages/contracts/` — itself a finding, see EXT3-001). Mis-statements ("zero visible .sol sources", "9 packages only", "fail-open policy") are noted and rebutted in [`docs/hardening-waves/H7-packages-contracts.md`](../hardening-waves/H7-packages-contracts.md) §"Where the review is misinformed". Below are the rows we accepted into the in-scope tracker.

### Accepted

| ID | Severity | Component | One-line | Status |
|---|---|---|---|---|
| **EXT3-001** | 🔴 High | repo layout | Contracts not published as an installable npm package. A consumer wanting ABIs + flattened sources + verification scripts + deployment JSON must clone the repo. **Extract `packages/contracts` → `packages/contracts`** with `dist/{abi,flat,typed}/`, `deployments-*.json`, `scripts/verify-{chain}.sh`. Update `agent-account`, `delegation`, `account-custody` to peer-dep on it. Single largest "reviewer can't see the contracts" win. | 🔴 OPEN |
| **EXT3-002** | 🟠 High | `packages/audit` | Audit sink is not tamper-evident. `composeSinks` writes to operator-trusted sinks; nothing requires hash-chain or external anchor. For sensitive-data deployments the audit trail must be cryptographically defensible. **Add `createHashChainSink(prevHash → emit + return newHash)`** + optional `createMerkleAnchorSink({ anchorTo: ContractWriter })` that flushes Merkle roots to an `AuditAnchor` contract on a cadence. Composable; opt-in tamper-evidence. | 🔴 OPEN |
| **EXT3-003** | 🟡 Medium | all packages | No API surface snapshot test per package. `capability.manifest.json` lists names; doesn't pin shapes. A silent breaking change to a public type signature ships. **Add `api-extractor` (or `tsd` snapshot) per package; CI fails on unreviewed signature drift.** | 🔴 OPEN |
| **EXT3-004** | 🟡 Medium | `.github/workflows/` | No SLSA L3 / Sigstore provenance. Publishing today means `npm publish` from CI with no signed attestation. **Add `npm publish --provenance` (GitHub OIDC-based Sigstore) on every release; archive SBOM as release asset (currently advisory).** | 🔴 OPEN |
| **EXT3-005** | 🟡 Medium | `packages/key-custody` | No mandatory-HSM enforcement mode. `LocalAesProvider` requires `A2A_ALLOW_LOCAL_ENVELOPE_KEY=true` opt-in, but no API-level "ban local providers; require KMS" flag the deployer can pin. **Add `buildSignerBackend({ requireExternal: true })` that throws on local providers regardless of env.** Pairs with the `environment: 'production'` cleanup from H7-B.9. | 🔴 OPEN |
| **EXT3-006** | 🟡 Medium | `packages/key-custody` | No key-rotation primitive. `keyVersion: 'gcp-kms:v1'` is a string tag (see PKG-KEY-CUSTODY-008); no `rotateMasterKey(from, to, { dualRead, witnessSink })` API. Sensitive-data deployments need a documented + tested rotation ceremony. **Ship a `rotateMasterKey` primitive with dual-read window + audit witness.** Closes CT-13 / KH-5 + this. | 🔴 OPEN |
| **EXT3-007** | 🟡 Medium | `packages/delegation` + `packages/contracts/src/agency/DelegationManager.sol` | No emergency-revoke-all primitive. Per-delegation revoke + on-chain expiry only; no "burn every outstanding delegation under delegator D right now" lever. **Add `delegatorNonce(D)` in EIP-712 caveat struct + `getDelegatorNonce(D)` view on DelegationManager + verify-time inclusion**; bumping the nonce invalidates the entire outstanding cohort under one tx. Spec change; contract redeploy required. | 🔴 OPEN |
| **EXT3-008** | 🟢 Low-Med | `packages/delegation` caveat schema | No extension slot for purpose / geo-risk / sensitivity-tier metadata. Caveat structs are fixed-shape today; apps that need "purpose=research, geoRisk=high" have no neutral way to bind it. **Add a typed `metadataHash: bytes32` slot in the EIP-712 caveat struct**; library stays vertical-agnostic per ADR-0021. | 🔴 OPEN |
| **EXT3-009** | 🟠 High | `packages/contracts/script/Deploy.s.sol` | Re-stresses CON-DEPLOY-001 + CON-FACTORY-001 + XCON-002-sec under a sharper label: no standardized timelock + multisig governance pattern. **Bake `Safe + TimelockController(24h, OZ standard)` wired as `governance` for Factory + Paymaster + the registries the deploy script touches.** Deployer EOA seeds the timelock, transfers, then disappears. | 🔴 OPEN |
| **EXT3-010** | 🟡 Medium | `packages/contracts/src/` (all) | No system-wide pause/kill switch. `GovernanceManaged.whenNotPaused` modifier exists but unused in critical surfaces. **Wire `whenNotPaused` on `DelegationManager.redeemDelegation`, `AgentAccountFactory.createAgentAccount`, `SmartAgentPaymaster._validatePaymasterUserOp`.** Pause callable from the timelock OR a separate "guardian" role with no other authority. Extends XCON-002-sec. | 🔴 OPEN |
| **EXT3-011** | 🟢 Low | `packages/audit` | No verifiable-deletion receipt primitive. Credential removal emits an event but no proof-of-deletion the user / regulator can later present. **Add `createDeletionReceipt({ subject, what, when, sink, hashChainHead })` — emits + returns a signed receipt referencing the hash-chain head from EXT3-002.** Builds on EXT3-002. | 🔴 OPEN |

### Declined (with reasons — relayed to keep doctrine clear)

| Ask | Decline reason |
|---|---|
| Two-firm external audit (TS crypto + Solidity) | One Solidity firm + targeted scope on TS crypto (just `connect-auth.passkey`, `delegation.eip712`, `key-custody.derivation`) is closer to right shape at v0.1. Full TS-side firm is over-spec. |
| Differential privacy primitives in `tool-policy` | App layer. Library stays domain-agnostic per ADR-0021. Document "compose at app boundary; here's the policy-decision shape your DP wrapper needs to return." |
| VC / W3C DID integration in `connect-auth` | Defer to a future `@agenticprimitives/agent-vc` package. Conflating with the credentials surface today would bloat the boundary. |
| TSS / MPC fallback in `key-custody` | Defer past v0.1. Our quorum custodian story (`CustodyPolicy` thresholds) IS the production answer to "no single signer compromises the SA"; threshold-on-the-signer-itself is a future capability. |
| "Lives-impact" / faith-context threat model in package READMEs | Violates ADR-0021 (packages are generic). App-layer threat models live in app docs. Pure-library threat models live in `AUDIT.md` per package — verify each says "if X is wrong, Y is possible" plainly. |
| Geo-risk / regional risk overrides baked into `tool-policy` | App layer. EXT3-008 gives apps the schema slot; policy logic itself is app-side. |
| "Top-level `contracts/` package" | Half-right — extract as `packages/contracts`, not top-level. Matches the rest of the monorepo shape (EXT3-001). |

---

## 5. Existing audit items — in-scope vs out-of-scope classification

The existing audit doc (`docs/audits/2026-05-pre-production-readiness.md`) contains 23 SEC + 22 ARCH + 18 D + 37 EXT rows. Re-classified under this packages+contracts lens:

### In-scope (still open at the package/contract layer)

| Existing ID | Source | Maps to new finding | Notes |
|---|---|---|---|
| **CT-1 (N1)** disclosed deployer EOA | threat-model | CON-DEPLOY-001 + CON-FACTORY-001 + XCON-001-sec | Contract has no defense; operator concern but baked into deploy script |
| **CT-3** off-chain quorum not implemented | threat-model | PKG-delegation-002 / PKG-DELEGATION-001 | Library refuses fail-closed (good); blocks PII/org tools from quorum-required |
| **CT-4** third-party contract audit | threat-model | (no new finding; gate) | Pre-launch blocker — see §7 |
| **CT-5** paymaster sponsorship budget | threat-model | CON-PAYMASTER-001..004 | `SmartAgentPaymaster.sol` has no `setBudget(account, limit)` API |
| **CT-6** per-tool HKDF | threat-model | **PKG-KEY-CUSTODY-001 (now Critical)** | More severe than P2 — API actively misleads |
| **CT-9** `generateServiceMac` no issuing-side sink | threat-model | PKG-MCP-RUNTIME-006 | OPEN |
| **CT-11** `composeSinks` swallows | threat-model | PKG-AUDIT-001 / PKG-audit-001 | Re-cast High at package level |
| **CT-12** `NODE_ENV` default-to-dev | threat-model | XPKG-005 | Package-side fix: stop keying off NODE_ENV |
| **CT-13** naming Phase 2 cross-package integration | threat-model | (open) | — |
| **N4** verification gas ceiling | threat-model | PKG-AGENT-ACCOUNT-001 | Re-cast |
| **N13** managed MAC key rotation | threat-model | (open KH-5) | — |
| **N14** passkey UV preferred vs required | threat-model | CON-WEBAUTHN-001 | On-chain doesn't verify UV at all (deeper finding) |
| **N15** contracts audit dossier | threat-model | (open) | — |
| **ARCH-006 / ARCH-038** public-exports drift | dossier | **PKG-KEY-CUSTODY-002 / PKG-key-custody-001** | STILL FAILING. Most embarrassing find. |
| **ARCH-011** audit-sink wiring | dossier | PKG-audit-001 | Package surface side: composeSinks fail-soft |
| **ARCH-018** stale dist artifact | dossier | PKG-agent-profile-002 | OPEN |
| **EXT-019** Privacy Fork | dossier | PKG-agent-relationships-001 | OPEN; biggest single architectural item |
| **EXT-020** master-signer-in-tool-path | dossier | PKG-KEY-CUSTODY-001 / PKG-key-custody-002 | Re-cast Critical |
| **EXT-022** audit fail-soft | dossier | PKG-audit-001 | OPEN |
| **EXT-023 / EXT-025** strict-mode caveats | dossier | PKG-DELEGATION-001 + PKG-delegation-003 | OPEN |
| **EXT-024** `verifyCrossDelegation` stub | dossier | PKG-delegation-001 / PKG-mcp-runtime-001 + XPKG-002 | OPEN |
| **EXT-026 / EXT-032** `McpAuthError` PII | dossier | PKG-MCP-RUNTIME-003 / PKG-mcp-runtime-003 | OPEN |
| **EXT-027** JTI DDL hot path | dossier | PKG-MCP-RUNTIME-001 / PKG-mcp-runtime-002 | Re-cast High |
| **EXT-028** same-origin JWT thin | dossier | PKG-connect-auth-002 / PKG-CONNECT-AUTH-003 | OPEN |
| **EXT-030** email-derived salt | dossier | **PKG-CONNECT-AUTH-002 / PKG-connect-auth-001** | Baked into library API; not a demo concern |
| **EXT-034** tool classification registry fail-closed | dossier | PKG-TOOL-POLICY-002 / PKG-tool-policy-002 | OPEN |
| **EXT-037** audit action vocabulary | dossier | PKG-audit-002 | OPEN |
| **EXT-021** self-hosted AA stack burden | dossier | (deferred) | Operational decision, not package-shape bug |
| **EXT-013** third-party contract audit | dossier | (gate) | Pre-launch — see §7 |
| **EXT-011** UNLICENSED | dossier | **XPKG-001** | Repo root closed; packages still UNLICENSED |
| **EXT-003 / EXT-004 / EXT-012** package proliferation | dossier | §2 "Earned-but-thin" map (PKG-ontology-001) | Don't consolidate yet; mark stability + revisit at v0.1 |
| **EXT-005** loose peer-dep ranges | dossier | XPKG-006-arch | OPEN |
| **EXT-006** `--passWithNoTests` stubs | dossier | XPKG-007 | OPEN |

### Out of scope under this lens

The following existing findings are **app-level** and explicitly **NOT included** in this audit's scope:

`SEC-001..008, -010, -012..017, -024..035`; `ARCH-001..005, -007..010, -012..017, -019..037, -039..042`; `D-1..D-18`; `EXT-001, -002, -007..010, -014..018, -029, -031, -033, -035, -036`.

**Net:** ~25 of the dossier's ~113 prior findings re-classify as **in-scope at the package/contract layer**; the remaining ~88 are demo / app integration concerns out of scope for this lens.

---

## 6. CI / build / publish posture

### What's there today (good)

- `ci.yml`: install (frozen-lockfile + strict-peer-deps gate), `pnpm check:all`, build, typecheck, vitest unit + integration, Foundry forge test. Comprehensive baseline.
- `security.yml`: CodeQL JS/TS (security-extended), `pnpm audit --audit-level=high` blocking, gitleaks secret-scan, CycloneDX SBOM (advisory), strict-peer-dep validation as separate job.
- Per-package vitest setup consistent across packages.
- 358 / 358 Foundry tests pass.

### What's missing for a third-party library consumer

| Missing | Severity | Why it matters |
|---|---|---|
| **CodeQL for Solidity** | High | Spec 214 SC-6 calls for both TS + Solidity SAST. Current is JS-only. Add `languages: [javascript-typescript, solidity]` OR run Slither/Mythril alongside. |
| **Forge coverage in CI with thresholds** | High | `forge coverage` not in `ci.yml`. XCON-001 at 59%; threshold gate would have caught WebAuthnLib regression to 16%. |
| **vitest coverage in CI with per-package thresholds** | Medium | No `--coverage` on vitest invocations. XPKG-007. |
| **Storage-layout snapshot tests** | Medium | XCON-003 — UUPS layout drift ships silently. |
| **Changesets / release workflow** | Medium | No `.changeset/` directory; no `release.yml`. Pre-publish manual today. XPKG-009. |
| **`check:public-exports` part of `check:all` but RED** | High | Either fix drift (PKG-KEY-CUSTODY-002) or remove guard. Doctrine that doesn't enforce is anti-doctrine. |
| **No semver-major axis** | Medium | All 16 versions `0.0.1`. `stability: experimental` in capability manifests is only signal; npm semver gives none. |
| **No `.npmrc publishConfig: access:public`** in package manifests | Low | Pre-publish concern; flag for release wave. |

### What's there but needs hardening

- `pnpm audit --audit-level=high` blocks. Weekly cron also blocking. Good.
- SBOM is `continue-on-error: true` (advisory). Spec 214 SC-3 calls for SBOM archived per release — verify release workflow consumes the artifact.
- gitleaks default ruleset — review `.gitleaks.toml` allowlists for golden-test fixtures.

---

## 7. Suggested wave plan (consolidated)

Auditor-recommended ordering, factoring in both the security and architecture lenses:

| Wave | Items | Closes |
|---|---|---|
| **W1 — Doctrine-green** (pre-anything-else) | Fix `key-custody` `check:public-exports` drift (manifest or code); set `"license": "MIT"` in all 16 package manifests + add LICENSE file array; mass-rename `identity-auth`→`connect-auth`, `agent-identity`→`agent-profile`, `custody`→`account-custody` across spec 100 + `docs/architecture/*` + 62 in-package refs; add missing `AUDIT.md` to 5 packages (or update spec 100 §8). | ARCH-006/-038, PKG-KEY-CUSTODY-002, XPKG-001, XPKG-003, XPKG-005-arch, EXT-011, PKG-agent-profile-001 |
| **W2 — Public surface hardening** (biggest production-readiness leverage) | `connect.mintIdToken` add `BoundMintIdTokenInput` + `verifyEnrollmentGrantBinding` (PKG-connect-001); `delegation.evaluator` strict-mode (`enforceOnChain: true` opt or default-deny on missing context) (PKG-DELEGATION-001); `key-custody.buildToolExecutorBackend` rename to `…NoIsolation` or throw in non-test (PKG-KEY-CUSTODY-001); `connect-auth.verifyUserSignature` typed result (`{ok\|invalid\|rpc}`) (PKG-CONNECT-AUTH-001); `mcp-runtime` JTI store DDL-out-of-hot-path + `migrate()` API (PKG-MCP-RUNTIME-001); `audit.composeSinks` split fail-soft vs fail-hard (PKG-audit-001); `verifyCrossDelegation` experimental subpath or delete (XPKG-002); `verifyAgentSession.expectedAud` required (PKG-CONNECT-001-sec). | SEC-001/-002 root cause (PKG-connect-001), PKG-DELEGATION-001, PKG-KEY-CUSTODY-001, PKG-CONNECT-AUTH-001, EXT-020, EXT-022..025, EXT-027 |
| **W3 — Contract coverage + critical surface** | WebAuthnLib RP-ID / origin / UP / UV checks (CON-WEBAUTHN-001); P256Verifier reject Daimo fallback unless explicitly configured (CON-P256-001); SignatureSlotRecovery bounds checks (CON-SIG-SLOT-001/-002); coverage to ≥85% on AgentAccount + DelegationManager + CustodyPolicy + WebAuthnLib + P256Verifier; resolve `--via-ir` stack-too-deep in CustodyPolicy._verifyQuorum (XCON-002); CON-NAMING-001 atomic deploy+init OR governance-gated initializeRoot; storage-layout snapshot tests (XCON-003). | CON-NAMING-001, CON-WEBAUTHN-001, CON-P256-001, CON-SIG-SLOT-001/-002, XCON-001/-002/-003, CON-AgentAccount-001, CON-DelegationManager-001, CON-CustodyPolicy-001 |
| **W4 — Email-derived-salt redesign + PII surface** | `connect-auth.deriveSaltFromEmail` — mix in server-side secret OR per-deployment random component; document threat model loudly (PKG-CONNECT-AUTH-002 / EXT-030); `mcp-runtime` split `PublicMcpAuthError` vs `PrivateAuthFailureContext` (PKG-MCP-RUNTIME-003); add audit action registry (PKG-audit-002 / EXT-037). | PKG-CONNECT-AUTH-002, PKG-MCP-RUNTIME-003, PKG-audit-002 |
| **W5 — Cross-stack invariants + CI hardening** | TS↔Solidity typehash byte-exact equality test (XPKG-003-sec); off-chain vs on-chain `validUntil` boundary alignment (XPKG-001-sec); coverage thresholds in CI (vitest per-package + forge); CodeQL Solidity OR Slither/Mythril; changesets release flow; storage-layout snapshots committed. | XPKG-001-sec, XPKG-003-sec, XPKG-007, XPKG-009, XCON-003 |
| **W6 — External contract audit + alpha gate** | Halborn / Certik / Spearbit / OpenZeppelin light review of `key-custody` + `delegation` + `connect-auth` + `connect` + contracts. Address findings. | EXT-013, N15 |
| **R/N — production substrate (deferred)** | Refactor: spec 209 validator-module extraction (CON-AgentAccount-002); quorum-packing consolidation (XPKG-008); `agent-relationships` mark experimental + private alternative (PKG-agent-relationships-001 / EXT-019); per-app delegate SA split (post SEC-003 / ARCH-024 alignment). | Architectural debt, no shipping blocker until external review |

**Hard gates before any third-party adopter**: W1 (doctrine-green) + W2 (public surface hardening) + W3 (contract coverage + WebAuthn/P256 hardening) + W6 (external audit). W4/W5 can ship alongside.

---

## 8. Re-audit policy

Same as the existing dossier: each closed finding gets a row in `evidence-checklist.md`; closed rows get commit SHAs inline; after each wave, re-run `security-auditor` + `technical-architect-auditor` with `select:<closed-ids>` to verify no regression. ⚪ ACCEPTED entries need written justification + re-evaluation date.

---

## 9. Files referenced (load-bearing)

**Packages** (highest-frequency):
- `packages/key-custody/{src/index.ts,capability.manifest.json,src/factories.ts,src/derive-subject.ts,src/providers/{local,gcp,aws}.ts,src/types.ts}`
- `packages/delegation/src/{token.ts,evaluator.ts,hash.ts,caveats.ts}`
- `packages/connect-auth/src/{verify-signature.ts,salt.ts,sessions.ts,csrf.ts,methods/passkey.ts,methods/google.ts}`
- `packages/connect/src/{token.ts,broker.ts}`
- `packages/mcp-runtime/src/{with-delegation.ts,jti-stores.ts,service-mac.ts}`
- `packages/audit/src/index.ts`
- `packages/tool-policy/src/{decision.ts,lint.ts}`
- `packages/agent-account/src/{client.ts,quorum.ts}`
- `packages/account-custody/src/quorum-slots.ts`
- `packages/agent-profile/src/{errors.ts,client.ts}` (62 stale `[agent-identity]` refs)

**Contracts**:
- `packages/contracts/src/{AgentAccount,AgentAccountFactory,SmartAgentPaymaster,ApprovedHashRegistry,UniversalSignatureValidator}.sol`
- `packages/contracts/src/agency/DelegationManager.sol`
- `packages/contracts/src/custody/CustodyPolicy.sol`
- `packages/contracts/src/enforcers/{AllowedTargets,AllowedMethods,QuorumEnforcer,Timestamp,Value,CaveatEnforcerBase}.sol`
- `packages/contracts/src/libraries/{WebAuthnLib,P256Verifier,SignatureSlotRecovery,MultiSendCallOnly}.sol`
- `packages/contracts/src/naming/{AgentNameRegistry,PermissionlessSubregistry,AgentNameUniversalResolver}.sol`
- `packages/contracts/script/Deploy.s.sol`
- `packages/contracts/deployments-base-sepolia.json`

**Doctrine + dossier**:
- `CLAUDE.md`, `specs/100`, `specs/213`, `specs/214`
- `docs/architecture/{vocabulary-map,task-routing,cross-cutting-capabilities,package-consumer-map,product-readiness-audit}.md`
- `docs/architecture/decisions/0013-no-silent-fallbacks.md` (ADR-0013)
- `docs/audits/{threat-model,evidence-checklist,architecture-diagram}.md`
- `docs/audits/2026-05-pre-production-readiness.md` (the demo-tainted doc — out of scope for this lens but cross-referenced)

**CI / build**:
- `.github/workflows/{ci,security}.yml`
- `scripts/check-public-exports.ts`
- `scripts/check-package-docs.ts`
