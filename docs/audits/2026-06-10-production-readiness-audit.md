# Production-readiness audit — all packages + all contracts (2026-06-10, post-remediation)

**Auditor:** internal independent pass (assistant-led; 5 parallel security-auditor subagent package reviews + direct line-by-line contract fix verification by the lead).
**Scope:** all 29 `packages/*` (incl. `contracts` — 42 `.sol` files), the findings ledger, CI gates, and the morning's remediation wave (commits `ae6714a`…`bbfedc3`, 2026-06-09 → 2026-06-10).
**Baseline:** [2026-06-10 contract-by-contract deep dive](2026-06-10-contract-by-contract-audit.md) + [`findings.yaml`](findings.yaml) (49 findings: 25 closed, 22 open, 2 accepted-risk) + per-package `AUDIT.md` set.
**Method:** every "closed" claim re-verified against source (not just anchor presence); every open contract finding spot-re-verified still-open; full test suites executed this session.

## 0. Executive verdict

**Test/pilot-ready on testnet; NOT production-ready for real funds / real authority / real PII.**

The morning's remediation wave closed the three contract-layer items this audit series flagged as mainnet-blocking — **CA-F1** (pre-deploy custody hijack), **AN-1-ONCHAIN** (on-chain label normalization), **ATT-1** (unbound joint-agreement issuer signature) — plus AGR-1/ATT-3/SIG-1 hygiene, and made the DEL-001 session-delegation binding mandatory per-source with a fail-closed runtime guard. All fixes are verified in source with the Base Sepolia stack redeployed (2026-06-10 11:21 MDT).

What still blocks production (detailed in §4):

1. **Governance keys** — CON-FACTORY-001 (High, open): live factory + paymaster governance is the disclosed testnet deployer EOA. Accepted for testnet (ADR-0028); a hard production blocker.
2. **DEL-001 enforcement is per-source, not universal** — the library default is still opt-in (`requireSessionDelegateBinding`); ledger correctly reports ENFORCEMENT-PENDING. Flipping the global default fail-closed is the remaining ADR.
3. **Custody install-path validation** — CP-1/CP-2 (Medium): unconfigured tiers collapse to 1-of-n; recoveryApprovals unvalidated at install.
4. **Paymaster ERC-7562 + ownership** — PM-1/PM-2 (Medium): sponsored ops droppable by compliant bundlers; deposit drainable by owner.
5. **Third-party contract audit** — not yet engaged (process gate).
6. Delegation cumulative-budget semantics (DM-1/DM-2/EN-11/EN-13/EN-22) and WebAuthn malleability/UV (WA-1/WA-2) before value-bearing delegation at scale.

## 1. This morning's remediation — independently verified

| Finding | Was | Fix verified (file · evidence) | Status |
| --- | --- | --- | --- |
| **CA-F1** factory custody-config front-run | High | `AgentAccountFactory.sol:159-196,219-232` — `_effectiveSalt(params, timelockOverrides, salt)`: CREATE2 salt now commits to **mode + trustees + per-tier timelocks** (not just custodians/passkey); `getAddress` takes the same triple. Full Base Sepolia redeploy (`bbfedc3`, deployments file 11:21). | **CLOSED · production-enforced** |
| **AN-1-ONCHAIN** no on-chain label charset | High | `AgentNameRegistry.sol:173-184` — `_validateLabel`: `[a-z0-9-]`, 1..63 bytes, no leading/trailing `-`; enforced at `register` (:207) **and** `initializeRoot` (:257). Homoglyph/mixed-case/zero-width/embedded-dot squatting by direct callers is dead. | **CLOSED · production-enforced** |
| **ATT-1** joint issuer sig over bare hash | High | `AttestationRegistry.sol:74,246-255` — `JOINT_ISSUER_TYPEHASH` digest binds parties/subject + schema + credentialType + `block.chainid` + `address(this)`; recomputed on-chain (SC-2 bug class now fully closed). TS exports (`jointIssuerDigest`) + api-surface snapshot regenerated. | **CLOSED · production-enforced** |
| **ATT-3** consent digest unbound | Medium | `AttestationRegistry.sol:263-272` — joint-consent digest binds chainId + registry address. demo-jp caller passes both (`0308ad4`). | **CLOSED** |
| **AGR-1** transition digest chain binding | Medium | `AgreementRegistry.sol:249` — `TRANSITION_TYPEHASH` digest includes `block.chainid` + `address(this)` + nullifier. (Deep dive had judged the pre-existing binding sufficient; the explicit typehash hardening landed anyway.) | **CLOSED** |
| **SIG-1** raw `ecrecover` in registries | Low | `AttestationRegistry.sol:377-382` — EOA paths route through OZ `ECDSA.tryRecover` (rejects high-s + malformed lengths); same import in `AgreementRegistry.sol`. | **CLOSED** |
| **DM-VERIFYAUTH-1** chain-only verify misuse | Low | `DelegationManager.sol:254-310` — ⚠️ DANGER doc on `verifyAuthorization` + dedicated `verifyAuthorizationForCall` that evaluates every caveat. | **CLOSED** |
| **DEL-001** session key not bound to authority | Critical | `delegation/src/token.ts` (`sessionDelegateBindingError` anchor), mcp-runtime fail-closed `strictSessionBinding` construction guard, remint-attack regression (`a5cb816`), production preflight refuses unbound chain. Library default remains opt-in → **ENFORCEMENT-PENDING** (per-source, not universal). | **CLOSED · test-covered (pending global default flip)** |

