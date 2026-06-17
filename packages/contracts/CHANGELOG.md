# @agenticprimitives/contracts

## 1.0.0-alpha.10

## 1.0.0-alpha.9

### Minor Changes

- f51a547: Payment stack — full general-purpose capability (spec 243 §5.5).
  - **payments**: the W1.5 rails + primitives beyond x402 — `wallet` / `invoice` / `escrow` /
    `recurring` rails; EIP-712 signed `PaymentMandate` (`buildClosedMandate`, `mandate-sign`
    with ERC-1271 verify); immutable `PaymentReceipt` VC (`buildPaymentReceiptCredential`,
    `contextBindingHash` linking order ↔ fulfilment ↔ settlement); `entitlement` (pay-after-
    fulfilment + credits) and VOPRF blind `voucher` pack; `refund` / `split` / `transfer` /
    `ops` (idempotent event log + reconciliation + export).
  - **contracts**: `PaymentEscrow.sol` — hold / capture(release) / refund / reclaim with
    payee-consented refund + expiry reclaim (FG-PAY-7), deploy script + 19 unit tests.

## 1.0.0-alpha.8

### Minor Changes

- fa345d7: x402 pay-per-use (spec 272/273/274).
  - **contracts**: `PaymentEnforcer` (fused stateful caveat — treasury-scoped, per-charge + session caps, frequency window, one-shot nonce, transfer-only), `PaymentReceiptRegistry`, `MockUSDC` (EIP-3009). Deployed on Base Sepolia.
  - **delegation**: `buildPaymentMandateCaveats` / `encodePaymentTerms` / `describePaymentMandate`; real on-chain `isRevoked` + `buildRevokeDelegationCall`; `EnforcerAddressMap.payment`. **Fix:** `ROOT_AUTHORITY` corrected to the contract sentinel `0xff…ff` (was `0x00…00`) — every `DelegationClient` root delegation now passes the on-chain authority check, so `redeemDelegation` works.
  - **payments**: the x402 rail — `x402.buildRedemptionCalldata`, `computeNullifier`, `verifyMandate`, `createX402Rail`, v2 wire (PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE), resource canonicalization + nonce store.
  - **a2a**: payment-gated skills (`gateSkillPayment`, `x402AgentCardExtension`).
  - **agent-account**: `buildErc20TransferCall` + `readErc20Balance`.

## 1.0.0-alpha.7

### Patch Changes

- 439eac9: CA-1 — AgentAccount upgrade timelock is now enforced (2026-06-10 audit).

  The per-account upgrade timelock was dead code (set via `setUpgradeTimelock` but
  never consulted — `_authorizeUpgrade` was an empty `onlySelf` and the only
  `_pendingUpgrade` writer reverted), so a direct `upgradeToAndCall` fired
  immediately. Now:
  - `scheduleUpgrade(newImpl)` (onlySelf) is the production queue writer; the
    matured upgrade is applied via `executePendingUpgrade`.
  - `_authorizeUpgrade` reverts `DirectUpgradeBlocked` when a timelock is set and
    the call is not an authorized context.
  - **Simple-path only:** a transient `_upgradeAuthorizedCtx` exempts the
    custody-module path (`CustodyPolicy.ApplySystemUpdate`, which has its own T5
    quorum + timelock) so there is no double delay.

  AgentAccount bytecode changed → batches into the pending Base Sepolia redeploy.

- a04a0e4: 2026-06-10 audit batch — CP-1/CP-2 (custody), PM-1/PM-2 (paymaster), NEW-MCP-1 (JTI).

  Contract + package fixes from the post-NO-GO hardening program. The
  `@agenticprimitives/contracts` ABIs move (CustodyPolicy + SmartAgentPaymaster
  bytecode changed) — a Base Sepolia redeploy is required to make these enforced
  on-chain.
  - **CP-1 (Medium)** — `CustodyPolicy.onInstall` now floors unset tiers from the
    spec default-approvals matrix and HARD-REVERTS `UnconfiguredTier(4/5)` for any
    non-single install with the admin/critical tiers unset, so a direct install
    bypassing the factory can't collapse a high tier to 1-of-n. `_approvalsValue`
    fails closed on a T6 read (recovery quorum lives in `recoveryApprovals`).
  - **CP-2 (Medium)** — `onInstall` rejects `recoveryApprovals > trusteeCount`
    (an unsatisfiable threshold that would brick the T6 recovery lifeline).
  - **PM-1 (Medium)** — `SmartAgentPaymaster._validatePaymasterUserOp` no longer
    reads external governance storage (an ERC-7562 validation-scope violation that
    got sponsored ops dropped by bundlers). It reads an own-storage `_pausedMirror`,
    refreshed out-of-band by `syncPauseFromGovernance()` / `setPauseMirror`.
  - **PM-2 (Medium)** — adds a governance-only, 48h-TIMELOCKED deposit-withdrawal
    path (`scheduleDepositWithdrawal` / `executeDepositWithdrawal` /
    `cancelDepositWithdrawal`); the owner→governance handoff for the inherited
    instant `withdrawTo` is documented in the contract's production checklist.
  - **NEW-MCP-1 (High)** — **breaking:** `createMemoryJtiStore`'s `environment` is
    now a REQUIRED field, never inferred. The prior `NODE_ENV` fallback resolved to
    `'development'` on Workers/SES (where `process.env` is absent) and silently
    skipped the production refusal, shipping non-durable replay protection. Callers
    must pass `{ environment: 'production' | 'development' }`.

