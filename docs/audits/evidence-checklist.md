# Evidence Checklist — agenticprimitives

**Owner:** [security-auditor](../agents/security-auditor.md) (controls)
+ [technical-architect-auditor](../agents/technical-architect-auditor.md)
(architecture rows).
**Refresh cadence:** every closure flip.
**Last refresh:** 2026-05-23 (post security-auditor H5 audit — CT-8/9/10/11/12 landed).
**Source of truth for closure status:** the third column. The
`product-readiness-audit.md` running scorecard mirrors this doc.

Format per row:
- **ID** — stable identifier (referenced from threat-model + spec 214).
- **Control** — what's being asserted.
- **Status** — `open` / `partial` / `closed-YYYY-MM-DD — <evidence>`.
- **Source** — file path + line range that implements the control.
- **Test** — file path + test name that fires on regression.
- **Audit event** — the audit row name (if applicable) that surfaces
  the control's outcome.

Companion docs: [`threat-model.md`](./threat-model.md) ·
[`architecture-diagram.md`](./architecture-diagram.md) ·
[`specs/214-production-audit-dossier.md`](../../specs/214-production-audit-dossier.md).

---

## 4.1 Authority closure

| ID | Control | Status | Source | Test | Audit event |
| --- | --- | --- | --- | --- | --- |
| **AC-1** | `setDelegationManager`, `installModule`, `uninstallModule`, `upgradeToWithAuthorization` are `onlySelf` (factory-init one-shot for installModule). | closed-2026-05-21 — Wave 2A C-1/C-2/C-3 | `packages/contracts/src/AgentAccount.sol:975-984` | `packages/contracts/test/AuthorityClosureWave2A.t.sol` (12 tests) | — (revert path, no event) |
| **AC-2** | Factory-init exception spent exactly once. | closed-2026-05-21 — Wave 2A | `packages/contracts/src/AgentAccount.sol` `_factoryInitConsumed` bool | `test_C2_factory_init_exception_is_one_shot` | — |
| **AC-3** | `upgradeToWithAuthorization` permanently disabled. | closed-2026-05-21 — Wave 2A | `packages/contracts/src/AgentAccount.sol` (revert `LegacyUpgradePathDisabled`) | `test_C3_upgradeToWithAuthorization_always_reverts` | — |
| **AC-4** | CustodyPolicy reinstall forbidden post-uninstall. | closed-2026-05-22 — Wave 2C C-11 | `packages/contracts/src/custody/CustodyPolicy.sol` `permanentlyUninstalled` flag | `test_C11_reinstall_after_uninstall_forbidden` | `CustodyPolicyPermanentlyUninstalled` event |

---

## 4.2 Signature binding

| ID | Control | Status | Source | Test | Audit event |
| --- | --- | --- | --- | --- | --- |
| **SB-1** | QuorumEnforcer signatures bind chainId + enforcer + delegation hash + delegator + redeemer + target + value + keccak(callData). | closed-2026-05-22 — Wave 2B C-4 | `packages/contracts/src/enforcers/QuorumEnforcer.sol` `computeQuorumPayloadHash` | `packages/contracts/test/QuorumEnforcerBindingWave2B.t.sol` (6 tests) | — |
| **SB-2** | ECDSA `s` value low-half-normalized for all paths. | partial | `packages/key-custody/src/providers/gcp.ts` (low-s normalization documented). Other paths use viem. | — | — |
| **SB-3** | WebAuthn assertion decodes via try/catch → false (not revert). | closed-2026-05-22 — Wave 2C C-7 | `packages/contracts/src/AgentAccount.sol` `_verifyWebAuthn` external `decodeWebAuthnAssertion` + try/catch | `test_C7_malformed_webauthn_payload_does_not_revert` + truncated/empty variants | — |
| **SB-4** | ERC-1271 + ERC-6492 dispatched through `UniversalSignatureValidator`. | closed | `packages/contracts/src/UniversalSignatureValidator.sol` | `packages/contracts/test/UniversalSignatureValidator.t.sol` | — |

---

## 4.3 Custody / recovery