Gate evidence (run this session): `pnpm check:audit-freshness` ✓ (49 findings, all anchors resolve; DEL-001 correctly reported ENFORCEMENT-PENDING) · `forge test` **774/774** across 58 suites · `pnpm test:unit` **27/27 package suites green** (~1,050 tests).

## 2. Contract layer — current state (42 .sol files)

Per-contract detail lives in the [deep dive](2026-06-10-contract-by-contract-audit.md); this section records the post-remediation delta + re-verification of open items.

### 2.1 Group verdicts (post-remediation)

| Group | Verdict | Notes |
| --- | --- | --- |
| A — Account core (`AgentAccount`, factory, validator, registry) | **Conditionally ready** | CA-F1 closed (was the Group A blocker). Open: CA-1 (dead upgrade timelock), CA-2 (ERC-1271 cross-account binding). 774-test suite + Halmos onlySelf proofs intact post-fix. |
| B — Delegation + enforcers | **Sound; semantics caveats** | No Critical/High. Open cluster: per-call-vs-cumulative (DM-1/EN-22), identical-call replay (DM-2/EN-13), EN-11 zero-threshold fail-open (re-verified open: `QuorumEnforcer.sol:160-165` has no `threshold==0` revert). DM-VERIFYAUTH-1 closed. |
| C — Custody / paymaster / governance / crypto libs | **Needs work before mainnet** | CP-1 re-verified open (`CustodyPolicy.sol:374` install skip-if-zero; `:433` `_approvalsValue` 1-of-n fallback). CP-2, PM-1 (re-verified: governance `staticcall` in validation `SmartAgentPaymaster.sol:238`), PM-2, GOV-1, WA-1/WA-2 open. |
| D — Naming + identity | **Materially improved** | AN-1-ONCHAIN closed (the Group D blocker). Open: AN-2 (decorative expiry), SUB-1/SUB-2 (demo-grade subregistry), RES-1 (Low). |
| E — Registries (attestation/agreement/ontology/skills/geo/relationships) | **Strongest group** | ATT-1/ATT-3/AGR-1/SIG-1 closed. Open: ATT-2 (cosmetic revocation — salt-replay re-anchor), ONT-4/ONT-7 (Low, by-design caveats). |

### 2.2 Open contract findings (re-verified 2026-06-10)

