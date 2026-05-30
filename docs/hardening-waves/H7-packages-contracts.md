# H7 — Packages + Contracts Hardening Wave

| Field | Value |
|---|---|
| **Opened** | 2026-05-30 |
| **Owner** | this conversation; executor = next coding session |
| **Scope** | `packages/*` + `apps/contracts/*` ONLY. Demo apps + app-integration specs out of scope. |
| **Driver doc** | [`docs/audits/2026-05-packages-contracts-production-readiness.md`](../audits/2026-05-packages-contracts-production-readiness.md) — the audit tracker this wave closes against. |
| **Gate at end** | One external Solidity firm + targeted TS-crypto scope; library + contracts shippable as a `0.1.0-alpha` line. |
| **Estimated total** | ~4 weeks 1-dev (A→F + one coordinated redeploy R1). |

## Where the review is misinformed (relayed here so doctrine stays clean)

| Reviewer claim | Reality |
|---|---|
| "Zero visible .sol sources… no `contracts/`" | False. Contracts live at `apps/contracts/src/` (22 contracts, 358/358 forge tests pass). The reviewer was scoped to `packages/` only — itself the root cause of **EXT3-001** (not published as a peer-installable package). |
| "9 packages only" | Stale. We ship 16. The missing seven include `ontology`, `identity-directory`, `identity-directory-adapters` — exactly the packages our own architecture audit flagged as "earned-but-thin" (XPKG-004-arch). Accidental confirmation. |
| "Past fail-open policy" | Closed in H4. |
| Per-package SBOM, SLSA L3, "lives-impact threat model in README" | Production-library bar — partially valid; the parts that apply at the package layer are baked into H7-E.8 + H7-E.9. The "lives-impact / faith-context" framing is **app-layer per ADR-0021**; declined at the package layer. |
| "Two-firm external audit" | One Solidity firm + targeted TS-crypto scope is closer to the right shape at v0.1; full TS-side firm is over-spec. |

## Sequencing

```
H7-A  (1½ d)  doctrine-green + contracts-as-package
  ↓
H7-B  (4 d)   public-API hardening + tamper-evident audit + key rotation + delegator-nonce
  ↓
H7-C  (5 d)   contract critical-surface + governance pattern + pause surfaces + redeploy R1
  ↓
H7-D  (5–7 d) coverage to external-audit floor (parallel with F)
H7-E  (2 d)   CI/build + api-extractor + provenance
H7-F  (2 d)   PII / observability
  ↓
External Solidity audit + targeted TS-crypto scope
```

B13 (delegator-nonce) + B14 (caveat metadataHash) + C5 (CustodyPolicy `_verifyQuorum` refactor) + C9 (governance) each touch deployed contracts. They land in one **coordinated redeploy** at the end of C — call it `R1`. Pin contract address invariants in `deployments-base-sepolia.json` before R1 so consumers see the cut.

---

## Batch H7-A — Doctrine-green

Goal: turn `pnpm check:all` green, end rename drift, ship the most embarrassing single fix.

> **Split note (2026-05-30 during execution):** A6 (contracts-as-package extract) is large enough that it's shipping as its own commit `A.2`. A1..A5 + A4-guard + A7-verify ship together as `A.1`. Same Batch, two commits, same acceptance.

