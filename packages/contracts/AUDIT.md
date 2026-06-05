# `@agenticprimitives/contracts` — Security & Architecture Audit

**Status:** alpha (Base Sepolia testnet, deployed end-to-end)
**Last refreshed:** 2026-06-01 (R9 wave landed — Foundry invariant suites + Halmos symbolic proofs + Echidna nightly + Medusa weekend; H-6 `MAX_INITIAL_CUSTODIANS = 32` cap closed; supply-chain CVE allowlist; AEL spec 237 + Package Design v2 spec 238)
**Prior refresh:** 2026-06-01 (R6 contracts hardening wave landed)
**Owners:** contracts package CODEOWNERS
**System audit cross-reference:** [`docs/architecture/product-readiness-audit.md`](../../docs/architecture/product-readiness-audit.md)
**Prior dossier:** [`docs/audits/2026-05-packages-contracts-production-readiness.md`](../../docs/audits/2026-05-packages-contracts-production-readiness.md) (per-contract findings table)
**Recon doc:** [`docs/audits/r6-contracts-recon-2026-05-31.md`](../../docs/audits/r6-contracts-recon-2026-05-31.md) (R6 wave triage)

> **Reader's note for external auditors.** This dossier is the AUDIT-ready summary of the security posture of every contract under `src/`. It pairs with `specs/214-production-audit-dossier.md` (the target shape we're auditing toward), the [`docs/audits/`](../../docs/audits) folder (threat model, architecture diagram, evidence checklist), and the **R10 internal readiness assessment** at [`docs/audits/2026-06-01-r10-internal-readiness-assessment.md`](../../docs/audits/2026-06-01-r10-internal-readiness-assessment.md) (active P0/P1/P2/P3 backlog). For finding-level detail use the cross-references at the bottom of each section.
>
> **Coverage stack as of R9 (2026-06-01):** 680 Foundry tests across 37 .sol files + 7 Halmos symbolic proofs + 4 Echidna nightly properties + 4 Medusa weekend properties. R6 (2026-06-01), H1-H4 (2026-05-23), and earlier waves are all reflected. Static analysis (Slither + Aderyn + CodeQL) + Solhint security lint are PR-blocking; pnpm-audit + gitleaks + SBOM in the security workflow.

## 1. Charter

This package ships the **on-chain enforcement layer** for the agenticprimitives stack:

| File | Role |
|---|---|
| `AgentAccount.sol` | ERC-4337 v0.7 SA (UUPS-upgradeable, ERC-7579 module-host, ERC-1271 verifier, WebAuthn-supporting) |
| `AgentAccountFactory.sol` | CREATE2 deterministic deployer; salt derives from auth methods + scope (NEVER from a name, per ADR-0010) |
| `agency/DelegationManager.sol` + `enforcers/*` | Scoped ERC-7710 delegation with on-chain caveat enforcement (AllowedTargets, AllowedMethods, Timestamp, Value, Quorum) |
| `custody/CustodyPolicy.sol` | Multi-sig custodian / trustee quorum + scheduled-action machinery (spec 213 carve-out, ERC-7579 module) |
| `SmartAgentPaymaster.sol` | ERC-4337 paymaster — three validation modes (dev / allowlist / verifying-paymaster) |
| `naming/{AgentNameRegistry, PermissionlessSubregistry, AgentNameUniversalResolver}.sol` | `.agent` + `.impact` TLDs + hierarchical registry + resolver |
| `identity/AgentProfileResolver.sol` | ERC-1056-style profile / AgentCard facet resolver |
| `ontology/{OntologyTermRegistry, ShapeRegistry, AttributeStorage}.sol` | SHACL shape + JSON-LD predicate registries |
| `relationships/AgentRelationship.sol` | Public on-chain edge model (⚠ Privacy Fork — see EXT-019; remains *experimental* surface) |
| `governance/{AgenticGovernance, GovernanceManaged}.sol` | System-wide pause flag + governance-managed base (R6.8 added `whenNotPaused` modifier via inheritance) |
| `libraries/{WebAuthnLib, P256Verifier, SignatureSlotRecovery, MultiSendCallOnly}.sol` | Security-critical primitives |
| `UniversalSignatureValidator.sol` | Single-entry signature validator per spec 214 SB-4 (ERC-6492 + ERC-1271 + raw ECDSA fanout) |
| `ApprovedHashRegistry.sol` | v=1 pre-approved hash signature path |