| ID | Sev | One-line | Production gate? |
| --- | --- | --- | --- |
| CON-FACTORY-001 | High | Testnet deployer EOA holds factory+paymaster governance (ADR-0028 accepted testnet) | **YES — rotate/redeploy before any production** |
| CP-1 | Med | Unconfigured custody tiers default 1-of-n (`:374`, `:433`) | YES (custody-bearing launches) |
| CP-2 | Med | `recoveryApprovals` unvalidated at install (T6 brick) | YES (custody-bearing launches) |
| PM-1 | Med | ERC-7562 violation: governance read in validation (`:238`) | YES (sponsored-ops product) |
| PM-2 | Med | Paymaster deposit drainable by Ownable owner | YES (deploy-ceremony: owner=timelock) |
| DM-1 / EN-22 | Med | Caveat caps per-call, not cumulative | Before value-bearing delegation |
| DM-2 / EN-13 | Med | Quorum/approved-hash sigs lack nonce (identical-call replay) | Before value-bearing delegation |
| EN-11 | Med | `threshold==0` passes with zero signatures | Before value-bearing delegation |
| WA-1 / WA-2 | Med | P-256 low-s not enforced; UV opt-in (live caller passes false) | Before passkey-custody at scale |
| GOV-1 | Med | Immutable guardian perpetual re-pause DoS | Accepted with runbook, or fix |
| CA-1 / CA-2 | Med | Dead upgrade timelock; ERC-1271 cross-account binding | CA-2 before shared-custodian deployments |
| AN-2, SUB-1/2 | Med | Decorative expiry; subregistry front-run/sybil | Before naming GA |
| ATT-2 | Med | Revocation re-anchorable via salt replay | Before revocation-load-bearing flows |
| RES-1, ONT-4, ONT-7 | Low | Resolver owner-fallback; caller-supplied store; abstract base gates | Tracked |

## 3. Package layer — per-package verdicts (29 packages, 5 independent review groups)

Each group was reviewed by an independent security-auditor pass against current source; every relevant ledger closure was re-verified (anchor + effectiveness), and new findings are recorded with `NEW-*` IDs. All 27 package unit suites pass.

### 3.1 Group C — naming / identity / relationships (6 packages)

| Package | Verdict | Notes |
| --- | --- | --- |
| `agent-naming` | **Conditionally ready** | AN-1 re-verified closed end-to-end: `normalizeLabel` on every registration path (`custody.ts:53,:281`, `client.ts:221`); SDK charset exactly matches on-chain `_validateLabel`. ADR-0012/0013 clean (no log scans, no fallbacks). Open contract items (AN-2, RES-1, SUB-1/2) have **no SDK-side mitigations** — acceptable at rating, noted for dossier. |
| `agent-profile` | **Conditionally ready** | Canonical-JSON + content-hash substrate solid. Two new P2s in live `fetchProfile` (below) are the group's only production blockers. |
| `identity-directory` | **Ready** (ADR-0015 non-authority scope) | Indexer-proposes / chain-confirms enforced per candidate; null is terminal; no chain access in core. |
| `identity-directory-adapters` | **Conditionally ready** | In-memory indexer is demo-grade as spec'd; one P3 (chain-id discard). |
| `agent-relationships` | **Conditionally ready** | Propose→confirm→revoke consent flow enforced by contract `msg.sender`; SDK adds no bypass. Two P3 consumer footguns. |
| `related-agents` | **Ready** | Pure shape+caveat builders; RA-1..4 invariants hold; caveat inputs fail loud upstream. |