| ID | Change | Files | Acceptance |
|---|---|---|---|
| **A1** | Close `check:public-exports` drift on `key-custody`. **Drop `deriveSubjectPrivateKeyHex` from `src/index.ts`** (raw per-subject privkey leak; module-internal stays so unit tests can verify the derivation). Promote `deriveSubjectSigner`, `subjectCanonicalMessage`, `SubjectId`, `DeriveSubjectOpts` into `manifest.publicExports`. Update spec 203 + key-custody CLAUDE.md "Stable public exports" block. | `packages/key-custody/{src/index.ts, capability.manifest.json, CLAUDE.md}`, `specs/203-key-custody.md` | `pnpm check:public-exports` exits 0; `pnpm --filter @agenticprimitives/key-custody test` green. |
| **A2** | `license: "MIT"` on all 16 packages + `LICENSE` in each `files` array. | `packages/*/package.json` | `pnpm -r exec npm pkg get license` returns `"MIT"` everywhere. |
| **A3** | Rename sweep: `identity-auth` → `connect-auth`, `agent-identity` → `agent-profile`, `custody` → `account-custody`. Includes `[agent-identity]` → `[agent-profile]` error-message prefixes in `packages/agent-profile/src/{errors.ts,client.ts}`. | `specs/100`, `docs/architecture/{vocabulary-map,task-routing,product-readiness-audit}.md`, 62 in-package refs. | `git grep -nE 'identity-auth\|agent-identity\|@agenticprimitives/custody'` finds zero hits outside historical changelog/ADR entries. |
| **A4** | Add missing `AUDIT.md` to 5 packages from `docs/audits/_template.md`. Update `scripts/check-package-docs.ts` to **require** `AUDIT.md` (closes doctrine-vs-guard gap). | `packages/{account-custody,connect,identity-directory,identity-directory-adapters,ontology}/AUDIT.md`, `scripts/check-package-docs.ts` | `pnpm check:package-docs` exits 0 with required-AUDIT check enabled. |
| **A5** | Rebuild `dist/` + add CI dist-drift guard that fails when `pnpm -r build` produces uncommitted diffs. | `packages/*/dist/`, `.github/workflows/ci.yml` | `dist/` matches `src/` post-build; CI gate green on the rebuild commit. |
| **A6** | **Extract `apps/contracts` → `packages/contracts`.** New `packages/contracts/` with `dist/{abi,flat,typed}/`, `deployments-*.json`, `scripts/verify-{base-sepolia,base,mainnet}.sh`. Update `agent-account`, `delegation`, `account-custody` to peer-dep on it; remove duplicated ABI string literals where they exist. Foundry config + remappings move with the sources. Closes EXT3-001. | `packages/contracts/` (new), `apps/contracts/` (delete or convert to dev pass-through), `foundry.toml`, `remappings.txt`, three consumer packages. | `pnpm --filter @agenticprimitives/contracts build` outputs ABIs + flattened sources + typed bindings; `forge test` passes from `packages/contracts/`; consuming packages import from `@agenticprimitives/contracts/abi` not literal strings. |
| **A7** | Verify + commit. `pnpm check:all`, `pnpm -r test`, `forge test` in `packages/contracts`. One commit for Batch A. | repo | green CI; commit message lists every closed finding ID. |

**Closes:** ARCH-006, ARCH-038, PKG-KEY-CUSTODY-002, XPKG-001, XPKG-003, XPKG-005-arch, EXT-011, PKG-agent-profile-001, PKG-agent-profile-002, ARCH-018, **EXT3-001**.

---

## Batch H7-B — Public-API hardening

Goal: every load-bearing public API is fail-closed; every breaking change is the kind a senior reviewer compliments.

| ID | Change | Files | Breaking? |
|---|---|---|---|
| **B1** | `buildToolExecutorBackend` → `buildToolExecutorBackendNoIsolation` AND throw at construction outside tests unless `AP_ALLOW_NO_TOOL_ISOLATION=true`. | `packages/key-custody/src/factories.ts` | **YES** |
| **B2** | Strict-mode caveat evaluator. Missing context → `{ allowed: false, reason: 'context-required' }`. New opt-in `{ enforceOnChain: true }` for callers who guarantee on-chain redeem. `verifyDelegationToken` requires the opt-in. | `packages/delegation/src/{evaluator,token}.ts` | **YES** |
| **B3** | `verifyUserSignature` typed result: `{ ok: true } \| { ok: false, reason: 'invalid' \| 'rpc' \| 'config' }`. Drop `boolean`. | `packages/connect-auth/src/verify-signature.ts` | **YES** |
| **B4** | `verifyAgentSession.expectedAud: string` (non-optional). | `packages/connect/src/token.ts` | **YES** |
| **B5** | `BoundMintIdTokenInput` extending `MintIdTokenInput` with required `enrollmentGrantId` + `delegationHash`. Add `verifyEnrollmentGrantBinding(token, expected)` helper. Mark `mintIdToken(MintIdTokenInput)` `@internal`. | `packages/connect/src/token.ts` | additive |
| **B6** | JTI store DDL split: move `CREATE TABLE IF NOT EXISTS` into separate `migrate()` function. Constructor stops touching DDL. Hot path errors loudly if table missing. | `packages/mcp-runtime/src/jti-stores.ts` | **YES** |
| **B7** | `composeFailHardSinks(sinks)` that throws on first sink failure for security-critical events. `composeSinks` aliased to `composeFailSoftSinks`. Document in CLAUDE.md which actions REQUIRE fail-hard. | `packages/audit/src/index.ts` + `packages/audit/CLAUDE.md` | additive |
| **B8** | **Delete** `verifyCrossDelegation` stubs from top-level exports in `delegation` + `mcp-runtime`. Resurface only when implemented behind `./experimental` subpath per spec 100 §6. | `packages/delegation/src/{token,index}.ts`, `packages/mcp-runtime/src/with-delegation.ts` | **YES** |
| **B9** | Stop keying off `NODE_ENV` for safety defaults. Replace with explicit `environment: 'production' \| 'development'` at each API. Default `'production'` (fail-closed). 5 sites. | `packages/{delegation,mcp-runtime,key-custody}/src/...` | **YES** |
| **B10** | `deriveSaltFromEmail(email, rotation, { secret })` — `secret` required. Existing zero-arg call throws in production env. Document threat model in CLAUDE.md. | `packages/connect-auth/src/salt.ts` | **YES** |
| **B11** | **Tamper-evident audit sinks.** `createHashChainSink(prevHash)` + `createMerkleAnchorSink({ anchorTo: ContractWriter, flushIntervalMs })` + `createDeletionReceipt({ subject, what, when, sink, hashChainHead })`. Pure-TS hash chain; the anchor sink is opt-in. | `packages/audit/src/{hash-chain,merkle-anchor,deletion-receipt}.ts` (new), `packages/audit/src/index.ts` | additive |
| **B12** | **`key-custody` mandatory-HSM + rotation.** `buildSignerBackend({ requireExternal: true })` throws on local providers. `rotateMasterKey(from, to, { dualRead, witnessSink })` API with documented dual-read window. | `packages/key-custody/src/{factories,rotate}.ts` (rotate new) | additive |
| **B13** | **Delegation emergency-revoke-all.** Add `delegatorNonce(D)` to EIP-712 caveat struct. Contract-side companion: `getDelegatorNonce(D)` view on DelegationManager + verify-time inclusion. **Requires contract redeploy R1.** Spec change to spec 202. | `packages/delegation/src/{token,types}.ts`, `apps/contracts/src/agency/DelegationManager.sol`, `specs/202-delegation.md` | **YES** |
| **B14** | **Caveat metadata slot.** Add `metadataHash: bytes32` to `Delegation` struct in EIP-712 typed data + contract. Verified on-chain as hash only (apps attach JSON off-chain). Bundle with B13 in R1. | `packages/delegation/src/types.ts`, `apps/contracts/src/agency/DelegationManager.sol`, `specs/202-delegation.md` | **YES** |