**Public addresses per network:** [`deployments-base-sepolia.json`](./deployments-base-sepolia.json) — committed; the source of truth, surfaced to TypeScript consumers via the generated [`@agenticprimitives/contracts/deployments/base-sepolia`](./dist/deployments/) subpath (R7.3).

## 2. Security invariants (DO NOT BREAK)

| # | Invariant | Status | Evidence |
|---|---|---|---|
| 2.1 | **EIP-712 typehashes byte-match the off-chain TS constants.** | ✅ CLOSED R11.4 | `packages/delegation/test/integration/cross-stack-typehashes.test.ts` + `pnpm check:eip712-typehash-equality` assert TS/Solidity equality. Keep this command in the public self-audit validation ledger. |
| 2.2 | **`AgentAccount` storage uses ERC-7201 namespaced slots + 50-slot gap.** | ✅ CLOSED H7-C.6 | `pnpm check:storage-layouts` (snapshot under CI) |
| 2.3 | **WebAuthn assertion verification pins RP-ID + UP flag.** | ✅ CLOSED H7-C.1 / CON-WEBAUTHN-001 | `_setupInitialPasskey` rejects zero rpIdHash (`AgentAccount.sol:354-356`); R6.10 added `_validateUserOp` happy-path test pack |
| 2.4 | **P256Verifier dispatcher rejects silent Daimo fallback.** | ✅ CLOSED H7-C.2 / CON-P256-001 | `P256Verifier.sol` |
| 2.5 | **`SignatureSlotRecovery` bounds-checks `v=0` + `v=2` slots.** | ✅ CLOSED H7-C.3 / CON-SIG-SLOT-001/-002 | `libraries/SignatureSlotRecovery.sol` |
| 2.6 | **`AgentNameRegistry.initializeRoot` cannot be frontrun.** | ✅ CLOSED H7-C.4 / CON-NAMING-001 | `AgentNameRegistry.sol:144-147` — immutable `initializer` + same-tx deploy |
| 2.7 | **`DelegationManager.redeemDelegation` is `nonReentrant`.** | ✅ CLOSED SC5 §6.2 | OpenZeppelin `ReentrancyGuard` mixin on `redeemDelegation` |
| 2.8 | **Factory + Paymaster governance is timelock + multisig, not a deployer EOA.** | ⏳ OPEN — N1 (operator-deferred) | Testnet currently uses the disclosed demo deployer; production rotation runbook is § 4 below |
| 2.9 | **Pause surfaces wired on critical paths.** | ✅ CLOSED R6.5 / R6.6 / R6.8 — pause matrix in § 3.4 | See § 3.4 |
| 2.10 | **`PermissionlessSubregistry.register` is `nonReentrant`.** | ✅ CLOSED R6.2 / CON-SUBREGISTRY-003 | `PermissionlessSubregistry.sol:register` |
| 2.11 | **Stateless enforcers don't need a pause check.** | ✅ CLOSED R6.7 / CON-ENFORCER-PAUSE-001 | Documented + test-locked in `test/EnforcerPauseInvariantR67.t.sol` |
| 2.12 | **CustodyPolicy reinstall is permanently forbidden.** | ✅ CLOSED audit C-11 | `CustodyPolicy.sol:onUninstall` + `onInstall` reinstall gate; tested in `CustodyPolicyWave2C.t.sol` |
| 2.13 | **`SmartAgentPaymaster.getHash` binds `address(entryPoint)` + chainId.** | ✅ CLOSED H7-C.7 / CON-PAYMASTER-004 | `SmartAgentPaymaster.sol:206-222`; tested in `SmartAgentPaymasterValidateR610.t.sol` |
| 2.14 | **`SmartAgentPaymaster` constructor takes EXPLICIT `devMode` (no implicit fail-open).** | ✅ CLOSED R5.7 / PKG-PAYMASTER-002 / external audit P0-2 | `SmartAgentPaymaster.sol:126-141`; tested in `SmartAgentPaymaster.t.sol::test_R5_7_*` |

## 3. Per-contract notes for the external review

### 3.1 `AgentAccount.sol` + `AgentAccountFactory.sol`