| ID | Control | Status | Source | Test | Audit event |
| --- | --- | --- | --- | --- | --- |
| **CR-1** | Zero credentialIdDigest rejected at `initialize`, `addPasskey`, and inside RecoverAccount. | closed-2026-05-22 — Wave 2C C-6 + H2 (`buildRecoverAccountArgs`) | `packages/contracts/src/AgentAccount.sol` `InvalidCredentialIdDigest`; `packages/account-custody/src/actions.ts` C-6 echo | `test_C6_*` + `buildRecoverAccountArgs > rejects zero credentialIdDigest in addPasskeys` | — |
| **CR-2** | `SetRecoveryApprovals(0)` rejected at apply. | closed-2026-05-22 — Wave 2C C-9 | `packages/contracts/src/custody/CustodyPolicy.sol` `_applySetRecoveryThreshold` | (locked at source; full ceremony exercised by `AdminFlowsViaValidator`) | — |
| **CR-3** | `RotateAllCustodians(add, remove)` actually removes old set. | closed-2026-05-22 — Wave 2C C-10 | `packages/contracts/src/custody/CustodyPolicy.sol` `_applyRotateAllOwners`; `packages/account-custody/src/actions.ts:buildRotateAllCustodiansArgs` | `buildRotateAllCustodiansArgs > encodes add+remove together` | `CustodiansRemovedDuringRotation` event |
| **CR-4** | `ChangeApprovalsRequired` tier-escalates reductions to T5. | closed-2026-05-22 — Wave 2C C-8 | `packages/contracts/src/custody/CustodyPolicy.sol` `_effectiveTierFor` | `test_admin_changeApprovalsRequired_revertsOnZero` | — |
| **CR-5** | T6 timelock bounded by `timelockOverrides[6]` (default 48h). | closed-2026-05-23 — Wave H1.5 | `packages/contracts/src/AgentAccountFactory.sol` `_buildValidatorInitData` | `AgentAccountFactoryModeTest` + recovery-demo Act 1 with `timelockOverrides: [0,0,0,0,1,0,10]` | — |

---

## 4.4 Off-chain authorization

| ID | Control | Status | Source | Test | Audit event |
| --- | --- | --- | --- | --- | --- |
| **OA-1** | `evaluatePolicy` shape-gate fail-closed on unknown @sa-tool / @sa-auth / risk-tier. | closed-2026-05-21 — Wave H2 (prior) | `packages/tool-policy/src/decision.ts:validateClassificationShape` | `packages/tool-policy/test/decision.test.ts` negative-matrix | — (returns `{decision:'deny', reason}`) |
| **OA-2** | `withDelegation` production-default: throws at construction if classification or auditSink missing. | closed-2026-05-23 — Wave H1 | `packages/mcp-runtime/src/with-delegation.ts:1-26` `inferEnvironment` + construction-time throw | `packages/mcp-runtime/test/unit/with-delegation.test.ts` "production-default gate" describe (7 tests) | — (construction throw) |
| **OA-3** | `verifyDelegationToken` refuses caveat-presence as quorum proof; requires explicit `quorumProof`. | closed-2026-05-23 — Wave H3 | `packages/delegation/src/token.ts` `if (!opts.quorumProof) return rejectWith(...)` | `packages/mcp-runtime/test/unit/with-delegation.test.ts` "quorumProof passthrough" describe (3 tests) | `delegation.verify.reject` with reason `quorum caveat present but no quorumProof supplied` |
| **OA-4** | JTI replay atomic; never decrement; per-token usage cap. | closed | `packages/mcp-runtime/src/jti-stores.ts:createSqliteJtiStore` (transactional `INSERT OR REPLACE`) | `packages/mcp-runtime/test/unit/jti-stores.test.ts` | — |
| **OA-5** | Error responses opaque (single auth_failed; details internal-only). | closed | `packages/mcp-runtime/src/with-delegation.ts:McpAuthError`; `apps/demo-mcp/src/index.ts` returns generic 401 | (existing) | `mcp-runtime.with-delegation.reject` with internal `reason` (NOT echoed to client) |

---

## 4.5 KMS / key handling