**Closes:** PKG-DELEGATION-001, PKG-DELEGATION-002, PKG-CONNECT-AUTH-001, PKG-CONNECT-001-sec, PKG-connect-001-arch, PKG-MCP-RUNTIME-001, PKG-AUDIT-001, PKG-KEY-CUSTODY-001, PKG-CONNECT-AUTH-002, XPKG-002, XPKG-005, EXT-020/-022/-023/-024/-025/-027/-030, CT-6/-11/-12/-13, KH-5, **EXT3-002, EXT3-005, EXT3-006, EXT3-007, EXT3-008, EXT3-011**.

---

## Batch H7-C — Contract critical-surface + governance

Goal: close the WebAuthn / P-256 / TLD / signature-slot findings; bake the timelock + multisig governance pattern into the deploy script. Ends with R1.

| ID | Change | Files |
|---|---|---|
| **C1** | WebAuthnLib pins RP-ID hash + UP flag + (optional) UV. Verifies `clientDataJSON.origin` allowlist hash. `AgentAccount` stores `rpIdHash` per credential (immutable at registration). | `apps/contracts/src/libraries/WebAuthnLib.sol`, `apps/contracts/src/AgentAccount.sol`, tests |
| **C2** | P256Verifier rejects silent Daimo fallback. Constructor/immutable `daimoVerifier` address; chain operator explicitly configures or passes `address(this)` for "RIP-7212 only". | `apps/contracts/src/libraries/P256Verifier.sol`, `script/Deploy.s.sol` |
| **C3** | `SignatureSlotRecovery` bounds checks on v=0 and v=2 paths before reading sig tail. | `apps/contracts/src/libraries/SignatureSlotRecovery.sol`, tests |
| **C4** | `AgentNameRegistry.initializeRoot` callable only by immutable `deployer` set at construction OR bundled atomically in `Deploy.s.sol` constructor arg (pick atomic-bundle). | `apps/contracts/src/naming/AgentNameRegistry.sol`, `script/Deploy.s.sol` |
| **C5** | `CustodyPolicy._verifyQuorum` struct-pack the verify-context args so `forge coverage` compiles under deployment settings (no `--ir-minimum`). | `apps/contracts/src/custody/CustodyPolicy.sol` |
| **C6** | Storage-layout snapshot tests: `forge inspect <C> storageLayout` snapshots committed for `AgentAccount`, `CustodyPolicy`, `DelegationManager`, `SmartAgentPaymaster`. CI diff-fail. | `apps/contracts/test/storage/`, `.github/workflows/ci.yml` |
| **C7** | `Paymaster.getHash` binds `address(entryPoint)` so signed envelopes can't survive an EntryPoint redeploy. | `apps/contracts/src/SmartAgentPaymaster.sol`, tests |
| **C8** | Namespace error names: `DelegationManager_InvalidSignature`, `Paymaster_InvalidSignature`. | `apps/contracts/src/{agency/DelegationManager,SmartAgentPaymaster}.sol` |
| **C9** | **Standardized governance pattern.** `Deploy.s.sol` deploys (a) Gnosis Safe (3-of-5 multisig) + (b) OZ `TimelockController(24h)`. All `onlyGovernance` roles + TLD ownership + ontology registry ownership transferred from deployer to the timelock. Deployer EOA renounces every role. | `apps/contracts/script/Deploy.s.sol`, `apps/contracts/src/Governance.sol` (new helper) |
| **C10** | Pause surfaces. Wire `whenNotPaused` on `DelegationManager.redeemDelegation`, `AgentAccountFactory.createAgentAccount`, `SmartAgentPaymaster._validatePaymasterUserOp`. Pause callable from timelock OR a separate "guardian" role (no other authority). | `apps/contracts/src/{agency/DelegationManager,AgentAccountFactory,SmartAgentPaymaster}.sol`, tests |
| **R1** | **Coordinated redeploy.** Bundle B13 + B14 + C1..C10 onto Base Sepolia. Update `deployments-base-sepolia.json`. Mark v0 deployments as `deprecated` with timestamp; consumers reading old addresses fail-loud per ADR-0013. | `packages/contracts/deployments-base-sepolia.json`, runbook entry |