- **ERC-4337 v0.7 + ERC-7579.** AgentAccount is a thin core (custody / threshold / spend / sessions live in modules, NOT inlined) — see spec 209 + `feedback_erc7579_module_architecture`.
- **UUPS upgradeable** with `_authorizeUpgrade` gated by `onlySelf` (modifier requires `msg.sender == address(this)`). The ONLY path is a re-entrant call from `upgradeToWithAuthorization` — that function is **explicitly disabled (`LegacyUpgradePathDisabled()`)** per H7-A.5 / audit C-3 closure. Per-account upgrades route through `CustodyPolicy.ApplySystemUpdate` (T5 / 24h timelock by default).
- **Pause coverage (R6.5):** `whenNotPaused` on `execute`, `executeBatch`, `executeFromModule`, `installModule`, `executePendingUpgrade`, `addCustodian` (6 functions). Recovery paths INTENTIONALLY UNGUARDED: `uninstallModule`, `cancelPendingUpgrade`, `removeCustodian` — incident response must remain functional under pause. Test pack: `test/AgentAccountPauseR65.t.sol` (14 tests).
- **`isValidSignature` dispatch:** type byte 0x01 → WebAuthn, type byte 0x02 → ECDSA, raw fallback → custodian sig. WebAuthn path pins per-credential rpIdHash + requires UP flag.
- **CREATE2 salt invariant.** Salt MUST derive from auth methods + scope, NEVER from a name (ADR-0010 + spec 220). Credential rotation does NOT change the SA address (ADR-0011 + spec 221).

### 3.2 `agency/DelegationManager.sol` + `enforcers/*`

- **5 enforcers.** AllowedMethods, AllowedTargets, Timestamp, Value, Quorum. All five are **stateless validators**: `beforeHook` / `afterHook` are pure / view, no SSTORE, no events. Invariant locked in `test/EnforcerPauseInvariantR67.t.sol` (R6.7) — see § 3.3.
- **EIP-712 Caveat typehash** = `keccak256("Caveat(address enforcer,bytes terms)")` — EXCLUDES `args` (audit F-1 — the inclusion bug caused every caveat-carrying delegation to fail on-chain ERC-1271 redeem AND let a redeemer's chosen args ride inside the delegator's signature). `packages/delegation/src/hash.ts` mirrors this.
- **Test posture:** DelegationManager 95.8% lines / 88.2% branches (post-R6 aggregator).
- **QuorumEnforcer:** payload-hash binding closed in H7 (`QuorumEnforcer.sol` checks `keccak256(args) == decoded_payload_hash`). R6.9 aggregator confirms 95.5% lines / 100% branches.

### 3.3 Pause invariant for enforcers (R6.7)

All five enforcer `beforeHook` / `afterHook` functions are `external view` AND read no storage. Pause is not applicable because there is no state to mutate. The invariant is documented in source and **test-locked**: `test/EnforcerPauseInvariantR67.t.sol::SideEffectfulEnforcer` mock proves any future enforcer that writes state would fail the test.

### 3.4 Pause matrix (R6.5 / R6.6 / R6.8)

Pause is system-wide via `AgenticGovernance.setPaused(bool)`. Each consumer reads the flag via a fail-soft staticcall (governance == EOA / non-conforming contract → treated as "not paused" — legacy/test compat) per `_pausedSafe()` in `GovernanceManaged.sol:69-74`.

| Contract | Guarded paths | Unguarded (intentional) | Closure |
|---|---|---|---|
| `AgentAccount` | execute, executeBatch, executeFromModule, installModule, executePendingUpgrade, addCustodian | uninstallModule, cancelPendingUpgrade, removeCustodian (recovery primitives) | R6.5 |
| `CustodyPolicy` | scheduleCustodyChange, applyCustodyChange | cancelScheduledChange (allow recovery cancel during incident), onUninstall (operator escape) | R6.6 |
| `AgentNameRegistry` | register, backfillLabel, setOwner, setResolver, setSubregistry, renew, setPrimaryName (7 functions) | initializeRoot (deployer init, runs ONCE per TLD anyway) | R6.8 |
| `PermissionlessSubregistry` | (no own guard — inherits via inner `REGISTRY.register` call) | — | Transitive R6.8 coverage; proven by `test_R6_8_subregistryRegister_pausedRevertsTransitively` |
| `SmartAgentPaymaster` | `_validatePaymasterUserOp` (early reverts on governance.isPaused()) | — | H7-C.10 / EXT3-010 |