| ID | Control | Status | Source | Test | Audit event |
| --- | --- | --- | --- | --- | --- |
| **KH-1** | `buildKeyProvider` / `buildSignerBackend` production-default: no silent local-aes fallback. | closed-2026-05-23 — Wave H1 | `packages/key-custody/src/factories.ts` `backendOrEnv` throws in production with no backend + no env | — (construction throw; package test coverage pending) | — |
| **KH-2** | `LocalAesProvider` throws on `NODE_ENV=production` unless explicit opt-in env. | closed | `packages/key-custody/src/providers/local.ts:47` | — | (refusal log) |
| **KH-3** | GCP-KMS envelope encryption binds AAD identically (KMS EncryptionContext + AES-GCM AAD). | closed | `packages/key-custody/src/providers/gcp.ts` (AAD canonicalization) | — | — |
| **KH-4** | Per-tool KMS-key isolation (HKDF-derived per-tool keys). | open — v0 returns master signer | `packages/key-custody/src/factories.ts:42` (`buildToolExecutorBackend` `void toolId`) | — | — |
| **KH-5** | HMAC / MAC key rotation procedure documented + overlap window for in-flight requests. | open | — | — | — |
| **KH-6** | Signing audit row never logs raw session id (hashed + truncated). | closed | `packages/key-custody/src/providers/gcp.ts` `signA2AAction` audit context shape | — | `key-custody.sign` (with `keccak256(sessionId).slice(0, 18)`) |

---

## 4.6 Input validation + transport

| ID | Control | Status | Source | Test | Audit event |
| --- | --- | --- | --- | --- | --- |
| **IV-1** | Every Worker route uses `validate.ts` helpers for browser input. | closed-2026-05-21 — N11 close | `apps/demo-a2a/src/validate.ts`; every `/session/*` + `/account/*` route uses `parseAddress` / `parseBytes32` / `parseUint256Decimal` / etc. | — (would benefit from a route-by-route lint) | — |
| **IV-2** | CORS exact-origin allowlist for credentialed routes; wildcards forbidden when `credentials: true`. | closed-2026-05-21 — N12 close | `apps/demo-a2a/src/cors.ts:buildAllowedOriginMatcher` + `ALLOWED_ORIGINS` env | — | — |
| **IV-3** | CSRF token HMAC-bound to origin + timestamp; constant-time compare. | closed | `packages/connect-auth/src/csrf.ts` | `packages/connect-auth/test/csrf.test.ts` | — |
| **IV-4** | Service-MAC envelope between workers verified BEFORE route handler. | closed | `packages/mcp-runtime/src/service-mac.ts:verifyServiceMac` + `apps/demo-mcp/src/index.ts` middleware | `packages/mcp-runtime/test/unit/service-mac.test.ts` (20 tests) | `mcp-runtime.service-mac.{accept,reject}` |

---

## 4.7 Build / supply chain / CI

| ID | Control | Status | Source | Test | Audit event |
| --- | --- | --- | --- | --- | --- |
| **SC-1** | `pnpm install --frozen-lockfile --strict-peer-dependencies` on release CI. | closed-2026-05-23 — Wave H4 | `.github/workflows/ci.yml` "Strict peer-dep resolution" step | CI itself | — |
| **SC-2** | Doctrine checks (capability manifests, boundaries, exports, vocabulary firewall). | closed | `pnpm check:all` | CI "Doctrine checks" step | — |
| **SC-3** | `pnpm audit --prod` on CI + SBOM per release. | closed (in `security.yml`) | `.github/workflows/security.yml` | CI itself | — |
| **SC-4** | Dependabot for monorepo. | closed | `.github/dependabot.yml` | — | — |
| **SC-5** | Secret scanning (gitleaks) on every PR. | closed | `.github/workflows/security.yml` gitleaks step | CI itself | — |
| **SC-6** | CodeQL for TypeScript + Solidity. | closed | `.github/workflows/security.yml` CodeQL step | CI itself | — |

---

## 4.8 Operational / observability

