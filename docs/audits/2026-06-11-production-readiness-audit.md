# Production-readiness audit — all packages + all contracts (2026-06-11)

**Auditor:** internal independent pass (assistant-led; 5 parallel adversarial subagent package reviews + direct line-by-line contract fix verification by the lead).
**Scope:** all 32 `packages/*` (incl. `contracts` — 42+ `.sol` files), the findings ledger, CI gates, and the post-2026-06-10-audit delta: the afternoon hardening wave (#287–#293), the recoverable-custody W0 surface (`acd0b2a`), the a2a spec-269 features (#259), and the first npm publish of 12 packages (`a5c42ee`).
**Baseline:** [2026-06-10 production-readiness audit](2026-06-10-production-readiness-audit.md) + [2026-06-10 contract-by-contract deep dive](2026-06-10-contract-by-contract-audit.md) + [`findings.yaml`](findings.yaml) (60 findings at session start: 35 closed, 23 open, 2 accepted-risk).
**Method:** every closure claimed since the last audit re-verified against source by the lead (mechanism, not anchor presence); all new surface audited as fresh code by independent subagents; full test suites + cross-stack gates executed this session; deployment state compared against source commit timestamps.

## 0. Executive verdict

**Source: materially production-stronger than 24 hours ago. Deployment: now LAGGING source — the running Base Sepolia stack predates the fix wave.** Overall posture: test/pilot-ready on testnet; production launch still gated, but the remaining blocker list shrank from six items to three-plus-ceremony.

Since the 2026-06-10 report, twelve findings moved to closed **and were re-verified at source in this session**: CP-1, CP-2, PM-1, PM-2, WA-1, WA-2, EN-11, GOV-1, CA-1, NEW-MCP-1, NEW-AUD-1-adjacent ledger hardening, and **DEL-001 graduated to production-enforced** (global fail-closed default, ADR-0036 — closing the last ENFORCEMENT-PENDING critical).

**The one new headline finding (DEPLOY-LAG-001, High · ops):** the last Base Sepolia deploy is 2026-06-10 11:21 MDT (`bbfedc3`), but every contract fix in the afternoon wave landed 14:45–15:48 — **the deployed testnet bytecode still contains CP-1/CP-2, PM-1/PM-2, WA-1/WA-2, EN-11, GOV-1, and CA-1**. Closed-in-source ≠ closed-on-chain. Until redeploy, the ledger's `test-covered` enforcement labels for these IDs are accurate but the *live stack* must be treated as pre-fix. Action: redeploy the Base Sepolia stack (same ceremony as `bbfedc3`) and bump deployments JSON.

What still blocks production (full detail §5):

1. **CON-FACTORY-001 (High, open)** — governance is the disclosed testnet deployer EOA. The PM-2 fix explicitly depends on the companion ceremony (Ownable2Step owner→timelock handoff), making this rotation the single highest-leverage open item.
2. **Third-party contract audit** — not yet engaged (process gate; unchanged).
3. **Production custody closure** — KMS/HSM per-subject signing + custody evidence export (FG-SEC-2/3) before real-value/PII workloads.
4. **DEPLOY-LAG-001** — redeploy so chain matches source (testnet hygiene, hard gate for any pilot relying on the fixed semantics).
5. The remaining open Mediums (§5.2) before value-bearing delegation at scale: DM-1/DM-2/EN-13/EN-22 (cumulative budgets + signature nonces), SUB-1/SUB-2/AN-2 (naming economics), ATT-2 (revocation model), CA-2, and the open package P2s (NEW-AP-1/2, NEW-VC-1, NEW-SKILL-1/GEO-1, NEW-A2A-1, NEW-CONNECT-AUTH-1, NEW-PMT-1-class, NEW-FLF-1).

## 1. The 2026-06-10 afternoon fix wave — independently re-verified at source

Every mechanism below was read directly by the lead auditor this session (not taken from commit messages or the ledger).

| Finding | Was | Fix verified (file · mechanism) | Status |
| --- | --- | --- | --- |
| **CP-1** custody tiers default 1-of-n | High-impact Med | `CustodyPolicy.sol:426-427` — install **reverts `UnconfiguredTier(4|5)`** when T4/T5 thresholds are zero in modes that expose them; `:387-398` documents the T1–T3 legitimate-zero semantics; `_approvalsValue` fallback no longer reachable for privileged tiers. Regression suite `CustodyPolicyBranchR610b.t.sol` +102 lines. | **CLOSED · test-covered** |
| **CP-2** `recoveryApprovals` unvalidated at install | Med | `CustodyPolicy.sol:472` — install reverts when `trusteeCount == 0 || recoveryApprovals == 0` for recovery-capable modes (T6 brick + recovery-disabled both dead at install time). | **CLOSED · test-covered** |
| **PM-1** governance storage read in validation (ERC-7562) | Med | `SmartAgentPaymaster.sol:123,374-379` — validation reads a **local `_pausedMirror`** slot only; the governance `staticcall` (`:269`) survives solely in the out-of-band `syncPauseMirror` path, never during `_validatePaymasterUserOp`. New suite `SmartAgentPaymasterValidateR610.t.sol` (+105). | **CLOSED · test-covered** |
| **PM-2** deposit drainable by Ownable owner | Med | `SmartAgentPaymaster.sol:275-310` — governance-coupled `scheduleDepositWithdrawal` / `executeDepositWithdrawal` / `cancelDepositWithdrawal` (`onlyGovernance` + `DEPOSIT_WITHDRAWAL_TIMELOCK`). **Residual, explicitly documented (`:74-91,126-128`):** the inherited instant `withdrawTo`/`withdrawStake` remain owner-gated until the Ownable2Step owner→timelock handoff ceremony executes — PM-2 closure is *code + ceremony*; the ceremony is CON-FACTORY-001's. | **CLOSED · test-covered (ceremony-dependent)** |
| **WA-1** P-256 high-s malleability | Med | `WebAuthnLib.sol:39-43,84-87` — `P256_N_DIV_2` bound enforced on every verification (`assertion.s > P256_N_DIV_2 → reject`), killing (r, n−s) malleability for ERC-1271 + custody-quorum dedup alike. | **CLOSED · test-covered** |
| **WA-2** UV not required on custody paths | Med | `AgentAccount.sol:1281-1292` — ERC-1271 WebAuthn path now passes `requireUv: true`; `SignatureSlotRecovery.sol:176` — slot-level UV required for custody-council passkey signers. | **CLOSED · test-covered** |
| **EN-11** zero-threshold quorum fail-open | Med | `QuorumEnforcer.sol:141-147` — `threshold == 0 || threshold > signerSet.length → revert InvalidThreshold`. Degenerate quorum dead. | **CLOSED · test-covered** |
| **GOV-1** immutable guardian perma-pause DoS | Med | `AgenticGovernance.sol:58,73-81` — guardian is now a rotatable role (timelock-rotated, event-logged); a compromised guardian's grief-pause is bounded by rotation instead of full redeploy cascade. | **CLOSED · test-covered** |
| **CA-1** upgrade timelock dead code | Med | `AgentAccount.sol:138-156,439-444,477-485` — `scheduleUpgrade` writes `_pendingUpgrade`; `_authorizeUpgrade` **blocks direct upgrades when `_upgradeTimelock != 0`** (`!_upgradeAuthorizedCtx → revert`), forcing the schedule→execute path; custody-module path preserved. The timelock a single-sig owner sets is now real. | **CLOSED · test-covered** |
| **NEW-MCP-1** memory JTI store NODE_ENV fall-open | High (pkg) | `mcp-runtime/src/jti-stores.ts:44-46` — `environment` is now a **required** constructor field (`CreateMemoryJtiStoreOpts`); zero NODE_ENV inference on the decision path; production refusal throws unless the explicit, greppable escape-hatch env var is set (which itself warns). | **CLOSED · production-enforced** |
| **DEL-001** session key not bound to delegated authority | Critical | `delegation` (#287, ADR-0036) — opt-in flags **replaced** by fail-closed default: `verifyDelegationToken` enforces the session-delegate binding unless the caller passes the explicit `allowUnboundSessionToken: true` opt-out; mcp-runtime threads the same; demo-mcp vault config pins binding ON; production preflight asserts it. Remint-attack regression test in place. | **CLOSED · production-enforced** |

Ledger cross-check: `pnpm check:audit-freshness` ✓ — 60 findings, all anchors resolve, **zero ENFORCEMENT-PENDING criticals remaining** (DEL-001's pending flag cleared by the ADR-0036 flip).

## 2. New surface since the last audit (fresh-code review scope)

| Surface | Commit | Audit treatment |
| --- | --- | --- |
| **Recoverable custody W0** — `related-agents` custody-descriptor (`kind:'kms-subject'` + rotation salt), consumed by demo-a2a | `acd0b2a` + ADR (`e4497e3`) | Fresh-code review (subagent group C, §4.3) — descriptor content, derivation safety, no secret material |
| **a2a spec-269** — handoff (FR-3.6), demo-mcp cross-vault (FR-3.4), discovery (§8) | `a7308ac` | Fresh-code review (subagent group A, §4.1) — authorization on each new endpoint |
| **npm publish of 12 packages** (drop `private`, peer→deps, portability) | `a5c42ee` | Supply-chain review (groups B/C) — manifest hygiene, no dev artifacts/secrets shipped |
| **demo-sso-next org-create + demo-gs self-heal** | #295-#298, `848c444`… | App layer — out of package-audit scope; noted for the demo-grade caveat ledger |

## 3. Contract layer — current state (post-wave, re-verified)

Per-contract detail: [deep dive](2026-06-10-contract-by-contract-audit.md). Group verdicts after this wave:

| Group | Verdict | Delta since 06-10 report |
| --- | --- | --- |
| A — Account core | **Conditionally ready** | CA-1 closed (timelock real). Open: CA-2 (ERC-1271 cross-account binding — Low/Med, custodian-sharing scenario only). |
| B — Delegation + enforcers | **Sound; cumulative-semantics caveat** | EN-11 closed. Re-verified still open this session: DM-1 (no redemption consumption record — `DelegationManager.sol` has no nonce store), DM-2, EN-13 (`QUORUM_ACTION_TYPEHASH:93` carries no nonce/expiry), EN-22 (`ValueEnforcer` has no cumulative accounting). These are the [doc 91](../feature-analysis/91-next-push-discovery-to-outcomes.md) §2.4 work items. |
| C — Custody / paymaster / governance / crypto | **Materially hardened** | CP-1/CP-2/PM-1/PM-2/GOV-1/WA-1/WA-2 all closed at source (§1). Residual: PM-2's owner-handoff ceremony = CON-FACTORY-001. |
| D — Naming + identity | **Unchanged** | Open: SUB-1/SUB-2 (subregistry front-run/sybil — demo-grade), AN-2 (decorative expiry), RES-1 (Low). |
| E — Registries | **Strongest group** | Open: ATT-2 (salt-replay revocation model), ONT-4/ONT-7 (Low, by-design). |

**DEPLOY-LAG-001 (new, High · ops):** verified by timestamp comparison — `deployments-base-sepolia.json` last written 2026-06-10 11:21:31; fix commits `a04a0e4` (14:45), `ddbf7d6` (15:12), `50690a8`/`d0a4436` (15:30), `439eac9` (15:48). **None of §1's contract fixes are live on Base Sepolia.** Until redeploy, treat the running stack as pre-fix for CP/PM/WA/EN-11/GOV-1/CA-1 semantics.

## 4. Package layer — five independent adversarial reviews (all 32 packages)

All 32 package suites pass this session; per-group detail below. Each group re-verified the ledger's open/closed claims at source and audited new surface as fresh code.

### 4.1 Core security chain (delegation · mcp-runtime · key-custody · tool-policy · a2a · audit)

| Package | Verdict | Key results |
| --- | --- | --- |
| `delegation` | **Conditionally ready** | **DEL-001 flip CONFIRMED fail-closed** (`token.ts:649-674` — binding enforced when `allowUnboundSessionToken` absent; opt-out is the only bypass; remint-attack regression meaningful; no alternate verifier path bypasses). |
| `mcp-runtime` | **Conditionally ready** | **NEW-MCP-1 CONFIRMED closed** (`jti-stores.ts:44-52`, required `environment`, zero NODE_ENV inference on the decision path); sqlite/postgres `trackUsage` atomic (single upsert+RETURNING). Note: docs mention a "D1-backed store" but no `createD1JtiStore` ships in src — doc drift. |
| `key-custody` | **Conditionally ready** | Stable; local-signer production block fail-closed (`providers/local.ts:67-91`). |
| `tool-policy` | **Production-ready** | Stable; fail-closed decisions intact. |
| `a2a` | **NOT READY** | See findings below — the spec-269 surface shipped with an authorization hole. |
| `audit` | **Conditionally ready** | Stable; explicit fail-soft/fail-hard sink semantics. |

**New findings (a2a — the audit's most significant package result):**

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| **NEW-A2A-2** | **P1** | `a2a/src/jsonrpc.ts:45-53`, `agent.ts:167-193` | **Caller identity for `tasks/get`, `tasks/cancel`, `tasks/pushNotificationConfig/set` is taken from user-controlled params (`caller`) and trusted for authorization.** Attacker supplies a victim's address as `caller` + a known task ID → reads/cancels/reconfigures another party's task. Cross-tenant task confidentiality + integrity. |
| **NEW-A2A-3** | **P1** | `a2a/src/agent.ts:125` | Default `newTaskId` falls back to the deterministic constant `0x…01` — an integrator omitting `newTaskId` collides every send on one task ID (overwrite/poisoning/DoS). |
| NEW-A2A-4 | P3 | `jsonrpc.ts:45-50`, `stores.ts:16,35` | Missing param validation: malformed `taskId` (undefined/non-string) reaches `toLowerCase()` and throws — crashable public RPC paths. |
| NEW-A2A-1 | P2 (re-confirmed open) | `agent.ts:111,156,164,192` | Auth-reason oracle leakage unchanged. Discovery endpoints (`tasks/discovery/*`) are unauthenticated **by design** — acceptable only if deployments understand it. |

### 4.2 Auth + sessions (connect · connect-auth · browser-identity · fedcm-idp · fedcm-rp · types)

| Package | Verdict | Key results |
| --- | --- | --- |
| `connect` | **Conditionally ready** | AGS-001/002 + alg pinning + aud/iss/exp CONFIRMED intact; redirect helper exact-match allowlist safe. **AGS-003 replay: still open** — `jti` is minted but no verifier-side replay store. |
| `connect-auth` | **NOT READY** (for standalone passkey verification use) | NEW-CONNECT-AUTH-1 **still open** (`siwe.ts:154,170` — domain check only when caller passes `allowedDomains`). New: NEW-CONNECT-AUTH-2/3 below. CA-001 nonce + OIDC alg/aud/iss/exp pinning intact. |
| `browser-identity` / `fedcm-idp` / `fedcm-rp` | **Conditionally ready** | Fail-closed FedCM detection; idp builds-only/signs-nothing CONFIRMED; rp returns token without verifying (by design — verification is the substrate's). |
| `types` | **Production-ready** | Type-only. |

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| NEW-CONNECT-AUTH-2 | P2 | `connect-auth/src/methods/passkey.ts:119-151,193-235` | Passkey helper normalizes assertions but validates none of challenge/origin/rpIdHash/UV — an integrator treating its output as ceremony validation accepts replayed or wrong-origin assertions. |
| NEW-CONNECT-AUTH-3 | P3 | `connect-auth/src/sessions.ts:124-132` | `expectedIss`/`expectedAud` requirement keyed to `NODE_ENV === 'production'` — the same Workers-unreliable inference class as the closed NEW-MCP-1. |

Publish hygiene (`a5c42ee`): `npm pack --dry-run` on all six → only LICENSE/README/spec.md/dist; no secrets in manifests.

### 4.3 Account + custody (agent-account · account-custody · contracts-TS · related-agents · agent-relationships)

| Package | Verdict | Key results |
| --- | --- | --- |
| `related-agents` | **Conditionally ready** | **New spec-271 custody-descriptor surface reviewed as fresh code: the primitive is well-built** — no secret material (salt ≠ key material; custodian derivation needs KMS master + live owner session), RC-INV-3 field-by-field rebuild fail-closed, recovery re-validates + asserts CREATE2 reconstruction (`demo-a2a:2240-2262`). **Its perimeter is not** — see NEW-RAG-1/2/3. |
| `agent-account` | **Conditionally ready** | CA-F1 salt encoding lock-step by construction (SDK calls the factory view; never re-implements CREATE2); UserOp hashing on-chain-sourced; paymaster hash mirrors field-for-field. Gap: **no CA-1 SDK surface** (NEW-AA-3 — ABI lacks `scheduleUpgrade`/`DirectUpgradeBlocked`, so timelocked accounts see undecodable reverts). |
| `account-custody` | **Ready** (scope) | CP-1 SDK question answered: **no install-path builder exists** (install encoding is factory-owned Solidity), so a zeroed-tier config cannot originate here, and post-#288 the contract reverts it anyway; mutators floor at 1. EIP-712 shapes byte-match (gate 13/13). Doc drift: AUDIT.md still describes pre-#288 implicit-1 semantics (NEW-AC-2). |
| `contracts` (TS) | **Conditionally ready** | ABIs **fresh** (rebuilt 19:58, post-#293; `scheduleUpgrade`/`UnconfiguredTier`/`setGuardian` present; npm alpha.7 includes them); storage-layout snapshots updated + gate ✓; **deployments JSON confirmed stale** → NEW-CON-1. |
| `agent-relationships` | **Conditionally ready** | Unchanged; EXPERIMENTAL warnings intact; NEW-AR-1/2 still open. |

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| **NEW-CON-1** | **P2** | `deployments-base-sepolia.json` vs `dist/abi/*` | **The published npm package pairs post-fix ABIs with pre-fix addresses** — consumers get `UnconfiguredTier` in the ABI and a live stack where zeroed installs still collapse to 1-of-n. The SDK face of DEPLOY-LAG-001. Redeploy + commit deployments before next publish. |
| **NEW-RAG-1** | **P2** | `demo-sso-next/server/connect/related-orgs.ts:120-126` | RC-INV-3 not enforced at the storage boundary: persistence stores `body?.custody ?? null` raw — `buildCustodyDescriptor` never called at persist time; a client can store `iss`/`sub` (owner identifiers at rest — exactly what the invariant prevents). |
| **NEW-RAG-2** | **P2** | `related-orgs.ts:100-115` | Write authorization is an ERC-1271 signature over a **constant** challenge (no org/payload/nonce/expiry binding) — replayable forever; enables clobbering the custody descriptor → **denial-of-recovery**, the precise gap spec-271 exists to close. |
| NEW-RAG-3 | P3 | `related-agents/src/index.ts:68-75` | Descriptor under-commits the CA-F1 CREATE2 preimage (no mode/trustees/timelocks/multi-custodian) — custody-configured orgs can never be reconstructed; fail-closed but silently unrecoverable. |
| NEW-RAG-4/5/6 | P3 | various | Silent salt-discard on build failure (warn-only); no case canonicalization → split `credentialHash`es; AUDIT.md predates the custody surface. |
| NEW-CON-2/3 | P3 | publish path / `check-abi-sync.ts:43-50` | No CI provenance for publish-time-generated dist (realized: broken `workspace:*` alphas immutable on npm); ABI-sync gate watches only 3 functions vs the much larger hand-maintained mirror surface. |

### 4.4 Credentials + data (verifiable-credentials · attestations · agreements · agent-skills · geo-features · ontology · content-primitives)

All closures re-verified closed (VC-1/2, SC-1/2, ATT-1/3, AGR-1, SIG-1); typehash parity gate ✓. Open re-confirmed: **NEW-VC-1, NEW-SKILL-1, NEW-GEO-1, ATT-2** — with the auditor noting the skills/geo **tests lock in the vulnerable digest shape** (green tests ≠ mitigation).

| Package | Verdict | New findings |
| --- | --- | --- |
| `verifiable-credentials` | Conditionally ready | **NEW-VC-2 (P2)**: `verifier.ts:68-76` validates expiry but not `validFrom` — a not-yet-active credential verifies `valid: true`. |
| `attestations` / `agreements` | Conditionally ready / Ready | No new findings. |
| `agent-skills` / `geo-features` | **Not ready** | NEW-SKILL-1/NEW-GEO-1 unchanged. |
| `ontology` | Ready | Declarative-only. |
| `content-primitives` | Conditionally ready | **NEW-CP-1 (P2)**: `entitlement.ts:39-45` checks `validUntil` only, no `validFrom` gate (premature access). NEW-CP-2 (P3): `descriptor.ts:121-123` accepts `issuer-signature-and-hash-v1` without requiring a `commitment`. |

### 4.5 Naming + spine (agent-naming · agent-profile · identity-directory(+adapters) · intent-* · fulfillment · payments)

ADR-0012 sweep across all 8: **zero runtime `eth_getLogs`** (doc/comment hits only). AN-1 normalization re-confirmed matching the on-chain charset.

| Package | Verdict | Status |
| --- | --- | --- |
| `agent-naming` | Conditionally ready | Clean. |
| `agent-profile` | **Not ready (server-side fetch)** | NEW-AP-1 (zero-anchor fail-open, `client.ts:104-106`) + NEW-AP-2 (SSRF, `client.ts:93-98`) both **re-confirmed exploitable**. |
| `identity-directory` (+adapters) | Ready / Conditionally ready | Port-only model intact. New: NEW-IDA-2 (P3) — `caip10.ts:19-24` accepts any third token as `Address` without hex validation (poisoned canonical IDs → downstream DoS). |
| `intent-marketplace` / `intent-resolver` / `payments` | Foundational | NEW-IM-1 / NEW-IR-1 / NEW-PMT-1 charter-vs-src drift **all still open**. |
| `fulfillment` | Foundational | NEW-FLF-1 **still open** (`index.ts:127-130` ignores 4 of 6 policy fields). |

## 5. Consolidated verdict + blockers

**Source layer: the strongest it has ever been — every prior P0/P1 closed and re-verified. Deployment + new-surface layer: three NEW P1/P2 clusters keep the overall verdict at testnet/pilot-ready, NOT production-ready.**

### P1 — fix before any external pilot exposure

| # | Item | Source |
| --- | --- | --- |
| 1 | **NEW-A2A-2** — caller-spoofable task authorization on `tasks/get`/`cancel`/`pushNotificationConfig/set` (+ NEW-A2A-3 deterministic task-id fallback) | §4.1 — fresh spec-269 surface |
| 2 | **DEPLOY-LAG-001 / NEW-CON-1** — redeploy Base Sepolia + commit deployments JSON; npm currently distributes post-fix ABIs against pre-fix addresses | §3 / §4.3 |
| 3 | **NEW-RAG-2** — replayable constant-challenge write auth enabling custody-descriptor clobber (denial-of-recovery), + NEW-RAG-1 storage-boundary validation skip | §4.3 — fresh spec-271 perimeter |

### P0 production gates (unchanged in kind, shorter in count)

CON-FACTORY-001 (governance EOA rotation — now also PM-2's ceremony dependency) · third-party contract audit engagement · production KMS/HSM custody closure (FG-SEC-2/3).

### P2 backlog (open, tracked)

NEW-AP-1/2 (profile fetch), NEW-VC-1 + **NEW-VC-2** + **NEW-CP-1** (credential/entitlement time-window + revocation), NEW-SKILL-1/NEW-GEO-1 (digest domain — doc 91 §2.2 work items), NEW-CONNECT-AUTH-1/**2**, NEW-A2A-1, AGS-003 (session replay store), NEW-FLF-1, NEW-PMT-1-class charter drift (now also NEW-RAG-6/NEW-AC-2/NEW-AA-4 — **6 packages** with stale AUDIT.md), DM-1/DM-2/EN-13/EN-22, SUB-1/2, AN-2, ATT-2, CA-2, NEW-CON-2/3.

### Cross-cutting observations (what a third-party reviewer will say)

1. **Remediation velocity is genuinely excellent; remediation *completion discipline* is the gap.** Three of this audit's four P1/P2 clusters are not new bugs — they are yesterday's fixes not carried to their last mile: fixes not redeployed (DEPLOY-LAG-001), fixed semantics not exposed to SDK consumers (NEW-AA-3), invariants enforced at build/consume but not at rest (NEW-RAG-1).
2. **New feature surface ships ahead of its security review.** Both fresh surfaces audited this session (a2a spec-269, spec-271 perimeter) carried P1/P2 authorization flaws on arrival. The substrate's own doctrine (specs precede code) needs a security-review gate at the same point.
3. **The `NODE_ENV`/caller-optional class persists after its flagship fixes** — NEW-CONNECT-AUTH-1 (open), NEW-CONNECT-AUTH-3, and the passkey helper show the doctrine ("security config is required, never inferred, never optional") is applied where audited, not yet universal.
4. **Charter (AUDIT.md) drift is now the most common finding class** (6 packages). The inverse-drift gate proposed on 06-10 remains unbuilt and is the cheapest systemic fix on the list.
5. **Honesty infrastructure continues to hold up**: the ledger correctly reported `test-covered` (not production-enforced) for every fix the deploy lag affects — the gap was discoverable *from the project's own artifacts*, which is exactly the property a third party should value most.

## 6. Evidence run (this session, master @ `2189b81`, 2026-06-11)

| Check | Result |
| --- | --- |
| `forge test` (packages/contracts) | **803/803 pass** (58 suites; +29 fix-wave regressions vs 06-10) |
| Package suites (all 32) | **All green** (~1,290 tests; spot counts in §4) |
| `pnpm check:audit-freshness` | ✓ 60 findings, all anchors resolve, **zero ENFORCEMENT-PENDING criticals** |
| `pnpm check:eip712-typehash-equality` | ✓ (13/13) |
| `check:abi-sync` / `check:storage-layouts` | ✓ / ✓ (4/4) |
| `npm pack --dry-run` (published packages) | dist-only payloads, no secrets |
| Deployment freshness | **STALE** — `bbfedc3` (11:21) < fix wave (14:45–15:48) → DEPLOY-LAG-001 |

## 7. Ledger updates from this audit

Registered in [`findings.yaml`](findings.yaml) as `open`, `origin: 2026-06-11-production-readiness-audit.md`: **DEPLOY-LAG-001** (high·ops), **NEW-A2A-2** (high), NEW-A2A-3, NEW-CON-1, NEW-RAG-1, NEW-RAG-2 (medium), NEW-VC-2, NEW-CP-1, NEW-CONNECT-AUTH-2, AGS-003 (medium), NEW-RAG-3, NEW-CONNECT-AUTH-3, NEW-IDA-2, NEW-CON-2, NEW-CON-3, NEW-CP-2, NEW-AA-3 (low). The next hardening wave should burn down §5's P1 trio first — all three are hours-scale fixes.