- 50690a8: EN-11 — QuorumEnforcer fail-closed on a degenerate quorum (2026-06-10 audit).

  `QuorumEnforcer.beforeHook` now reverts `InvalidThreshold` when `threshold == 0`
  (which skipped the verification loop and made the signature-count guard
  unreachable → a quorum caveat passed with ZERO signatures) or when `threshold`
  exceeds the signer set. Bytecode changed → batches into the pending Base Sepolia
  redeploy.

- d0a4436: GOV-1 — guardian role is timelock-rotatable (2026-06-10 audit).

  `AgenticGovernance.guardian` moved from `immutable` to a storage var the timelock
  can rotate via `setGuardian` (onlyTimelock, non-zero). A compromised guardian
  that perpetually re-pauses the system can now be replaced after one timelock
  window WITHOUT a governance redeploy — the DoS is bounded, not permanent.
  Bytecode changed → batches into the pending Base Sepolia redeploy.

- ddbf7d6: WA-1 / WA-2 — WebAuthn custody-signature hardening (2026-06-10 audit).

  `WebAuthnLib` + `SignatureSlotRecovery` bytecode changed → a Base Sepolia
  redeploy is required for on-chain enforcement.
  - **WA-1 (Medium)** — `WebAuthnLib.verify` now enforces low-s (`s ≤ n/2`,
    `P256_N_DIV_2`) before the RIP-7212 call. RIP-7212 accepts both `(r, s)` and
    `(r, n−s)`, so without this a second valid signature always existed over the
    same message (P-256 malleability). The bound covers every caller from the one
    library chokepoint.
  - **WA-2 (Medium)** — the custody-COUNCIL quorum passkey path
    (`SignatureSlotRecovery`) now requires User-Verification (`requireUv=true`),
    consistent with the native ERC-1271 path (AgentAccount, R8.2). A UP-only
    custody assertion is rejected; custody signers must use
    `userVerification:'required'`.

- ba49084: 2026-06-10 audit hardening wave + Base Sepolia redeploy.

  Contract/package security fixes from the post-NO-GO hardening program (the
  `@agenticprimitives/contracts` ABIs + the `deployments-base-sepolia.json`
  addresses move because **every contract was redeployed** — the new factory is
  `0x3E68B72B45e7C9d35B210E4Ab06e5Cece85cEbE4`):
  - **CA-F1 (High)** — `AgentAccountFactory` CREATE2 salt now commits to the full
    custody config (mode/trustees/timelockOverrides) so the counterfactual address
    can't be front-run with attacker-controlled recovery (ADR-0035).
    `getAddressForAgentAccount` gains a `timelockOverrides` param; the
    `@agenticprimitives/agent-account` client threads it.
  - **ATT-1 / ATT-3 / AGR-1** — registry issuer + joint-consent + transition digests
    now bind a full typed payload + `chainId` + `address(this)`.
  - **AN-1-ONCHAIN** — on-chain canonical label charset in `AgentNameRegistry`.
  - **SIG-1** — registries use malleability-safe OZ `ECDSA.tryRecover` (low-s).
  - **DM danger** — `verifyAuthorization` marked ⚠️ chain-only in NatSpec + the SDK.
  - **DEL-001 (P0-1, Critical)** — the session-key↔delegator binding in
    `@agenticprimitives/delegation` is now **fail-closed by default** (ADR-0036):
    `verifyDelegationToken` rejects any token lacking a valid `sessionDelegation` leaf
    unless the caller passes the explicit, greppable `allowUnboundSessionToken: true`
    opt-out. `@agenticprimitives/mcp-runtime` threads the same opt-out through
    `McpResourceVerifyConfig`. **Breaking:** the prior opt-in flags
    (`requireSessionDelegateBinding`, `strictSessionBinding`) are removed — callers that
    minted unbound tokens must set `allowUnboundSessionToken: true` or they fail closed.

  `@agenticprimitives/verifiable-credentials` + the first publish of
  `@agenticprimitives/a2a` (async delegation-authorized task transport) are bumped to
  catch the registry up to `master`.

## 1.0.0-alpha.6

### Patch Changes

- 21f2e4c: R12 — restore `forge coverage`. `forge coverage --ir-minimum` instruments every contract with viaIR at minimum optimization, and the new `SkillDefinitionRegistry`/`GeoFeatureRegistry` `publish` functions' in-memory struct literal (+ a dynamic `string`) overflowed solc's stack by one slot, producing zero coverage rows. Split the record write + event emit into a field-by-field `_storeAndEmit` helper so `publish`'s frame stays shallow — behaviour, ABI, and storage layout are identical. Added geo revert-branch tests (branch coverage 27% → 100%); the `check:forge-coverage` gate is strict again.

## 1.0.0-alpha.5

### Minor Changes