| ID | Control | Status | Source | Test | Audit event |
| --- | --- | --- | --- | --- | --- |
| **OP-1** | Production preflight fail-fast on disclosed deployer key + local KMS + paymaster dev-mode + missing audit sink. | partial — local KMS + paymaster + deployer-key checks landed; audit-sink + per-route MCP coverage pending. **Audited 2026-05-23: this gap formalized as CT-10** (no wrangler D1-binding-presence assertion). | `scripts/check-production-deploy.ts` | — | (refusal log) |
| **OP-2** | Durable audit sink in production. Signing + mint + recovery events persist. | **partial — `CT-8` (P1) is the open finding.** demo-mcp has D1 audit; demo-a2a is console-only at `apps/demo-a2a/src/index.ts:75-77` AND six call sites emit no audit anywhere (`/session/direct-deploy`, `/session/custody-schedule`, `/session/custody-apply`, `/admin/topup-paymaster`, `mintSession`, `/session/package` ERC-1271 reject). | `apps/demo-mcp/src/audit-sink.ts` (D1); `apps/demo-a2a/src/index.ts:75-77` (console-only) | — | various `*.{accept,reject}` + the six zero-emission sites listed in CT-8 |
| **OP-3** | Paymaster monitoring + threshold alert. | partial — `/paymaster/status` exists; alert routing operator-side | `apps/demo-a2a/src/index.ts:/paymaster/status` | — | — |
| **OP-4** | Live canary smoke test after every deploy. | open | — | — | — |
| **OP-5** | Runbooks for the topics in spec 214 § Gate 5. | open | — | — | — |

---

## 4.9 Naming (agent-naming + cross-package integration)

Phase status:
- Phase 1 (SDK scaffold) — shipped 2026-05-23.
- Phase 2 (cross-package integration) — pending. NA-2 / NA-3 / CT-13 close on Phase 2.
- Phase 3 (contract deploy) — pending. NA-2 / NA-4 close on Phase 3.
- Phase 4 (write methods) — pending. NA-2 / NA-5 close on Phase 4.

| ID | Control | Status | Source | Test | Audit event |
| --- | --- | --- | --- | --- | --- |
| **NM-1** | Name normalization deterministic. Two strings that normalize identically produce identical namehashes. | closed-2026-05-23 — NS Phase 1 | `packages/agent-naming/src/normalize.ts`; `packages/agent-naming/src/namehash.ts` | `packages/agent-naming/test/normalize.test.ts` (idempotency) + `test/namehash.test.ts` (golden vectors) | — (pure) |
| **NM-2** | Namehash matches the standard recursive-namehash algorithm (independent in-band reimplementation in test). | closed-2026-05-23 — NS Phase 1 | `packages/agent-naming/src/namehash.ts` | `test/namehash.test.ts` golden-vector table | — |
| **NM-3** | Record schema fail-closed read / fail-loud write — unknown predicates dropped on decode, refused on encode. | closed-2026-05-23 — NS Phase 1 | `packages/agent-naming/src/records.ts` | `packages/agent-naming/test/records.test.ts` | — |
| **NM-4** | No raw passkey material in records (only `passkey-credential-digest`, a hash). | closed-2026-05-23 — NS Phase 1 | `packages/agent-naming/src/types.ts:passkeyCredentialDigest`; `records.ts` encoder | `records.test.ts` accepts Hex digest only | — |
| **NM-5** | `AgentNamingClient` skeleton methods throw `NS Phase 2 / Phase 4` instead of silent no-op. | closed-2026-05-23 — NS Phase 1 | `packages/agent-naming/src/client.ts` | — (manual; trivially verified) | — |
| **NM-6** | Reverse resolution returns name only when round-trip verifies (`resolveName(name) === agent`). | open — Phase 3 contract enforcement + Phase 2 client-side check | spec 215 § 10 | Phase 3 Forge test required | — |
| **NM-7** | Names appear in audit rows (`actor.name?`). | open — NS Phase 2 (`audit.buildEvent` integration) | spec 215 § 7 Phase 2 row | — | every `*.{accept,reject}` row |
| **NM-8** | Policy decisions can branch on name / agent-type (`callerName?`, `callerAgentType?`). | open — NS Phase 2 (`tool-policy.evaluatePolicy` second-arg extension) | spec 215 § 7 Phase 2 row | — | — |
| **NM-9** | Delegation off-chain claims wrap signed `delegatorName / delegateName`; EIP-712 typed-data stays address-bound. | open — NS Phase 2 (`delegation` claims envelope extension) | spec 215 § 7 Phase 2 row + ADR-0006 | — | — |
| **NM-10** | `mcp-runtime.withDelegation` threads `nameContext` into audit + policy decision. | open — NS Phase 2 | spec 215 § 7 Phase 2 row | — | — |
| **NM-11** | `connect-auth` JWT claim `agentName?: string` accepted, signed, NOT resolved by connect-auth. | open — NS Phase 2 | spec 215 § 7 Phase 2 row + ADR-0006 § "Refused: name registration as passkey-enrolment side-effect" | — | — |
| **NM-12** | Registry contract uses owner Smart Agent's `IERC1271.isValidSignature` for authorization. No OpenZeppelin `AccessControl` / `TimelockController` on the registry. | open — NS Phase 3 | ADR-0006 § "Refused: OpenZeppelin AccessControl + TimelockController" | Phase 3 Forge test required | — |
| **NM-13** | CREATE2 address derivation does NOT include name. Name transfers do not change Smart Agent addresses. | closed (invariant — by absence) | `packages/contracts/src/AgentAccountFactory.sol` (no name parameter); ADR-0006 § "Refused: names in CREATE2" | `packages/contracts/test/AgentAccountFactory.t.sol` | — |
| **NM-14** | CAIP-10 `nativeId` predicate validates grammar at encode + restricts namespace allowlist (Phase 1: eip155 / hedera / solana); decode is permissive (forward-compatible). | closed-2026-05-23 — ADR-0008 + spec 215 records extension | `packages/agent-naming/src/records.ts` (nativeId encoder + `CAIP10_NAMESPACE_ALLOWLIST`) | `packages/agent-naming/test/records.test.ts` "nativeId predicate" describe (7 tests) | — |
| **NM-15** | No UAID derivation logic in any shipped package (ADR-0008 refused full HCS-14 UAID generation). Consumers who want UAIDs derive them locally from `nativeId` + their own canonical-JSON context. | closed (invariant — by absence) | ADR-0008 § "Refused: full HCS-14 UAID derivation" | — | — |
| **NM-16** | Agent-identity package (spec 217) ships typed profile schema + CAIP-10 helpers + endpoint verification (DNS TXT / signed URL / HTTP challenge / VP). Architecture locked 2026-05-23; Phase 1 scaffold pending. | open — Phase 1 pending | spec 217, ADR-0007 | — | — |
| **NM-17** | Agent-relationships package (spec 216) ships edge store + relationship-type taxonomy. Architecture locked 2026-05-23; Phase 1 scaffold pending. Assertions + Resolver deferred to v2 per ADR-0007. | open — Phase 1 pending | spec 216, ADR-0007 | — | — |