**Closes:** CON-WEBAUTHN-001, CON-P256-001, CON-SIG-SLOT-001/-002, CON-NAMING-001, CON-CustodyPolicy-002, XCON-002, XCON-003, CON-PAYMASTER-004, XCON-005, CON-DEPLOY-001, CON-FACTORY-001, XCON-002-sec, CT-1 (contract layer), **EXT3-009, EXT3-010**.

---

## Batch H7-D — Coverage to external-audit floor

Goal: every load-bearing contract ≥ 85% lines / 75% branches; vitest threshold gate added. Parallel with E and F.

| ID | Target | Plan |
|---|---|---|
| D1 | `AgentAccount.sol` 55% → ≥ 85% | Invariant tests: passkey set membership ↔ count; custodianCount ≡ externalCustodianCount + piaCount; module flag ↔ installedList. Fuzz `executeFromModule` callbacks. Hook iteration bounds. |
| D2 | `DelegationManager.sol` 42% → ≥ 85% | Fuzz delegation chain × caveat enforcer matrix; negative tests for malformed sigs; SB-1/SB-2 invariant tests. |
| D3 | `CustodyPolicy.sol` 70%/30% br → ≥ 85%/75% | Matrix fixtures over 16 CustodyAction × 6 tier × {schedule, apply, cancel}. Recovery-quorum recursion tests. Cancel-DoS test (CON-CUSTODY-002). |
| D4 | `SmartAgentPaymaster.sol` 52% → ≥ 85% | Validation-mode matrix (dev / allowlist / verifying) × malformed paymasterAndData / ECDSA edge cases. |
| D5 | `WebAuthnLib.sol` 16% → ≥ 85% | Dedicated `test/libraries/WebAuthnLib.t.sol` with FIDO Alliance public test vectors + adversarial cross-origin assertions (verifies C1 closure). |
| D6 | `P256Verifier.sol` 0% → ≥ 85% direct | Dedicated `test/libraries/P256Verifier.t.sol` with Wycheproof edge vectors (point at infinity, s > n/2, malformed coords). |
| D7 | `SignatureSlotRecovery.sol` 68%/47% → ≥ 85%/75% | Per-v-byte matrix; verifies C3 closure. |
| D8 | vitest per-package coverage threshold | `--coverage` in CI; fail if any package < 60% lines. Lift `types` from 0 → `tsd` type tests. |
| D9 | TS↔Solidity typehash equality CI gate | `test/cross-stack/typehash.test.ts` reads typehashes from contracts via RPC and asserts byte-equal to TS constants. |
| D10 | Cross-stack `validUntil` boundary fix | Off-chain `evaluator.ts:34` `>=` → `>` to match contract semantics. |

**Closes:** XCON-001, CON-AgentAccount-001, CON-DelegationManager-001, CON-CustodyPolicy-001, CON-SmartAgentPaymaster-001, CON-Libraries-001, CON-Libraries-002, CON-Libraries-003, XPKG-001-sec, XPKG-003-sec, XPKG-007.