- 41967b6: R6.5 / CON-AgentAccount-005 — Wire system-pause checks into
  `AgentAccount.sol` (HEADLINE).

  ### Why

  R6.1 recon (`docs/audits/r6-contracts-recon-2026-05-31.md` § 2.2)
  identified that `AgentAccount.sol` had **ZERO pause checks across
  13 mutating external functions**. When governance paused the system,
  every deployed account continued operating normally — funds kept
  moving, modules kept installing, upgrades kept landing. R5.7 made
  the paymaster refuse to sponsor gas, but the account itself never
  refused.

  **Largest defensive gap in the codebase for an engagement platform.**

  ### Changes

  **New error:** `SystemPaused`.

  **New modifier:** `whenNotPaused` — reverts when
  `AgenticGovernance.isPaused() == true`.

  **New helper:** `_systemPaused()` — chains `staticcall(_factory)
→ factory.governance()` then `staticcall(governance) → isPaused()`.
  Any non-conforming hop returns `false` for legacy compatibility
  (mirrors `GovernanceManaged._pausedSafe()`).

  **New interface methods:**
  - `IAgentAccountFactoryView.governance()` — read the factory's
    governance pointer
  - `IAgentAccountPauseView.isPaused()` — read the pause flag

  ### Modifier applied to 6 mutating entrypoints

  | Function                | Reasoning                           |
  | ----------------------- | ----------------------------------- |
  | `execute`               | Asset movement                      |
  | `executeBatch`          | Asset movement                      |
  | `executeFromModule`     | Module-driven asset action          |
  | `installModule`         | Adds attack surface                 |
  | `executePendingUpgrade` | Could land malicious queued upgrade |
  | `addCustodian`          | Grants authority                    |

  ### 3 RECOVERY primitives deliberately left UNGUARDED

  | Function               | Reasoning                          |
  | ---------------------- | ---------------------------------- |
  | `uninstallModule`      | Removing attack surface = recovery |
  | `cancelPendingUpgrade` | Cancelling = recovery              |
  | `removeCustodian`      | Revoking authority = recovery      |

  ### 3 `onlySelf` ceremonies also unguarded

  `setUpgradeTimelock`, `setDelegationManager`,
  `acceptSessionDelegation` — already gated by the owner's signature
  (self-recovery shape).

  ### `executeFromBundler` is `view`

  Validation-only, not state-mutating. The EntryPoint then calls
  `execute` which IS paused.

  ### Tests

  14 new R6.5 regression tests in `test/AgentAccountPauseR65.t.sol`:
  - 6 paused-reverts (one per guarded fn)
  - 3 recovery-still-works-when-paused
  - 3 ceremony-still-works-when-paused
  - 1 unpaused-doesn't-revert-with-SystemPaused
  - 1 legacy-EOA-governance-never-pauses

  ✅ 14/14 R6.5 tests pass.
  ✅ 558/559 full contracts suite (only failure: pre-existing R5.9
  env-var-bleed in `DeployAuthorityResolution.t.sol`, unrelated).

  ### Audit doc

  `CON-AgentAccount-005` new row, R6.5 closure.

- 8285ab2: R6.8 / CON-NAMING-005 — wire system-pause checks into the naming
  layer (`AgentNameRegistry` + `PermissionlessSubregistry`).

  ### Why

  R6.1 recon § 2.5 identified that the naming layer had ZERO pause
  checks. Names could be registered, owned, renewed, primaries set,
  subregistry authority granted during a system pause. Less catastrophic
  than `AgentAccount` (no funds at risk), but a paused system shouldn't
  be writing new state.

  Closes pause coverage to 100% across the protocol surface.

  ### Fix

  **`AgentNameRegistry` now inherits `GovernanceManaged`.** Constructor
  signature is now `(address initializer_, address governance_)`.
  Breaking; `Deploy.s.sol` and 4 test files updated.

  ### Modifier applied to 7 mutating entrypoints

  `register`, `backfillLabel`, `setOwner`, `setResolver`,
  `setSubregistry`, `renew`, `setPrimaryName`.

  ### `initializeRoot` deliberately unguarded

  One-shot bootstrap callable only by the immutable initializer in the
  same deploy tx — pause is a runtime concern, not a deploy-time
  concern. Locking it would brick fresh deploys whenever the system
  happens to be paused at deploy time, which is the wrong default.

  ### `PermissionlessSubregistry` inherits pause coverage TRANSITIVELY

  Its `register()` calls `REGISTRY.register(...)` which fires
  `whenNotPaused`. The revert propagates back through the outer call.
  Proven by `test_R6_8_subregistryRegister_pausedRevertsTransitively`.
  No separate modifier or constructor change needed on the subregistry.

  ### Tests

  12 new R6.8 regression tests in
  `test/naming/AgentNameRegistryPauseR68.t.sol`:
  - 7 paused-reverts (one per guarded fn)
  - 1 unpaused-succeeds sanity check
  - 1 initializeRoot-still-works-when-paused (deliberately unguarded)
  - 1 subregistry-pause-propagates-transitively
  - 1 legacy-EOA-governance-never-pauses
  - 1 ZeroGovernance-constructor-reverts

  ✅ 12/12 R6.8 tests pass.
  ✅ 555-556/557 full suite (only failure: pre-existing R5.9 env-bleed
  in `DeployAuthorityResolution.t.sol`, unrelated).

  ### Deploy script + test files updated
  - `Deploy.s.sol` line 310: passes `address(governance)` as the
    second constructor arg
  - 4 test files updated to `new AgentNameRegistry(deployer, deployer)`
    (EOA-governance fallback = "not paused" per
    `GovernanceManaged._pausedSafe()`)

  ### Audit doc

  `CON-NAMING-005` new row, R6.8 closure.