**New findings (group C):**

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| NEW-AP-1 | **P2** | `agent-profile/src/client.ts:104` | Integrity check skipped when on-chain anchor is zero — a profile with URI-but-no-hash is served **unverified** (fail-open vs the package's own invariant). |
| NEW-AP-2 | **P2** | `agent-profile/src/client.ts:93-98` | `fetchProfile` fetches an attacker-controlled URI from chain with no scheme allowlist / size cap / redirect policy → **SSRF** for server-side consumers. |
| NEW-AN-1 | P3 | `agent-naming/src/client.ts:235` | `registerSubname` + `initialRecords` without explicit resolver writes records to the read-aggregator while on-chain resolver stays 0x0 (records lost). |
| NEW-IDA-1 | P3 | `identity-directory-adapters/src/caip10.ts:19-25` | `addressOf` casts without hex validation; chainId component discarded on confirm → poisoned indexer entry confirmable against wrong chain. |
| NEW-AR-1 | P3 | `agent-relationships/src/client.ts:103-142` | Edge listings return PROPOSED+REVOKED by default; spec says PROPOSED must not influence policy — consumer footgun. |
| NEW-AR-2 | P3 | `agent-relationships/src/client.ts:199-232` | Single role bag surfaced as `subjectRoles` with `objectRoles` always empty — type-level misattribution risk. |

### 3.2 Group A — auth / connect / account (7 packages)

All 7 suites green (310 tests). Ledger cross-checks **CN-1 ✓, CA-001 ✓, CA-003 ✓, KC-001 ✓** — anchors real and effective, not cosmetic.

| Package | Verdict | Notes |
| --- | --- | --- |
| `connect` | **Conditionally ready** | CN-1 confirmed (`expectedIss` type+runtime fail-closed, `token.ts:127,165-170`). Condition: NEW-CONNECT-1; AUDIT.md stale (lists closed items as open). |
| `connect-auth` | **Conditionally ready** | CA-001 confirmed (`expectedNonce` runtime-required, `siwe.ts:159-161`). Conditions: NEW-CONNECT-AUTH-1/2 below. Google OIDC turns out fully implemented + solid (doc drift, not stub). |
| `browser-identity` | **Ready** | Pure selector, fail-safe fallback. No findings. |
| `fedcm-idp` | **Conditionally ready** | Fail-closed parsing; `private:true` until live-Chrome (145+) field-contract verification. |
| `fedcm-rp` | **Ready** | Throw-on-failure wrapper; verification downstream. |
| `account-custody` | **Ready** | Boundary validation (zero-digest rejected, dup-signer rejected); one low (uncapped recovery arrays vs stated invariant). |
| `agent-account` | **Conditionally ready** | CA-003/KC-001 confirmed; **CA-F1 client plumbing threaded correctly** (timelockOverrides in predict+assert+deploy, `client.ts:206-288`). Two lows. |

**New findings (group A):**

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| NEW-CONNECT-AUTH-1 | **Medium** | `connect-auth/src/methods/siwe.ts:154,170` | `allowedDomains` optional — omitting it accepts SIWE signed for any domain (same caller-optional class CA-001 closed for nonce). Make required. |
| NEW-CONNECT-AUTH-2 | Low | `connect-auth/src/sessions.ts:124-132` | Production gates keyed on `NODE_ENV==='production'` — unset on Cloudflare Workers (the deploy target), so `verifySession` iss/aud enforcement silently optional. (CSRF stays fail-closed.) |
| NEW-CONNECT-1 | Low | `connect/src/token.ts:373-401` | `verifyIdToken` lacks the `iat` clock-skew check that `verifyAgentSession` got. |
| NEW-CONNECT-AUTH-3 | Low | `connect-auth/src/verify-signature.ts:159-161` | Silent simulate→view fallback (ADR-0013 tension); deny-direction. |
| NEW-AGENT-ACCOUNT-1 | Low | `agent-account/src/quorum.ts:100` | `ADMIN_VERB_EXECUTE` constant hex-decodes truncated (`"ADMIN_EXECUT"`); deny-direction footgun. |
| NEW-AGENT-ACCOUNT-2 | Low | `agent-account/src/client.ts:339-424` | View helpers swallow errors → `false`/`0n`, conflating RPC outage with "not authorized". |
| NEW-ACCOUNT-CUSTODY-1 | Low | `account-custody/src/actions.ts:221-257` | Stated cap on recovery owner arrays (CON-CUSTODY-003) not implemented. |

### 3.3 Group E — commerce spine / audit / types (6 packages)

All suites green; dep graphs inspected — **no back-edges** (boundary doctrine holds).

| Package | Verdict | Notes |
| --- | --- | --- |
| `payments` | **N/A (stub)** | Types + 2 assert helpers exist; EIP-712 builder/signer/verifier + rails do NOT. One P2 honesty finding (below). |
| `fulfillment` | **Not ready (foundational)** | Real code finding: NEW-FLF-1. State machine has no actor authorization (undocumented). |
| `intent-marketplace` | **Not ready (foundational)** | Advisory-only scoring helpers; AUDIT.md overclaims (`projectFor` doesn't exist). Known missing-topic→1.0 scoring hole already tracked. |
| `intent-resolver` | **N/A (stub)** | Honestly labeled, but AUDIT.md describes receipt behavior the code doesn't have (NEW-IR-1). |
| `audit` | **Conditionally ready** | Runtime solid (fail-soft vs fail-hard sink semantics correct, PII guardrail). The *freshness gate* is the weak spot — NEW-AUD-1/2/3. |
| `types` | **Ready** | Pure, zero deps, transport-agnostic ✓. Minor doc staleness. |

**New findings (group E):**

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| NEW-AUD-1 | **P2** | `scripts/check-audit-freshness.ts:165-204` | `enforcement` dimension is **self-attested** — declaring `production-enforced` requires zero evidence and suppresses the ENFORCEMENT-PENDING warning; 12 findings already claim it. Require `tests:` evidence for ≥ production-enforced. |
| NEW-PMT-1 | **P2** | `payments/AUDIT.md:3-9` | AUDIT.md claims the EIP-712 mandate builder/signer/verifier + three rails are shipped; none exist in src. Inverse-ARCH-1 (shipped-over-stub) — gate-invisible. |
| NEW-FLF-1 | **P2** | `fulfillment/src/index.ts:126-131` | `isHandoffAllowed` (doc-labeled the FLF-INV-09 runtime enforcement) silently ignores `requiresUserApproval`, `preservePrivacyTier`, `allowedScopes`, `maxHopCount`. |
| NEW-AUD-2 | P3 | `scripts/check-audit-freshness.ts:151-163` | Anchor check is bare `includes()` — ARCH-1's anchor is the word `STUB`; comments satisfy it. |
| NEW-AUD-3 | P3 | `scripts/check-audit-freshness.ts:69` | Parser breaks at first column-0 line — findings below a stray line silently exempted (49/49 today). |
| NEW-FLF-2 | P3 | `fulfillment/src/index.ts:50-82` | Lifecycle transitions have no actor authorization; not documented as absent. |
| NEW-IM-1/IM-2, NEW-IR-1 | P3 | (see group report) | Charter-vs-src overclaims; latent type-level dep cycle allowance between intent packages. |

**Cross-cutting (group E):** three of the four spine packages have AUDIT.md charters written against the *spec*, not the *src*. Recommended gate: a "charter-vs-exports" inverse of `check:audit-stub-drift`.

### 3.4 Group B — delegation / custody / runtime core (5 packages)

The security-critical core. Targeted suites pass (141 tests). Ledger cross-checks **DEL-001 ✓ (test-covered, enforcement-pending), PKG-DELEGATION-001 ✓, KC-001 ✓, XPKG-002 ✓** — all anchors real and effective.

| Package | Verdict | Notes |
| --- | --- | --- |
| `delegation` | **Conditionally ready** | `sessionDelegateBindingError` + `strictSessionBinding` fail-closed throw + USV leaf checks confirmed in `token.ts`; evaluator strict default denies missing context + unknown enforcers. Condition: library default for `requireSessionDelegateBinding` still opt-in (the DEL-001 global-default ADR). |
| `key-custody` | **Conditionally ready** | No silent backend fallback in prod (`backendOrEnv` throws); `LocalAesProvider` blocked in production/ambiguous runtimes unless explicit override. Condition: operational — `A2A_ALLOW_LOCAL_*` must never be set in production (preflight enforces). |
| `tool-policy` | **Ready** | Deny-first, closed-enum classification validation; unknown `@sa-tool/@sa-auth/@sa-risk-tier` → deny. No new findings. |
| `mcp-runtime` | **Not ready** | One new P1 (NEW-MCP-1, below — independently re-verified by the lead auditor). DEL-001 wiring confirmed; JTI sqlite/postgres upsert atomic. |
| `a2a` | **Conditionally ready** | Spec-269 auth gate confirmed (delegate/requester binding, target+method caveats, fail-closed revocation, message-id replay). One P2 info-leak (NEW-A2A-1). |

**New findings (group B):**

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| NEW-MCP-1 | **P1** | `mcp-runtime/src/jti-stores.ts:50` | `createMemoryJtiStore()` still infers environment from `NODE_ENV` when `opts.environment` omitted — **directly contradicting its own H7-B.9 doc comment** ("we no longer infer from NODE_ENV"). On Workers/SES (`process.env` absent) it resolves to `development`, skips the production throw, and silently ships non-durable replay protection. Lead-verified at source. Fix: make `environment` required, or throw when it cannot be determined. |
| NEW-A2A-1 | **P2** | `a2a/src/agent.ts:107` | Unauthorized RPC responses return raw `authorizeA2aMessage` reason strings — an auth-verification oracle (revoked vs sig-invalid vs scope-invalid distinguishable by probers). Return a generic denial; log the detail to the audit sink. |

**DEL-001 enforcement judgment:** acceptable for testnet/pilot **only with** the current per-source strict flags + deploy preflight; as a library default it remains opt-in and therefore NOT production-enforced globally. The global default flip is the highest-priority package-layer ADR.

### 3.5 Group D — credentials / attestations / content (7 packages)

All 7 suites + `pnpm check:eip712-typehash-equality` pass. Ledger cross-checks **VC-1 ✓, VC-2 ✓, SC-1 ✓, SC-2 ✓, ATT-1 ✓, ATT-3 ✓, AGR-1 ✓, SIG-1 ✓** — TS typehashes string-match the live Solidity (`JOINT_ISSUER_TYPEHASH`, `JOINT_CONSENT_TYPEHASH`, `ASSOCIATION_ATTESTATION_TYPEHASH`, `TRANSITION_TYPEHASH`, `AGREEMENT_ISSUER_TYPEHASH`); morning regenerations (`api-surface.snap`, manifest `publicExports`) are correct.

| Package | Verdict | Notes |
| --- | --- | --- |
| `attestations` | **Conditionally ready** | TS digests mirror contract exactly; ATT-2 (contract revocation model) open but not masked SDK-side. |
| `agreements` | **Ready** (audit scope) | SC-1/AGR-1 parity-guarded by the typehash CI gate. |
| `verifiable-credentials` | **Conditionally ready** | VC-1/VC-2 fixes hold (fail-closed signature path, domain pinned to issuer CAIP-10). New gap: NEW-VC-1. |
| `agent-skills` | **Not production-ready** | NEW-SKILL-1 (below — lead-verified: digest hashes typehash+fields+nonce, no chain/contract domain, and no on-chain verifier supplies one). |
| `geo-features` | **Not production-ready** | NEW-GEO-1, same class. |
| `ontology` | **Ready** | Declarative-only; no authority-bearing runtime paths. |
| `content-primitives` | **Conditionally ready** | Descriptor verification fail-closed; `evaluateEntitlement()` documented as assuming pre-verified VC proof — composition risk amplified by NEW-VC-1. |

**New findings (group D):**

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| NEW-VC-1 | **P2** | `verifiable-credentials/src/verifier.ts` | `verifyCredential()` does not enforce `credentialStatus` — a revoked (StatusList-referenced) credential still returns `valid: true` unless the caller adds an external status check. |
| NEW-SKILL-1 | **P2** | `agent-skills/src/index.ts:140-160` | `skillEndorsementDigest` omits chainId + verifyingContract; endorsement signatures replay cross-chain / cross-deployment (nonce only blocks same-context reuse). Lead-verified. |
| NEW-GEO-1 | **P2** | `geo-features/src/index.ts` | `geoEndorsementDigest` — same replay class as NEW-SKILL-1. |

## 4. Consolidated verdict + production blockers

**Verdict: test/pilot-ready on testnet. NOT production-ready.** The contract layer's three High blockers from the deep dive are now closed and redeployed; the package layer's prior criticals are closed; no package regression was found in any closure. The remaining blocker set is finite and explicit:

### P0/P1 — block production launch

| # | Item | Layer | Source |
| --- | --- | --- | --- |
| 1 | **CON-FACTORY-001** — rotate factory+paymaster governance off the disclosed deployer EOA (or clean redeploy) | Contracts/ops | ledger (High, open) |
| 2 | **DEL-001 global default** — flip `requireSessionDelegateBinding` to fail-closed library-wide (ADR; per-source enforcement is pilot-grade only) | SDK | ledger (ENFORCEMENT-PENDING) |
| 3 | **NEW-MCP-1** — memory JTI store NODE_ENV inference falls open on Workers (contradicts its own fix comment) | SDK | this audit |
| 4 | **CP-1/CP-2** — custody tier install-path validation (1-of-n collapse; recovery brick) | Contracts | deep dive (open) |
| 5 | **PM-1/PM-2** — ERC-7562-compliant validation; paymaster owner = governance timelock | Contracts | deep dive (open) |
| 6 | **Third-party contract audit engagement** | Process | N15 lineage |

### P2 — block specific product surfaces

- **NEW-AP-1/AP-2** (`agent-profile`): zero-anchor fail-open + SSRF — block server-side profile consumption until fixed.
- **NEW-VC-1 / NEW-SKILL-1 / NEW-GEO-1**: revocation + digest-domain binding — block credential/endorsement-load-bearing flows.
- **NEW-A2A-1**: auth-reason oracle — fix before public A2A endpoints.
- **NEW-CONNECT-AUTH-1**: make `allowedDomains` required (same class as the closed CA-001).
- **NEW-AUD-1** (+2/3): the ledger's `enforcement` field is self-attested — require test evidence for ≥ `production-enforced`, harden anchor matching. Until then, treat `production-enforced` claims as advisory.
- **DM-1/DM-2/EN-11/EN-13/EN-22, WA-1/WA-2, ATT-2, AN-2, SUB-1/2, GOV-1, CA-1/CA-2**: per the contract roadmap (§2.2).
- **NODE_ENV-keyed gates generally** (NEW-CONNECT-AUTH-2 + NEW-MCP-1 are two instances of one class): audit every `NODE_ENV === 'production'` gate for Workers behavior; prefer explicit `environment` config.
- **AUDIT.md charter-vs-src drift** (NEW-PMT-1, NEW-IM-1, NEW-IR-1, stale connect/connect-auth entries): add the inverse stub-drift gate.

### Cross-cutting observations

1. **The remediation wave was real.** Every closure re-verified in source at the exact claimed mechanism; no cosmetic fixes found. TS↔Solidity typehash parity is gate-enforced and passing.
2. **The recurring weakness class is environment inference** — `NODE_ENV` on Workers (3 findings) — and **caller-optional security parameters** (`allowedDomains`, `requireSessionDelegateBinding`, `opts.environment`). The doctrine fix is one rule: *security-relevant configuration is required, never inferred, never optional.*
3. **The ledger discipline works but can overclaim**: anchor-presence + self-attested enforcement passed a finding (LEDGER-1's own fix) that NEW-AUD-1 shows is trivially satisfiable. Strengthening the gate is cheap and high-leverage.
4. **Stub honesty**: spine packages (`payments`, `intent-*`, `fulfillment`) are honestly stub in CLAUDE.md but their AUDIT.md charters overclaim — exactly the inverse of the ARCH-1 class already closed.

## 5. Evidence run (this session, master @ 2026-06-10)

| Check | Result |
| --- | --- |
| `forge test` (apps/contracts) | **774/774 pass** (58 suites, incl. CA-F1 regression + invariant suites) |
| `pnpm test:unit` (all packages) | **27/27 suites green** (~1,050 tests) |
| `pnpm check:audit-freshness` | ✓ 49 findings, all anchors resolve; DEL-001 correctly ENFORCEMENT-PENDING |
| `pnpm check:eip712-typehash-equality` | ✓ TS ↔ live Solidity parity |
| Base Sepolia redeploy (CA-F1 stack) | deployments file updated 2026-06-10 11:21 MDT |
| Targeted security suites (delegation/mcp-runtime/key-custody/tool-policy/a2a) | 141 tests pass |
| Group A suites | 310 tests pass |

## 6. Status ledger updates from this audit

The new findings above are registered in [`findings.yaml`](findings.yaml) as `open` with `origin: 2026-06-10-production-readiness-audit.md`. The next hardening wave should burn down §4 P0/P1 items 2–5 (item 1 is an ops ceremony; item 6 is procurement).