## 4.10 Demo / stranded state

| ID | Control | Status | Source | Test | Audit event |
| --- | --- | --- | --- | --- | --- |
| **DS-1** | Every demo has a Reset workflow visible from the topbar. | closed | demo-web-pro `DisconnectMenu` "Reset demo"; demo-web-recovery `ResetButton` | — | — |
| **DS-2** | `Act5DelegateTreasury.alreadyIssued` counts only fresh delegations matching current account addresses (not raw localStorage length). | closed-2026-05-23 | `apps/demo-web-pro/src/treasury/acts/Act5DelegateTreasury.tsx` `countFreshDelegations` | — | — |
| **DS-3** | Stranded-state detector at app load (prompts reset when localStorage references unreachable accounts). | open — currently the dashboard's per-card check surfaces the gap; no top-level banner | — | — | — |

---

## 5. Open-finding summary by package

Severity rolled up from the rows above; matches `product-readiness-audit.md`.

| Package | P0 open | P1 open | P2 open | Top finding |
| --- | --- | --- | --- | --- |
| `agent-account` | 0 | 0 | 0 | (clean post Wave 2A) |
| `delegation` | 0 | 1 | 0 | OA-3 off-chain quorum verification implementation stub |
| `key-custody` | 0 | 1 | 1 | KH-5 (HMAC rotation procedure), KH-4 (per-tool HKDF) |
| `mcp-runtime` | 0 | 0 | 1 | clean post H1/H3; new CT-9 — `generateServiceMac` has no issuing-side audit sink, P2 |
| `tool-policy` | 0 | 0 | 0 | (clean) |
| `custody` | 0 | 0 | 0 | (clean post Wave H2) |
| `audit` | 0 | 1 | 2 | OP-2 / CT-8 (durable A2A sink, primary). Secondaries: CT-11 (composeSinks failure-rate metric), CT-12 (NODE_ENV default-to-dev footgun in workers) |
| `connect-auth` | 0 | 0 | 1 | passkey UV policy default ("preferred" — should be "required" for high-assurance) |
| `agent-account` (contracts) | 0 | 0 | 1 | SB-2 (ECDSA `s` normalization on non-GCP paths) |
| `types` | 0 | 0 | 0 | — (NameContext + AgentType added 2026-05-23; consumed via injection by audit / tool-policy / delegation / mcp-runtime / connect-auth in NS Phase 2) |
| `agent-naming` | 0 | 0 | 5 | NA-1..NA-5 — Phase 1 invariants closed (NM-1..NM-5 + NM-14 + NM-15); NM-6..NM-12 open pending NS Phase 2/3/4 |
| `agent-profile` | 0 | 0 | 0 | architecture locked (spec 217 + ADR-0007 + ADR-0008); Phase 1 scaffold pending → NM-16 |
| `agent-relationships` | 0 | 0 | 0 | architecture locked (spec 216 + ADR-0007); Phase 1 scaffold pending → NM-17 |
| cross-cutting | 1 | 3 | 4 | CT-1 (disclosed deployer key, **P0**), CT-3 (off-chain quorum, P1), CT-4 (external contract audit, P1), **CT-8** (durable A2A audit — refined inventory, **P1**), CT-5 (paymaster budget, P2), CT-6 (per-tool HKDF, P2), CT-9 (`generateServiceMac` no issuing sink, P2), CT-10 (preflight binding-presence assertion, P2), CT-11 (`composeSinks` failure-rate metric, P3), CT-12 (NODE_ENV worker-env footgun, P3). CT-2 superseded by CT-8. |