- 2949c6a: R8.2 — close ATL-SEC-03: UV is now runtime-enforced on every WebAuthn
  assertion at the contract layer.

### Patch Changes

- 879397a: R6.10 — SmartAgentPaymaster validation-path coverage push.

  Adds `test/SmartAgentPaymasterValidateR610.t.sol` (20 tests) that
  exercise `_validatePaymasterUserOp` via real `validatePaymasterUserOp`
  calls (using `vm.prank(address(ep))` to satisfy
  BasePaymaster's `_requireFromEntryPoint` gate).

  R6.9 surfaced SmartAgentPaymaster at 50.9% lines / 22.2% branches —
  below the 70% security-critical floor. The pre-existing tests
  asserted off-chain hash recovery sanity but never exercised the
  validation body's branches.

  Coverage after R6.10:
  - SmartAgentPaymaster lines: 50.9% → **98.2%** (+47.3pp)
  - SmartAgentPaymaster branches: 22.2% → **100%** (+77.8pp)
  - security-critical rollup: 82.1% → 85.1% lines, 57.4% → 63.2% branches
  - Overall: 79.0% → 80.5% lines, 60.2% → 63.3% branches

  Branches now exercised: dev-mode short-circuit (× 2), pause revert
  - recovery + EOA-governance skip, verifying-mode happy-path
    validationData packing, malformed-length revert (× 2), wrong-signer
    revert, zero-sig + garbage-sig recover-error revert, allowlist
    accept + reject + revoke, EntryPoint gate, EntryPoint-binding +
    chainId binding in `getHash`, `_postOp` no-op, validUntil=0 and
    validUntil=max bit-packing round-trip.

  No source changes.

- 549309d: R6.10b — CustodyPolicy branch-coverage push.

  Closes R6.9's secondary security-critical gap: CustodyPolicy at
  30.0% branches. Adds `test/CustodyPolicyBranchR610b.t.sol` — 32 tests
  exercising the schedule/apply/cancel error branches, view-revert
  InvalidTier paths, effective-tier early-return branches, the rarer
  action dispatcher cases (RotatePaymaster/RotateSessionIssuer stubs,
  ChangeValueCeiling, SetRecoveryApprovals), and the handler error
  branches (ZeroAddress, TrusteeAlreadyExists, CannotDowngradeWithTrustees,
  InvalidMode, EmptyOwnerSet, InvalidThresholdValue).

  Coverage after R6.10b:
  - CustodyPolicy lines: 70.1% → **81.4%** (+11.3pp)
  - CustodyPolicy branches: 30.0% → **53.0%** (+23.0pp)
  - CustodyPolicy functions: 83.3% → **92.9%** (+9.6pp)
  - security-critical rollup branches: 57.4% → **70.1%** (+12.7pp)
  - Overall: 79.0% → 81.1% lines · 60.2% → 67.1% branches

  No source changes.

- 723ff69: R6.10c — CustodyPolicy action-dispatcher happy paths + remaining
  branch families.

  Builds on R6.10b. Adds `test/CustodyPolicyDispatcherR610c.t.sol` —
  18 tests covering the previously-untested dispatcher actions
  (RemoveCustodian, AddPasskeyCredential, RemovePasskeyCredential,
  RemoveTrustee, RotateAllCustodians × 4 variants, ApplySystemUpdate,
  RotateDelegationManager), the `_verifyQuorum` `UnauthorizedTrustee`
  branch, the recovery cancel-window in-vs-out-of-window logic, and
  the `_applyRemoveGuardian` `RecoveryRequiresGuardians` /
  `TrusteeDoesNotExist` paths.

  Coverage after R6.10b + R6.10c combined:
  - CustodyPolicy lines: 70.1% → **92.4%** (+22.3pp)
  - CustodyPolicy branches: 30.0% → **68.0%** (+38.0pp)
  - CustodyPolicy functions: 83.3% → 95.2% (+11.9pp)
  - security-critical rollup lines: 82.1% → 90.3%
  - security-critical rollup branches: 57.4% → **76.6%** (+19.2pp)
  - Overall: 79.0% → 83.1% lines · 60.2% → 70.6% branches

  No source changes.

- 705bb39: R6.2 / CON-SUBREGISTRY-003 — `PermissionlessSubregistry` reentrancy
  guard.

  ### Why

  Slither flagged `register()` for `reentrancy-no-eth`: the prior-claim
  check (`claimedBy[msg.sender] != 0`) was followed by the external
  call to `REGISTRY.register(...)` BEFORE the state write
  `claimedBy[msg.sender] = childNode`. If the registry (or any resolver
  it invokes) re-enters `register()`, the second call passes the
  guard because the write hasn't happened yet — letting one caller
  claim two names.

  Identified by R6.1 contracts hardening recon
  (`docs/audits/r6-contracts-recon-2026-05-31.md` § 1.1 / § 4.1).

  ### Fix

  `PermissionlessSubregistry` now inherits from OpenZeppelin's
  `ReentrancyGuard`. `register()` carries the `nonReentrant` modifier.

  ### Tests
  - New `test_R6_2_reentrancyGuardBlocksNestedRegister` — uses a
    `MaliciousRegistry` mock whose `receive()` re-enters the
    subregistry. Reentry is blocked.
  - New `test_R6_2_sequentialCallsFromDifferentSendersStillWork` —
    confirms the modifier resets between calls.
  - 13/13 PermissionlessSubregistry tests pass.
  - 547/547 contracts suite green (+2 R6.2 tests).

  ### Audit doc

  `CON-SUBREGISTRY-003` marked CLOSED.

  ### First implementation PR of the R6 wave

  The R6.1 recon doc (`docs/audits/r6-contracts-recon-2026-05-31.md`)
  identifies the full wave plan. R6.2 is the small Slither finding.
  The headline R6 PR is **R6.5** — wire pause checks into
  `AgentAccount` (currently 0 pause checks across 13 mutating
  entrypoints).

- 3797f0b: R6.3 — Slither inline suppress comments + Aderyn CI integration.

  ### Why

  R6.1 recon § 1.2 + § 1.4 triaged 9 Slither warnings as intentional
  patterns / false positives:
  - 7× `unused-return` on `ECDSA.tryRecover` (third return value
    `sigVersion` discarded by design — the `err` discriminant + the
    explicit `recovered == expected` comparison IS the auth)
  - 2× `incorrect-equality` on `registeredAt == 0` /
    `createdAt == 0` (sentinel storage-default checks; not numeric
    precision concerns)

  Each was correct behaviour but the noise made it harder to spot a
  real future regression. R6.3 documents them inline.

  ### Slither suppress comments

  7 ECDSA `tryRecover` sites annotated with
  `// slither-disable-next-line unused-return` + 1-line R6.3
  justification:
  - `packages/contracts/src/AgentAccount.sol` (4 sites:
    `_verifyEcdsa` ×2, `_verifySignerEcdsa` ×2)
  - `packages/contracts/src/UniversalSignatureValidator.sol`
    (`_ecdsaRecover` ×2)
  - `packages/contracts/src/SmartAgentPaymaster.sol`
    (`_validatePaymasterUserOp` ×1)

  Sentinel-equality annotations:
  - `packages/contracts/src/naming/AgentNameRegistry.sol`
    (`setPrimaryName`): inline `// slither-disable-next-line incorrect-equality`
  - `packages/contracts/src/relationships/AgentRelationship.sol`
    (7 occurrences of `e.createdAt == 0`): contract-scope
    `slither-disable-start incorrect-equality` /
    `slither-disable-end` wrapper with a clear comment block
    explaining the sentinel idiom.

  ### Aderyn CI integration

  New `aderyn` job in `.github/workflows/security.yml` runs alongside
  the existing `slither` job. Aderyn (Cyfrin's AI-first Solidity
  scanner) catches a different rule pack — combining both gives
  broader coverage of the Solidity surface.
  - Installed from the upstream release tarball (no third-party
    action; supply-chain surface stays small).
  - Non-blocking by design (`continue-on-error: true`) — Aderyn's
    detector pack is still evolving and a noisy report shouldn't
    block PRs while the triage policy stabilises.
  - Report uploaded as a CI artifact (`aderyn-report.md`).
  - Once the false-positive rate is known we flip to `fail-on: high`.

  ### Tests

  No functional changes — comments only. 544/545 full suite green
  (only failure: pre-existing R5.9 env-bleed in
  `DeployAuthorityResolution.t.sol`).

  ### Audit doc

  Updated the "Missing — CodeQL for Solidity" CI-posture row to
  PARTIAL CLOSED: two independent Solidity SAST scanners
  (Slither + Aderyn) now run in CI.

  ### Closes
  - All 22 Slither alerts triaged (1 closed by R6.2 reentrancy fix; 9
    by R6.3 suppress comments; 12 false-positive `uninitialized-local`
    remain documented for R6.4 cleanup).
  - CON-CI-001 (architectural intent: multiple Solidity SAST) —
    partial.

- 48dacb1: R6.6 / CON-CustodyPolicy-005 — wire system-pause checks into
  `CustodyPolicy.sol`.

  ### Why

  R6.1 recon § 2.3 identified that `CustodyPolicy` had ZERO pause
  checks across the schedule/apply/cancel surface. When governance
  paused the system, an attacker holding quorum sigs could still
  schedule + apply custody changes. Pause was supposed to be the
  emergency switch — it didn't switch off the custody machinery.

  Follow-up to R6.5's `AgentAccount` pause wire-up.

  ### Fix

  **New `whenAccountNotPaused(address account)` modifier** + new
  `_systemPausedFor(account)` helper. Helper chains 3 staticcalls:
  `account.factory() → factory.governance() → governance.isPaused()`.

  Any non-conforming hop returns `false` for legacy / test compatibility
  (mirrors R6.5 + `GovernanceManaged._pausedSafe()`).

  ### Modifier applied to 2 mutating entrypoints

  | Function                | Reasoning                       |
  | ----------------------- | ------------------------------- |
  | `scheduleCustodyChange` | Schedules an authority transfer |
  | `applyCustodyChange`    | Executes the authority transfer |

  ### 2 RECOVERY primitives left UNGUARDED

  | Function                | Reasoning                              |
  | ----------------------- | -------------------------------------- |
  | `cancelScheduledChange` | Defensive cancellation = recovery      |
  | `onUninstall`           | Removing the custody module = recovery |

  `onInstall` is gated upstream by R6.5's paused `installModule` on
  `AgentAccount` and the factory's paused `createAgentAccount` —
  no per-call modifier needed.

  ### New interfaces (local-scoped)
  - `IAgentAccountFactoryAccessor.factory()` — read factory from account
  - `ICustodyPolicyFactoryView.governance()` — read governance from factory
  - `ICustodyPolicyPauseView.isPaused()` — read pause flag

  ### Tests

  8 new R6.6 tests in `test/CustodyPolicyPauseR66.t.sol`:
  - 2 paused-reverts (schedule, apply)
  - 2 unpaused-doesn't-revert-with-SystemPaused (sanity)
  - 2 recovery-still-works-when-paused (cancel, uninstall)
  - 2 legacy-EOA-{account,governance}-never-pauses

  Uses 3 minimal mock contracts to exercise the staticcall chain
  without setting up a full quorum-sig ceremony.

  ✅ 8/8 R6.6 tests pass.
  ✅ 552/553 full suite (only failure: pre-existing R5.9 env-bleed
  in `DeployAuthorityResolution.t.sol`).

  ### Audit doc

  `CON-CustodyPolicy-005` new row, R6.6 closure.

- 1e2e9b0: R6.7 / CON-ENFORCER-PAUSE-001 — Enforcer pause-invariant audit.

  ### Audit conclusion

  **Enforcer pause checks are unnecessary.** The R6.1 recon § 2.4
  raised an open question: are enforcer `beforeHook` / `afterHook`
  reachable outside paused `DelegationManager.redeemDelegation`?

  R6.7 verifies the architectural invariant:
  1. All 5 production enforcer hooks are declared `external pure` or
     `external view`. Solidity prevents state mutation at the compiler
     level.
  2. Every enforcer has **zero storage variables** (manually verified
     — the only `address prev` in `QuorumEnforcer` is a LOCAL variable
     inside a for-loop, not storage).
  3. `DelegationManager.redeemDelegation` checks
     `governance.isPaused()` at the top of the function (lines
     149-154) BEFORE the for-loops that dispatch `beforeHook` (line 287) / `afterHook` (line 308). When paused, the DM reverts
     `SystemPaused` BEFORE any enforcer is touched.
  4. A caller invoking an enforcer hook directly during a pause sees
     the same revert/no-revert behaviour as any other time —
     nothing to drain, no state to corrupt.

  ### Changes

  **Documentation only — no functional changes to enforcer behaviour.**

  Each enforcer (`ValueEnforcer`, `AllowedTargetsEnforcer`,
  `AllowedMethodsEnforcer`, `TimestampEnforcer`, `QuorumEnforcer`)
  now carries an `R6.7 — Stateless validator` docstring referencing
  the recon doc + the regression test.

  ### Tests

  4 new R6.7 tests in `test/EnforcerPauseInvariantR67.t.sol` lock
  the invariant:
  - `test_R6_7_DM_paused_revertsBeforeReachingEnforcer` — uses a
    `SideEffectfulEnforcer` mock with a `callCount`; counter stays at
    0 after a paused redeem call confirms the DM gate fires first.
  - `test_R6_7_DM_unpaused_doesReachEnforcer` — sanity-checks the
    inverse: when unpaused, the DM does NOT short-circuit with
    `SystemPaused`.
  - `test_R6_7_directEnforcerCall_isStatelessForValueEnforcer` —
    proves repeated direct calls to `ValueEnforcer.beforeHook` are
    pure-functional (identical input → identical revert/no-revert).
  - `test_R6_7_allProductionEnforcersAreStorageless` — deploys each
    enforcer as a checklist marker. If a future change adds storage
    to any of them, the architectural invariant breaks and this test
    should be replaced with per-enforcer pause checks (tracked as
    R6.7.1 if/when it happens).

  ✅ 4/4 R6.7 tests pass.
  ✅ 549/549 full contracts suite green.

  ### Audit doc

  `CON-ENFORCER-PAUSE-001` new row, R6.7 closure.

- bf34dbf: R6.9 — Per-contract coverage aggregator (`pnpm coverage:contracts`).

  ### Why

  R6.1 recon § 3.1 identified that `forge coverage --ir-minimum
--report summary` produces a summary TABLE that **silently skips**
  the security-critical contracts (AgentAccount, AgentAccountFactory,
  SmartAgentPaymaster, UniversalSignatureValidator, DelegationManager,
  CustodyPolicy, the 5 enforcers). The table renders ~10 contracts
  when 28 exist under `src/`.

  R6.9 finding: **the LCOV report (`--report lcov`) DOES include all
  28 contracts.** Only the summary-table rendering hides them.

  ### What

  New `scripts/coverage-contracts.ts` + two pnpm scripts:
  - `pnpm coverage:contracts` — runs `forge coverage --ir-minimum
--report lcov`, parses the LCOV output, emits a per-contract
    JSON + markdown summary.
  - `pnpm coverage:contracts:no-run` — reuses the existing
    `lcov.info` (skips the ~2-min forge coverage run).

  Output:
  - `packages/contracts/coverage-r6-9.json` (gitignored) — full
    per-contract data + category rollups + overall.
  - Markdown table on stdout — ready to paste into PRs / audit docs.

  ### Current baseline (R6.9 + master)

  Overall: **28 contracts · 79.0% lines · 60.2% branches · 80.4% functions.**

  Per-category rollups:

  | Category          | Contracts |  Lines | Branches |
  | ----------------- | --------: | -----: | -------: |
  | security-critical |        11 |  82.1% |    57.4% |
  | core              |         1 | 100.0% |   100.0% |
  | naming-ontology   |         7 |  71.2% |    61.0% |
  | identity          |         3 |  79.6% |    50.0% |
  | governance        |         2 |  97.8% |    66.7% |
  | library           |         4 |  77.7% |    79.5% |

  ### Highlighted findings
  - **Below the 70% security-critical line floor:** SmartAgentPaymaster
    at 50.9% (clear R6.10 target).
  - DelegationManager (95.8%), AgentAccount (90.6%), AgentAccountFactory
    (100%), UniversalSignatureValidator (94.4%) all comfortably above.
  - CustodyPolicy 70.1% lines but **30.0% branches** — secondary
    R6.10 target (high cyclomatic complexity).
  - The 5 enforcers all in the 75-100% lines range.

  ### Gate posture

  The gate is **INFORMATIONAL today** — R6.9 does not fail CI on
  critical-contract gaps because R6.10 hasn't run yet. The summary is
  intended as evidence for an external auditor's review of the test
  pack.

  After R6.10 closes the named gaps, R6.9's `RATCHET_ENABLED` flag
  flips to `true` and the security-critical floor enforces.

  ### Existing tooling preserved

  The existing `pnpm check:forge-coverage` ratchet (per-contract
  accepted-debt list with hard floors) continues to run unchanged.
  R6.9 is additive — it surfaces visibility for the security-critical
  layer; `check:forge-coverage` continues to enforce baseline floors
  on the contracts that DO appear in the summary table.

  ### Audit doc

  "Forge coverage in CI with thresholds" row marked PARTIAL CLOSED.

## 1.0.0-alpha.4

### Minor Changes

- efd2927: R5.7 — SmartAgentPaymaster: explicit `devMode_` + `verifyingSigner_`
  at construction (P0-2 closure).

  ### Breaking
  - **`SmartAgentPaymaster` constructor signature changed.** Pre-R5.7:
    `constructor(IEntryPoint, address initialOwner, address governance)`.
    Post-R5.7: `constructor(IEntryPoint, address initialOwner, address
governance, bool devMode_, address verifyingSigner_)`. The implicit
    `_dev = true` default — which silently shipped every fresh deploy
    in accept-all mode — has been removed. Callers must pass both new
    args explicitly. Production: `devMode_=false` + non-zero
    `verifyingSigner_` (or zero for fail-closed allowlist mode).

  ### Why

  External senior-architect audit P0-2: pre-R5.7 the constructor
  forcibly set `_dev = true`, so production deploys had to remember
  a post-broadcast `setDevMode(false) + setVerifyingSigner(...)` tx.
  A forgotten or delayed step would sponsor any arbitrary userOp on
  the freshly-deployed network. The construction-time enforcement
  removes the race window — production deploys ship fail-closed from
  block 1.

  ### Deploy script changes
  - `script/Deploy.s.sol` now computes `paymasterDevMode = _isTestnetNetwork(network)`
    and passes it (plus `PAYMASTER_VERIFYING_SIGNER`) into the constructor.
    Production deploys without a verifying signer print a multi-line
    warning + start in fail-closed allowlist mode. The previous
    step-7 `setVerifyingSigner + setDevMode(false)` block was removed
    (redundant; the constructor handles it).
  - `script/DeployPaymaster.s.sol` (incremental deploy) adds env vars
    `PAYMASTER_DEV_MODE` (default `false`) + `PAYMASTER_VERIFYING_SIGNER`
    (default `address(0)`).

  ### Tests
  - 4 new tests in `test/SmartAgentPaymaster.t.sol`:
    - `test_R5_7_constructed_with_devMode_false_starts_in_production_mode`
    - `test_R5_7_constructed_with_verifyingSigner_wires_it_atomically`
    - `test_R5_7_constructed_with_verifyingSigner_emits_event`
    - `test_R5_7_constructed_with_zero_verifyingSigner_does_not_emit`
  - 32/32 paymaster tests pass; 540/540 contracts suite green.

  ### Audit doc
  - `PKG-PAYMASTER-002` (new row, R5.7 closure) added under
    `### SmartAgentPaymaster.sol`. `CON-SmartAgentPaymaster-002`
    superseded by this row (was about the missing public getter +
    preflight check; the public `devMode()` getter has been there
    all along and is now also enforced at construction).

- 524d311: R5.9 — Per-role authority addresses in `Deploy.s.sol` (P0-1 extension).

  ### Why

  External senior-architect audit P0-1 wanted role separation in the
  deploy script. R5.4 collapsed every governance / admin / ownership
  role onto a single `GOVERNANCE_MULTISIG` address, which closed the
  deployer-aggregation failure mode but left every role co-located on
  the same multisig. R5.9 adds per-role env vars so an operator can
  point each role at a distinct multisig.

  ### Per-role env-var matrix

  Each unset env var falls back to the resolved `authority` (so the
  R5.4 single-multisig flow keeps working when no role env vars are
  set):

  **Multisig-shaped (contract required on production):**
  - `TIMELOCK_ADMIN`
  - `TIMELOCK_PROPOSER`
  - `TIMELOCK_EXECUTOR`
  - `GOVERNANCE_GUARDIAN`
  - `GOVERNANCE_SIGNER`
  - `PAYMASTER_OWNER`
  - `NAMING_ROOT_OWNER`
  - `ONTOLOGY_ADMIN`
  - `SHAPE_ADMIN`
  - `RELATIONSHIP_TYPE_ADMIN`

  **EOA-shaped hot keys (R5.4 existing):**
  - `BUNDLER_SIGNER`
  - `SESSION_ISSUER`

  ### Implementation
  - New `Roles` struct bundles every distinct on-chain role.
  - New `_resolveContractRole(roleName, defaultAuth, network)` helper
    enforces `.code.length > 0` on production networks for multisig-
    shaped roles. Misconfigured env vars (pointing at an EOA on
    mainnet) revert with a clear `Deploy: <ROLE> must be a contract
on production networks (Smart Agent / Safe / Timelock)` message.
  - New `_resolveEoaRole(roleName, defaultAuth)` helper for hot keys
    (no contract check).
  - Existing `_resolveBundlerSigner` and `_resolveSessionIssuer`
    refactored to call the new EOA helper.

  ### Tests

  5 new R5.9 tests in `test/DeployAuthorityResolution.t.sol`:
  - env-set-with-contract returns env on production
  - env-unset returns default
  - env-set-with-EOA rejected on production
  - env-set-with-EOA accepted on testnet
  - every role string round-trips via the resolver

  545/545 contracts suite green (was 540; +5 R5.9 tests).

  ### Backwards compatibility

  Operators who don't need role separation: nothing changes. Leave the
  new env vars unset and everything routes to `GOVERNANCE_MULTISIG`
  (R5.4 behavior preserved).

## 0.1.0-alpha.3

### Patch Changes

- 4dde508: R4.9 verification — first publish via OIDC Trusted Publishing.

  No code changes — this prerelease bump only exists to exercise the new
  auth path end-to-end. After this lands at `0.1.0-alpha.3` on npm via the
  Release workflow's `Publish via changesets` step, R4 is fully verified:
  - permissions.id-token: write produces a Sigstore OIDC token
  - changesets/action delegates to pnpm publish
  - pnpm publish authenticates to registry.npmjs.org via that token
  - npm matches the token against the `npm trust github` configuration
    landed in R4.7 (workflow file = `release.yml`, repo =
    `agentictrustlabs/agenticprimitives`, permission = `publish`)
  - Sigstore provenance attestation is signed by the same OIDC token
    and published to the transparency log
  - Per-package CycloneDX SBOM is attached to the GH Release

  Rollback path (if the publish step fails): the bootstrap publishes
  landed at `0.1.0-alpha.2`, so consumers on that pin stay frozen. The
  `NPM_TOKEN` repo secret can be re-set + the env line re-added to
  `release.yml` to revert R4.8.

## 0.1.0-alpha.2

### Minor Changes

- R1 — CROSS-STACK-001 closure + storage-layout snapshot gate.

  ### Breaking
  - **`DelegationManager.DELEGATION_TYPEHASH` byte value changed.** The
    contract previously hashed the non-standard EIP-712 type string
    `Delegation(...,bytes32 caveatsHash,...)` (inlining a precomputed
    caveats digest). It now hashes the canonical EIP-712 form
    `Delegation(...,Caveat[] caveats,...)Caveat(address enforcer,bytes terms)`
    to converge with the off-chain `DELEGATION_EIP712_TYPES` used by
    `@agenticprimitives/delegation` + viem. Any signature minted against
    the pre-R1 typehash (`0xac5469bad161df7c56017782e0a87a91008dbe46dacd5eb42e48e7f4b4fc4e39`)
    will not verify against the post-R1 typehash
    (`0x52f4b7596c22f77177e8e563e6502ad014a696bfc92f9c6cabcaf5738c4ed265`).
    Cross-stack signatures now round-trip (off-chain → on-chain) without
    bespoke re-hashing.

  ### Added
  - `pnpm check:storage-layouts` — snapshot gate over `AgentAccount`,
    `CustodyPolicy`, `DelegationManager`, `SmartAgentPaymaster`. Locks
    slot/offset/type for each storage variable. Drift fails CI.

  ### Notes
  - Forge test `test_DELEGATION_TYPEHASH_is_a_known_constant` and the
    TS-side `cross-stack-typehashes` integration test independently lock
    the converged typehash byte value.
  - Audit row `CROSS-STACK-001` + `XCON-003` + `CON-AgentAccount-003`
    closed in `docs/audits/2026-05-packages-contracts-production-readiness.md`.
  - Released as `0.1.0-alpha.2` (changeset pre-mode reentered).