---

## Batch H7-E — CI / build / publish posture

Goal: ship like a library, not a monorepo for internal use.

| ID | Change |
|---|---|
| E1 | Add **Slither** to `security.yml` (CodeQL doesn't cover Solidity). |
| E2 | `forge coverage` thresholds in CI: fail if line < 75% or branches < 65% on any `src/` contract; higher bar (85%/75%) for libraries. |
| E3 | **Changesets release flow** — `.changeset/`, `release.yml`, `pnpm changeset publish`. Bump all packages to `0.1.0-alpha.1`. |
| E4 | `publishConfig: { access: public }` in each scoped package. |
| E5 | `peerDependencies` tightening — pick `viem ^2.50.0` floor. |
| E6 | SBOM published per release as a workflow artifact (currently `continue-on-error`). |
| E7 | Verify `check:all` is a single fail-fast required check on every PR. Six doctrine guards (`check:public-exports`, `check:package-boundaries`, `check:cross-cutting-capabilities`, `check:no-domain-in-packages`, `check:forbidden-terms`, `check:capability-manifests`, `check:package-docs`) bundled. |
| **E8** | **API surface snapshot tests per package** via `@microsoft/api-extractor` (or `tsd` snapshots where api-extractor is heavyweight). CI fails on unreviewed signature drift. Closes **EXT3-003**. |
| **E9** | **`npm publish --provenance`** (GitHub OIDC Sigstore) on every release; SBOM archived as release asset. Closes **EXT3-004**. |

**Closes:** XPKG-006-arch, XPKG-009, EXT-005, **EXT3-003, EXT3-004**.

---

## Batch H7-F — PII / observability surface (parallel with D)

| ID | Change |
|---|---|
| F1 | `McpAuthError` split — `PublicMcpAuthError` (opaque code) + `PrivateAuthFailureContext` (internal id + reason); `withDelegation` returns public shape, emits private context to audit sink. |
| F2 | Canonical `AuditActionRegistry` — typed action names (`delegation.mint`, `key-custody.sign`, `custody.schedule`, …); free-string `action` deprecated. |
| F3 | `generateServiceMac` audit sink — accept `auditSink?` arg + emit issuance event. |
| F4 | GCP MAC key-rotation marker — `decryptSessionDataKey` consults key-version metadata, not hardcoded string. |
| F5 | `Secret<T>` opaque brand — replace `Record<string, string>` config bag in `key-custody` with branded loaders that won't survive `JSON.stringify`. |

**Closes:** PKG-MCP-RUNTIME-003, PKG-audit-002, PKG-MCP-RUNTIME-006, PKG-KEY-CUSTODY-008, PKG-KEY-CUSTODY-005, EXT-026/-032/-037, CT-9.

---

## Conscious deferrals (not in H7)

- **CT-1** disclosed deployer EOA / operator key custody → C9 closes the contract-layer aggregation, but the Safe signer set + key-custody runbook is operator work, not H7.
- **CON-AgentAccount-002** validator-module extraction (spec 209) → architectural refactor, defer until post-external-audit.
- **PKG-agent-relationships-001** Privacy Fork (EXT-019) → mark `stability: experimental` + top-of-README warning + spec 239 for the private alternative. Don't try to fix the public-edges model in H7.
- **XCON-004** redeploy migration plan → spec work; R1 is the first proof of the pattern.
- **TSS / MPC fallback** in key-custody → post-alpha.
- **VC / W3C DID** in connect-auth → future `@agenticprimitives/agent-vc` package.
- **Differential privacy** in tool-policy → app layer per ADR-0021.

---

## Acceptance for the wave as a whole

- `pnpm check:all` green; CI on master green.
- `forge coverage` ≥ 85% lines on AgentAccount, DelegationManager, CustodyPolicy, Paymaster, WebAuthnLib, P256Verifier, SignatureSlotRecovery.
- Every audit-tracker row above marked 🟢 CLOSED with commit SHA.
- `packages/contracts` installable via npm with ABIs + flattened sources + deployments JSON.
- One external Solidity audit engagement scheduled; targeted TS-crypto scope drafted.
- All 16 packages bumped to `0.1.0-alpha.1` via changesets, published with `--provenance`.
- R1 redeploy artifact: new addresses in `packages/contracts/deployments-base-sepolia.json`; old addresses flagged `deprecated`.

## Re-audit policy

After each batch closes, re-run `security-auditor` + `technical-architect-auditor` with `select:<closed-ids>` to verify no regression. Every closed row gets a commit SHA inline in the audit tracker.