### 3.5 `custody/CustodyPolicy.sol`

- **One ERC-7579 module per AgentAccount,** factory-immutable per spec 213 § 2.4. Per-account install via `onInstall(initData)` with ABI: `(uint8 mode, uint8 recoveryApprovals, address[] trustees, uint8[7] thresholds, uint32[7] timelocks, uint256 t3Ceiling, address approvedHashReg)`.
- **16 CustodyAction enum cases** (per § `_applyCustodyChange` dispatcher). Coverage by branch family in R6.10b + R6.10c — final state: **81.4% lines / 53% branches** (R6.10b) → after R6.10c **92.4% lines / 68% branches**.
- **Audit C-6..C-11 closures:** zero `credentialIdDigest` rejected, RotateAllCustodians wire shape add+remove, CustodyPolicy reinstall permanently forbidden, etc. See `test/CustodyPolicyWave2C.t.sol`.
- **Pause coverage (R6.6):** `scheduleCustodyChange` + `applyCustodyChange` guarded with `whenAccountNotPaused(account)`; `cancelScheduledChange` UNGUARDED intentionally (recovery cancel during incident).
- **Threshold defaults (spec § 5.1):** T4 default = max(N − 2, 1); T5 default = max(N − 1, 1); T6 default = `recoveryApprovals`. Factory derives `recoveryApprovals = trustees/2 + 1` if not overridden.

### 3.6 `SmartAgentPaymaster.sol` — economics + paymaster modes

**Three validation modes:**

| Mode | Constructor wiring | Sponsor behavior | Use case |
|---|---|---|---|
| **Dev** | `devMode_=true` | Accept every userOp (no sig check) | Testnet only — Deploy.s.sol auto-flips devMode=true via `_isTestnetNetwork()` |
| **Allowlist** | `devMode_=false`, `verifyingSigner_=address(0)` | Only senders in `_acceptList` are sponsored | Allowlist mode — fail-closed (every userOp reverts `SenderNotAccepted` until `setAccepted` runs) |
| **Verifying** | `devMode_=false`, `verifyingSigner_=<EOA>` | EOA signs over `getHash(userOp, validUntil, validAfter)` off-chain | Production preferred — Pimlico / Stackup / Alchemy reference pattern |

**Hash binding (CON-PAYMASTER-004 / H7-C.7):**
```
keccak256(abi.encode(
  userOp.sender, userOp.nonce, keccak256(userOp.initCode), keccak256(userOp.callData),
  userOp.accountGasLimits, userOp.preVerificationGas, userOp.gasFees,
  block.chainid, address(this), address(entryPoint()),
  validUntil, validAfter
))
```
Binds `address(entryPoint())` so a long-lived signed envelope CANNOT survive an EntryPoint redeploy.

**Pause integration:** `_validatePaymasterUserOp` runs the governance.isPaused() staticcall FIRST. Pause flips paymaster to reject-all without operator intervention.

**Economics:**
- Stake: 0.0005 ETH at deploy (paid from deployer at constructor time via Deploy.s.sol).
- Deposit: 0.001 ETH at deploy.
- 1-day unstake delay (BasePaymaster default; cannot be reduced).
- Topup: operator endpoint `/paymaster/topup` (`apps/demo-a2a/src/index.ts:2329+`) — capped at 0.002 ETH per call (`TOPUP_MAX_WEI`) and gated below 0.005 ETH floor (`TOPUP_TARGET_FLOOR`). The signer is wrapped in `createSpendCappedAccount` so a `value > PAYMASTER_TOPUP_CAP_WEI` tx throws BEFORE the HSM round-trip even if the app-layer cap is bypassed (R5.12).

**Coverage (R6.10):** 98.2% lines / 100% branches; the full validation path is exercised via `vm.prank(address(ep))` calls in `test/SmartAgentPaymasterValidateR610.t.sol` (20 tests).

### 3.7 `UniversalSignatureValidator.sol` — single signature entrypoint

Per spec 214 SB-4. **One library function consumers call (`validateSig(signer, hash, sig)`)** that internally:

1. If `sig` looks like ERC-6492 (`0x6492...` magic suffix): execute the prefix calldata at the magic-named factory, then re-evaluate.
2. If `signer` has code: call `signer.isValidSignature(hash, sig)` (ERC-1271) and check magic value.
3. Otherwise: ECDSA `ecrecover` against `signer`.

**The signer-agnostic property** — caller passes one address + one hash + one signature, regardless of whether the SA is deployed, undeployed-but-counterfactual, or an EOA. Consumers (demo-a2a SIWE verify, off-chain delegation verify) never branch on signer kind.

**Coverage (R6.9 aggregator):** 94.4% lines / 83.3% branches.

### 3.8 `naming/*`

- **Multi-root registry.** `.agent` (deployed via Deploy.s.sol) + `.impact` (added 2026-06-01 via `script/AddImpactTld.s.sol`). Each TLD has an immutable initializer set at construction — front-run-proof.
- **PermissionlessSubregistry per TLD** — one-name-per-caller, no whitelist. Backing the `<handle>.impact-agent.{me,io}` subdomain mapping.
- **`reverseResolveString` (spec/222)** is the canonical reverse path — NO `eth_getLogs` walker fallback (ADR-0012, ADR-0013).
- **Pause coverage (R6.8):** all mutating functions guarded; `initializeRoot` exempt because it runs ONCE per TLD ever.

### 3.9 `relationships/AgentRelationship.sol` — ⚠ Privacy Fork

EXT-019 status: **experimental** — public on-chain edges leak the social graph. Production deployments where membership / participation is sensitive should NOT register relationships on this contract; the package's `AUDIT.md` makes this explicit. A future spec covers an encrypted-edge variant.

## 4. Upgrade & governance — production posture

### 4.1 The production gate (open audit item N1)

**Current testnet state.** Deployer EOA `0x31ed17fb99e82E02085Ab4B3cbdaB05489098b44` is publicly disclosed (intentional — keeps the demo reproducible from a clean clone) and currently holds: governance role on AgenticGovernance; bundler signer + session issuer on AgentAccountFactory; initial owner + governance pointer on SmartAgentPaymaster.

**Why this is testnet-only.** Any holder of the disclosed key could rotate factory roles to a hostile address (factory `setBundlerSigner` is `onlyGovernance`), pause the paymaster, or withdraw paymaster stake after the 1-day unstake delay.

**Production runbook.** Before any production network deploy:

1. Generate a clean deployer key inside KMS (gcp-kms / aws-kms recommended). Never touches a developer's filesystem.
2. Deploy AgenticGovernance under a multisig owner. Suggested: 3-of-5 Safe with a 24h TimelockController.
3. Deploy contracts with `Deploy.s.sol`, passing the clean deployer address + the multisig.
4. The deploy script's `setBundlerSigner` / `setSessionIssuer` runs in the same broadcast — atomic.
5. After successful deploy, REVOKE the deployer key entirely (KMS scheduled destroy).
6. The preflight gate `scripts/check-production-deploy.ts:gateOnLeakedDeployerKey` refuses deploys when `.env.deploy.local` references the disclosed deployer EOA (with explicit `AGENTICPRIMITIVES_DEMO_KEYS_ACCEPTED=true` override for testnet runs).

### 4.2 Upgrade pattern