---

## 6. How to use this checklist

**As a security auditor:** find a control row, run the test, read the
source. If the test passes and the source matches the description,
the control is verified. If anything is off, write a finding into
`product-readiness-audit.md` and flip the row's status to `open`.

**As an external reviewer:** start at the top, read each row. When
status is `closed-YYYY-MM-DD — <evidence>`, follow the source +
test links. When status is `open` or `partial`, the row is itself
the open finding.

**As an implementer landing a wave:** open this file FIRST. Find
which row(s) your change affects. Update status before merging.
The wave isn't done until the row is updated.

---

## 7. Change log

| Date | Wave | Rows changed |
| --- | --- | --- |
| 2026-05-23 | H1-H4 + H2 (custody) | AC-4, CR-1 augmented (H2 echo), CR-3, CR-5 (new), OA-2 (H1 closure), OA-3 (H3 closure), KH-1 (H1 closure), SC-1 (H4 closure), DS-2 (H1.5 closure), OP-2 (H5 task documented). |
| 2026-05-23 | security-auditor on H5 | OP-2 refined to reference CT-8 (with the 6 zero-emission call sites enumerated). OP-1 augmented to reference CT-10. Open-finding rollup updated: `mcp-runtime` flips 0/0/0 → 0/0/1 (CT-9). `audit` flips 0/1/0 → 0/1/2 (adds CT-11, CT-12). Cross-cutting flips 1/2/2 → 1/3/4 with the full CT-8/9/10/11/12 inventory. CT-2 noted as superseded. |
| 2026-05-23 | NS Phase 1 + ADR-0006 | New § 4.9 Naming controls (NM-1..NM-13) added. NM-1..NM-5 closed (Phase 1 invariants). NM-13 closed (CREATE2 stays address-bound — invariant by absence per ADR-0006). NM-6..NM-12 open pending NS Phase 2/3/4. `types` row annotated with NameContext + AgentType cross-cutting addition. New `agent-naming` row added (0/0/5). Previous § 4.9 renumbered to § 4.10. |
| 2026-05-23 | NS lockdown (ADR-0007 + ADR-0008 + specs 216/217) | Added NM-14 (CAIP-10 grammar validation, closed via code change in same turn — 7 new tests in records.test.ts). Added NM-15 (no UAID derivation — invariant by absence per ADR-0008). Added NM-16 (agent-profile package architecture, Phase 1 pending). Added NM-17 (agent-relationships package architecture, Phase 1 pending). Per-package rollup gains `agent-profile` + `agent-relationships` rows (0/0/0 — architecture locked, no findings yet). |
| earlier | various | Initial table. |