- AgentAccount: UUPSUpgradeable. `_authorizeUpgrade` gated by `onlySelf`. Per-account upgrades routed through `CustodyPolicy.ApplySystemUpdate` (T5 / 24h timelock by default).
- AgenticGovernance: NOT upgradeable. Operator deploys a new governance instance to migrate.
- AgentAccountFactory + SmartAgentPaymaster + DelegationManager + CustodyPolicy + naming/* + enforcers: NOT upgradeable. Redeploy + migrate-by-naming-handle. The 2026-06-01 R6 redeploy + `.impact` re-init demonstrates the runbook.

### 4.3 TimelockController

`Deploy.s.sol` deploys an OpenZeppelin TimelockController with a 24h minimum delay. Owner = the multisig deployed in step 4.1. Production governance flows queue → wait 24h → execute.

## 5. Test posture

**Forge:** 635 tests across 28 contracts (all pass, 2026-06-01).

**Coverage (R6.9 per-contract aggregator):**

| Category | Lines | Branches | Functions |
|---|---:|---:|---:|
| security-critical (11 contracts) | **90.3%** | **76.6%** | 93.4% |
| core (1) | 100% | 100% | 100% |
| naming-ontology (7) | 71.2% | 61.0% | 69.3% |
| identity (3) | 79.6% | 50.0% | 70.4% |
| governance (2) | 97.8% | 66.7% | 100% |
| library (4) | 77.7% | 79.5% | 100% |
| **Overall (28)** | **83.1%** | **70.6%** | 81.8% |

All 11 security-critical contracts ≥ 75% lines (the audit-floor). Branches: 10/11 ≥ 80%; CustodyPolicy at 68% is the remaining outlier (the `_applyChangeApprovalsRequired` tier-matrix edges — diminishing returns).

**SAST:** Slither runs on every PR (fail-on `high`); Aderyn runs as a second-opinion AI scanner (artifact-uploaded, non-blocking) — R6.3.

**Storage layouts:** `pnpm check:storage-layouts` snapshot-locks AgentAccount + CustodyPolicy + DelegationManager + SmartAgentPaymaster slot layouts (R1.3 / C6). Any drift fails CI explicitly.

**Symbolic verification (R9.3 + R9.3.x):** Halmos symbolic-execution proofs LIVE in `test/halmos/`. PR-blocking via the `halmos` job in `.github/workflows/security.yml`. Current proof set (7 proofs, terminate in 0.13s):

| Proof | Target | File |
|---|---|---|
| R8.2 UV-required gate | `WebAuthnLib.verify(..., requireUv = true)` rejects when UV bit unset, for ALL inputs | `WebAuthnLibUvR82.halmos.t.sol::check_R82_uvNotSet_with_requireUvTrue_alwaysRejects` |
| H7-C.1 UP-required gate | `WebAuthnLib.verify` rejects when UP bit unset, regardless of `requireUv` | `WebAuthnLibUvR82.halmos.t.sol::check_H7C1_upNotSet_alwaysRejects_regardlessOfRequireUv` |
| `setDelegationManager` onlySelf | External caller cannot rotate the delegation root of trust | `AgentAccountOnlySelf.halmos.t.sol::check_onlySelf_setDelegationManager_revertsForExternalCaller` |
| `removeCustodian` onlySelf | External caller cannot kick custodians | same file |
| `setUpgradeTimelock` onlySelf | External caller cannot disable the upgrade timelock | same file |
| `upgradeToAndCall` onlySelf (UUPS hook) | **Catastrophic if bypassable — Halmos proves it isn't.** External caller cannot swap the implementation | same file |
| `removePasskey` onlySelf | External caller cannot un-register a credential | same file |

Each proof: caller address symbolic, all args symbolic, only constraint is `caller != address(acct)`. Halmos explores every other input dimension.

**Foundry stateful invariants (R9.1 + R9.2):** in `test/invariant/`. 15 invariants × 25,600 calls each per CI run, PR-blocking.

| Suite | Invariants |
|---|---|
| `CustodyPolicy.invariant.t.sol` | thresholds nonzero • recoveryApprovals ≤ trusteeCount • mode ∈ {0..3} • changeCount monotonic • uninstalled views zero |
| `DelegationManager.invariant.t.sol` | revocation irreversible • hash deterministic • domain separator immutable • root/open constants unchanged • revoked-set monotonic |
| `SmartAgentPaymaster.invariant.t.sol` | devMode locked • governance immutable • verifyingSigner locked • arbitrary-sender not accepted • governance gate holds for fresh caller |

**Echidna nightly fuzz (R9.4):** `test/echidna/CustodyPolicyEchidna.t.sol` — 4 properties × 50,000 sequences × 4 parallel workers, runs nightly at 02:17 UTC via `.github/workflows/contracts-echidna-nightly.yml`. Artifact-only (`continue-on-error: true`); corpus uploaded as a 30-day-retained artifact. Smoke run: 1.3M calls / 4524 unique instructions / all 4 properties PASS in 26 seconds.

**Medusa weekend fuzz (R9.5):** `test/medusa/CustodyPolicyMedusa.t.sol` — 4 properties × 4-hour budget × 4 parallel workers, runs Saturday 03:17 UTC via `.github/workflows/contracts-medusa-weekend.yml`. Different EVM engine (go-ethereum vs Echidna's HEVM) — independent coverage graphs. Artifact-only; 60-day corpus retention.

**Stack mix rationale.** Each tool has a different blind spot:
- Foundry invariants — stateful random + seeded shrinking; PR-blocking; catches per-PR regressions.
- Halmos — symbolic execution; covers ALL paths but bounded; PR-blocking on narrow proofs.
- Echidna — stateful ABI-aware random + coverage-guided; nightly; catches multi-step sequence bugs Foundry's seed strategy doesn't explore.
- Medusa — different EVM + different coverage-guidance strategy; weekly; deep-corpus regression coverage.

A regression that slips one tool's coverage graph can still be caught by another.

## 6. Public API surface (audit scope)

All `*.sol` files under `src/` + the JSON ABIs published under `dist/abi/`. Consumers MUST import ABIs via the npm-published `@agenticprimitives/contracts/abi` subpath, NOT by reading `out/` directly.

The `dist/deployments/` subpath (R7.3) exposes per-network contract addresses to TypeScript consumers — a single source of truth replacing per-app hardcoded tables.

## 7. Known findings (cross-reference)

See [`docs/audits/2026-05-packages-contracts-production-readiness.md`](../../docs/audits/2026-05-packages-contracts-production-readiness.md) § 3 (Per-contract findings) + § 4 (Cross-cutting).

**Open at 2026-06-01:**

| Finding | Severity | Notes |
|---|---|---|
| N1 (system audit) | P0 | Leaked deployer key — testnet-only acceptance; production runbook in § 4.1 above |
| External Solidity audit | High (gate-level) | Cyfrin / CodeHawks contest planned; refer to R10 readiness doc P1.10 |
| CON-WEBAUTHN-AUTHDATA-len | Medium | Authenticator-data length check (open across H7) |
| EIP-712 cross-stack typehash equality | Medium | Test file LIVE (`packages/delegation/test/integration/cross-stack-typehashes.test.ts`) — 6 tests pass; wrapper command `pnpm check:eip712-typehash-equality` is part of the public self-audit validation ledger. |
| Kontrol / Certora formal verification | Medium | Halmos covers narrow proofs; Kontrol/Certora are R10 P2.2/P2.3 deferred to post-audit |
| Encrypted-edge AgentRelationship | Low | EXT-019; product decision pending |

**Closed since prior refresh (R9 wave, 2026-06-01):**

- Halmos symbolic verification — landed in R9.3 + R9.3.x (7 proofs)
- Foundry stateful invariants — landed in R9.1 + R9.2 (15 invariants)
- Echidna nightly + Medusa weekend — landed in R9.4 + R9.5
- Aderyn H-6 (`MAX_INITIAL_CUSTODIANS = 32`) — R9.6 cap with 6 regression tests
- Slither M-1 (PermissionlessSubregistry cross-function reentrancy) — false positive triaged + `slither-disable-next-line` annotated; full triage in [`docs/audits/r9-static-analysis-triage.md`](../../docs/audits/r9-static-analysis-triage.md)

**Closed in R6 (2026-06-01):**

- CON-SUBREGISTRY-003 (subregistry reentrancy guard) — R6.2
- CON-AgentAccount-005 (system-pause coverage) — R6.5
- CON-CustodyPolicy-005 (system-pause coverage) — R6.6
- CON-NAMING-005 (naming layer pause coverage) — R6.8
- CON-ENFORCER-PAUSE-001 (stateless validator invariant) — R6.7
- CON-SmartAgentPaymaster-001 (validation-path coverage 50.9% → 98.2%) — R6.10
- CON-CustodyPolicy-001 (branch coverage 30% → 68%) — R6.10b/c

## 8. Pre-publication checklist

- [x] License (MIT) + AUDIT.md (this file) + LICENSE + `publishConfig.access=public` — H7-A.2
- [x] Extracted as `@agenticprimitives/contracts` — H7-A.2 / EXT3-001
- [x] WebAuthn / P-256 / SignatureSlot / Naming hardening — H7-C.1..C.4
- [x] Coverage ≥ 75% lines on every security-critical contract — R6.10 (final security-critical floor cleared)
- [x] Storage-layout snapshots committed — H7-C.6
- [x] System-wide pause wired on critical paths — R6.5 / R6.6 / R6.8
- [x] Subregistry reentrancy guarded — R6.2
- [x] Stateless-enforcer invariant test-locked — R6.7
- [x] Cross-stack typehash test green — H7-D.9 / R11.4 closure; lives at `packages/delegation/test/integration/cross-stack-typehashes.test.ts` (6 tests pass) and runs through `pnpm check:eip712-typehash-equality`.
- [x] Halmos symbolic harness on top-3 invariants — R9.3 + R9.3.x landed (7 proofs, PR-blocking).
- [x] Echidna nightly stateful fuzzing — R9.4 (nightly schedule, artifact-only).
- [x] Medusa weekend coverage-guided fuzzing — R9.5 (weekly schedule, artifact-only).
- [x] H-6 / ATL-SEC-05 — initial custodians cap closed at construction — R9.6.
- [ ] Governance pattern: Safe + Timelock(24h); deployer EOA renounces — H7-C.9 / EXT3-009 (production-deploy item; runbook in § 4.1; R10 P1.1)
- [ ] On-chain governance-shape verifier script — R10 P1.2 (post-deploy gate that fails CI if `factory.governance() != multisig` etc.)
- [ ] Kontrol / Certora formal verification on top-3 invariants — R10 P2.2 / P2.3 (post-audit)
- [ ] One external Solidity audit firm engagement — Cyfrin / CodeHawks (planned)
- [x] Per-network deployments JSON committed — R7.3 (`deployments-base-sepolia.json` in tree)
- [x] Generated TS deployments module — R7.3 (`@agenticprimitives/contracts/deployments/<network>`)
- [x] ABI sync doctrine — R7.2 (`pnpm check:abi-sync` against Foundry truth)

## 9. Threat model summary

For the full threat model see [`docs/audits/threat-model.md`](../../docs/audits/threat-model.md). Quick reference for external reviewers:

| Adversary | Capability | Mitigation |
|---|---|---|
| **Hostile bundler** | Submits crafted userOps to drain paymaster | Verifying-paymaster mode (preferred prod) — paymaster signs each envelope; OR allowlist mode — fail-closed |
| **Leaked credential** | Owns a passkey / EOA on a multi-custody SA | CustodyPolicy quorum + 24h timelock + trustee recovery; ADR-0011 — credential rotation preserves SA address |
| **Front-runner** | Watches mempool for the deployer's first `initializeRoot` tx | Immutable `initializer` set at construction; deploy script runs both in the SAME tx (R6.8 / H7-C.4) |
| **Cross-EntryPoint replay** | Reuses a paymaster envelope against a redeployed EntryPoint | `getHash` binds `address(entryPoint())` — H7-C.7 / CON-PAYMASTER-004 |
| **Caveat author** | Picks `args` to slip a redeem through a delegator's signature | Caveat typehash EXCLUDES `args` — audit F-1 closure |
| **Reentrant subregistry caller** | Mock registry re-enters during inner `register` call | `nonReentrant` on `PermissionlessSubregistry.register` — R6.2 |
| **Governance pause bypass** | Calls during incident | `whenNotPaused` modifier on all write surfaces; recovery primitives explicitly exempt |
| **WebAuthn rp-id swap** | Registers passkey for one origin, signs for another | `_setupInitialPasskey` rejects zero `rpIdHash`; per-credential rpIdHash stored + checked at verify time |

## 10. Audit engagement targets

External engagements considered:

- **Cyfrin** — full-engagement contract audit; AgentAccount + AgentAccountFactory + CustodyPolicy + DelegationManager + SmartAgentPaymaster + 5 enforcers.
- **CodeHawks contest** — broader-surface contest including the naming layer + UniversalSignatureValidator.
- **Spearbit** — alternative full-engagement (research-grade review).
- **OpenZeppelin** — alternative full-engagement (large-firm review).

Pre-engagement deliverables: this file + threat model + architecture diagram + evidence checklist + spec 214 (already in `docs/audits/` + `specs/`). Pre-engagement code freeze: master branch with R6 wave landed + the R7 audit-driven hardening (R7.2 / R7.3 / R7.4 / R7.5) closed.

---

**Reviewer feedback** welcome — please file findings at https://github.com/agentictrustlabs/agenticprimitives/issues with the `audit-finding` label, OR encrypt and email to security@agentictrustlabs.com (PGP key in [`docs/audits/evidence-checklist.md`](../../docs/audits/evidence-checklist.md) § PGP).
