# R6.1 Contracts Hardening Recon — 2026-05-31

> **Purpose.** Produce evidence-backed findings to drive the R6 contracts
> hardening wave. Three artifacts: Slither/Aderyn triage, `isPaused()`
> coverage matrix, Forge coverage shortlist.
>
> **Scope.** `packages/contracts/src/**` at `r6-1-contracts-hardening-recon`
> (off master commit `a21397f`, post-R5.12d).
>
> **Tooling.** Slither (CodeQL surface via GitHub API), Forge coverage
> (`--ir-minimum`), grep. Aderyn not installed locally — recommended for
> CI addition (see §4.6). Halmos not run yet — staged for R6.5.

---

## §1 Slither Triage Matrix

22 open findings, all `warning` severity (no high-severity blocking CI).
Categorized:

### §1.1 Real bugs requiring fix (1)

| Rule | Location | Verdict |
|---|---|---|
| **`1-1-reentrancy-no-eth`** | `PermissionlessSubregistry.register(string,address)` line 80–92 | **REAL.** State variable `claimedBy[msg.sender] = childNode` is written AFTER the external call to `REGISTRY.register(...)`. If the `AgentNameRegistry` (or any resolver invoked by it) re-enters `PermissionlessSubregistry.register`, the second call passes the `claimedBy[msg.sender] == 0n` guard because the write hasn't happened yet. **Mitigation: CEI pattern OR `nonReentrant` modifier.** Tracked as **R6.2.** |

### §1.2 Intentional patterns — review-and-document (7)

`1-1-unused-return` on `ECDSA.tryRecover` return value:

| Location | Disposition |
|---|---|
| `UniversalSignatureValidator._ecdsaRecover` (2x) | The `err` discriminant is implicitly handled — on failure `recovered == address(0)`, which fails the subsequent `recovered == expected` comparison. Same final behaviour, no security gap. |
| `AgentAccount._verifyEcdsa` (2x) | Identical pattern; ERC-1271 dispatch. |
| `AgentAccount._verifySignerEcdsa` (2x) | Identical. |
| `SmartAgentPaymaster._validatePaymasterUserOp` line 266 | R5.7-era code; explicit `revert PaymasterSignatureInvalid()` if `err != NoError OR recovered != verifyingSigner`. Already strict. |

**Action.** Add inline `// slither-disable-next-line unused-return` comments at each site with a 1-line justification. Tracked as **R6.3.**

### §1.3 False positives — local-variable defaults (12)

`1-1-uninitialized-local` — Solidity 0.8+ zero-initialises memory locals
deterministically; Slither flags reads-before-explicit-writes regardless.

| Location | Verdict |
|---|---|
| `CustodyPolicy._applyRecoverAccount` (addedOwners, removedOwners, addedPasskeys, removedPasskeys) | `address[] memory` arrays that get assembled via push pattern; zero-length default is correct |
| `CustodyPolicy._applyRotateAllOwners` (added, removed) | Same pattern |
| `CustodyPolicy._verifyQuorum` (prev) | Bounded loop counter; zero is the correct seed |
| `WebAuthnLib._base64UrlEqualsHash` (acc, bits, outIdx) | Bitwise accumulators; zero is correct seed |
| `AgentAccountFactory._buildValidatorInitData` (thresholds) | `uint256[]` zero-length |
| `AgentNameUniversalResolver._composeName` (labels) | `string[] memory` zero-length |
| `QuorumEnforcer.beforeHook` (prev) | Bounded loop counter |

**Action.** Suppress (one of):
- Add explicit `= new T[](0)` / `= 0` to silence Slither
- Add a `slither.config.json` exclusion list
- Accept the noise

Tracked as **R6.4** (low priority; cosmetic).

### §1.4 False positives — sentinel-equality patterns (2)

`1-0-incorrect-equality`:

| Location | Pattern | Verdict |
|---|---|---|
| `AgentNameRegistry.setPrimaryName` line 297 | `_records[node].registeredAt == 0` | Sentinel check for "record not yet registered". Storage default is exactly `0`; no precision-loss concern. |
| `AgentRelationship.getEdge` line 249 | `e.createdAt == 0` | Same sentinel pattern. |

**Action.** Inline disable comments with justification. Bundled with **R6.3.**

---

## §2 `isPaused()` Coverage Matrix

**Goal.** When `AgenticGovernance.isPaused() == true`, every mutating
state transition in the system should refuse to execute.

Methodology: for each contract under `src/`, count occurrences of
`isPaused | whenNotPaused | SystemPaused` and count non-view external/
public functions. **Critical finding: 4 contracts with mutating
entrypoints have ZERO pause checks.**

### §2.1 Coverage table

| Contract | Pause checks | Non-view ext/pub fns | Coverage |
|---|---:|---:|---|
| `SmartAgentPaymaster.sol` | 3 | 4 | ✅ **Full** (R5.7 / H7-C.10) |
| `agency/DelegationManager.sol` | 4 | 1 | ✅ **Full** (single-fn `redeemDelegation` guarded) |
| `AgentAccountFactory.sol` | 1 | 2 | 🟡 **Partial** — `createAgentAccount` guarded; verify `setImplementation` (governance-only) is also gated |
| **`AgentAccount.sol`** | **0** | **13** | ❌ **ZERO** |
| **`custody/CustodyPolicy.sol`** | **0** | **4** | ❌ **ZERO** |
| **`naming/AgentNameRegistry.sol`** | **0** | **6** | ❌ **ZERO** |
| **`naming/PermissionlessSubregistry.sol`** | **0** | **1** | ❌ **ZERO** |
| `enforcers/AllowedTargetsEnforcer.sol` | 0 | 2 (hooks) | ⚠️ **Unclear** (see §2.4) |
| `enforcers/AllowedMethodsEnforcer.sol` | 0 | 2 (hooks) | ⚠️ same |
| `enforcers/QuorumEnforcer.sol` | 0 | 2 (hooks) | ⚠️ same |
| `enforcers/TimestampEnforcer.sol` | 0 | 2 (hooks) | ⚠️ same |
| `enforcers/ValueEnforcer.sol` | 0 | 2 (hooks) | ⚠️ same |

### §2.2 Critical gap — `AgentAccount.sol` has zero pause checks

13 mutating external/public functions, ZERO pause checks. Notable ones:

```
execute(address, uint256, bytes)            ← every user call goes here
executeBatch(Call[])                        ← every multi-call goes here
executeFromBundler(PackedUserOperation, bytes32)
executeFromModule(address, uint256, bytes)
executePendingUpgrade()                     ← UUPS upgrade ceremony
cancelPendingUpgrade(bytes)
setUpgradeTimelock(uint256)                 ← onlySelf
setDelegationManager(address)               ← onlySelf
acceptSessionDelegation(bytes32)            ← onlySelf
addCustodian(address)                       ← onlySelf
removeCustodian(address)                    ← onlySelf
installModule(uint256, address, bytes)      ← onlySelf
uninstallModule(uint256, address, bytes)    ← onlySelf
```

**Implication.** When governance pauses the system (e.g., during an
active exploit or consent-withdrawal compliance event), **every
deployed AgentAccount continues operating normally**. Funds keep
moving, modules keep getting installed, upgrades keep landing.
`SmartAgentPaymaster._validatePaymasterUserOp` will refuse to sponsor
gas, but the account itself doesn't refuse.

For an engagement platform (member funds, donor portals, consent
flows), this is the largest defensive gap in the codebase. **Tracked
as R6.5 (the headline R6 PR).**

### §2.3 Critical gap — `CustodyPolicy.sol` has zero pause checks

4 mutating external functions related to custody recovery:

```
scheduleCustodyChange(...)
applyCustodyChange(...)
cancelCustodyChange(...)
+ 1 more
```

**Implication.** During a pause, an attacker holding quorum sigs can
still schedule/apply a custody change. Pause is supposed to be the
emergency switch — currently it doesn't switch off the custody
machinery. **Tracked as R6.6.**

### §2.4 Enforcers — open question

Enforcers expose `beforeHook` / `afterHook` (called by
`DelegationManager.redeemDelegation`). Since `DelegationManager`
itself already checks `isPaused()` BEFORE invoking enforcers, the
enforcer hooks are unreachable during a pause via the normal flow.

**Verify.** Are enforcer hooks callable from any other path that
doesn't go through `DelegationManager`? If yes, they need their own
pause checks. If no, document the architectural invariant.
**Tracked as R6.7.**

### §2.5 Naming — `AgentNameRegistry` + `PermissionlessSubregistry`

Names can be registered, primaries set, subregistries assigned during
a system pause. Less catastrophic than AgentAccount (no funds at
risk), but a paused system shouldn't be writing new state. **Tracked
as R6.8.**

---

## §3 Forge Coverage Shortlist

**Methodology.** `forge coverage --report summary --ir-minimum`. Only
contracts compatible with `ir-minimum` show up in the unified report;
the rest need per-contract coverage runs.

### §3.1 Coverage gap — security-critical contracts not in unified report

The following contracts are MISSING from the unified coverage run
because they require viaIR + full optimizer:

```
src/AgentAccount.sol
src/AgentAccountFactory.sol
src/SmartAgentPaymaster.sol
src/UniversalSignatureValidator.sol
src/agency/DelegationManager.sol
src/custody/CustodyPolicy.sol
src/enforcers/*.sol  (all 5)
```

**Previously claimed per-contract coverage** (from `docs/audits/2026-05-...`):
- `CON-AgentAccount-001`: 91.25% lines, 84.51% branches (R3.5)
- `CON-DelegationManager-001`: 95.77% (R3.3)

**Recommendation.** Establish a per-contract coverage script that
runs each security-critical contract under its own `--match-contract`
focus + `--via-ir`, then aggregates the results into a single
machine-readable report. **Tracked as R6.9.**

### §3.2 Coverage table — non-critical contracts

Below ranks the 10 contracts that DID run, sorted by line coverage.
Threshold gates: **≥ 90% line / ≥ 80% branch.**

| Contract | Line | Branch | Status |
|---|---:|---:|---|
| `naming/PermissionlessSubregistry.sol` | 100.00% | 100.00% | ✅ |
| `naming/AgentNameRegistry.sol` | 92.86% | 80.95% | ✅ |
| `relationships/AgentRelationship.sol` | 92.31% | 56.52% | 🟡 branch gap |
| `ontology/OntologyTermRegistry.sol` | 90.00% | 71.43% | 🟡 branch gap |
| `libraries/WebAuthnLib.sol` | 87.04% | 63.16% | ⚠️ |
| `relationships/RelationshipTypeRegistry.sol` | 82.61% | 28.57% | ❌ **branch gap (28.57%)** |
| `naming/AgentNameUniversalResolver.sol` | 80.00% | 56.67% | 🟡 |
| `ontology/ShapeRegistry.sol` | 61.54% | 66.67% | ❌ |
| `naming/AgentNameAttributeResolver.sol` | 53.12% | 100.00% | ❌ line |
| `ontology/AttributeStorage.sol` | 50.77% | 25.00% | ❌ both |

**Targets for R6.10** (coverage push):
1. `ontology/AttributeStorage.sol` — both line (50.77%) AND branch (25%) below threshold.
2. `ontology/ShapeRegistry.sol` — line (61.54%) below threshold.
3. `naming/AgentNameAttributeResolver.sol` — line (53.12%) below threshold.
4. `relationships/RelationshipTypeRegistry.sol` — branch (28.57%) far below threshold.

---

## §4 Recommendations — R6.X Pipeline

Sorted by defensive impact × external-auditor signal.

### §4.1 R6.2 — `PermissionlessSubregistry.register` reentrancy fix
**Effort:** XS (1 line) **Why:** Real Slither finding. Move state write
before external call OR add `nonReentrant`. Lock with a regression
test.

### §4.2 R6.5 — `AgentAccount` pause-check wire-up (HEADLINE)
**Effort:** M (~1 day) **Why:** The single biggest defensive gap in
the system. 13 mutating entrypoints currently bypass system pause.
Add a `whenNotPaused` modifier (reads from `IGovernance` pointer the
factory wires at deploy) on `execute`, `executeBatch`,
`executeFromBundler`, `executeFromModule`, `installModule`,
`uninstallModule`, `executePendingUpgrade`, `cancelPendingUpgrade`,
`addCustodian`, `removeCustodian`. Owner-self ceremonies
(`setDelegationManager`, `setUpgradeTimelock`,
`acceptSessionDelegation`) should still execute during a pause —
those are RECOVERY operations.

### §4.3 R6.6 — `CustodyPolicy` pause-check wire-up
**Effort:** S **Why:** Same pattern as R6.5 but on the custody
machinery. `scheduleCustodyChange` / `applyCustodyChange` should
refuse during a pause. `cancelCustodyChange` SHOULD execute during a
pause (it's a defensive de-escalation). Document the asymmetry.

### §4.4 R6.7 — Enforcer pause-check audit
**Effort:** S **Why:** Verify whether enforcer hooks are reachable
outside the `DelegationManager` flow. If yes, add pause checks. If no,
document the invariant and add a runtime assertion.

### §4.5 R6.8 — Naming pause-check wire-up
**Effort:** S **Why:** `AgentNameRegistry.register` / `setSubregistry`
/ `setPrimaryName` and `PermissionlessSubregistry.register` should
refuse during pause. Lower urgency than R6.5 (no funds) but
needed for full coverage claim.

### §4.6 R6.3 — Slither suppress comments + Aderyn CI integration
**Effort:** S **Why:** Document the 7 intentional `unused-return` +
2 sentinel `incorrect-equality` patterns with inline justifications.
Add Aderyn (Cyfrin AI scanner) to CI alongside Slither — Aderyn
catches different patterns. Quick PR.

### §4.7 R6.9 — Per-contract coverage script + report aggregation
**Effort:** M **Why:** The unified `forge coverage` skips the
security-critical contracts. Per-contract scripts already work (R3.3,
R3.5 used them). Bundle into one `pnpm coverage:contracts` script
that produces a single machine-readable JSON, post to CI as an
artifact.

### §4.8 R6.10 — Coverage push on the 4 below-threshold contracts
**Effort:** M **Why:** `AttributeStorage`, `ShapeRegistry`,
`AgentNameAttributeResolver`, `RelationshipTypeRegistry` are below
90%/80% thresholds. Add tests to close gaps.

### §4.9 R6.4 — Suppress `uninitialized-local` noise
**Effort:** XS (low priority — Slither warning hygiene)

### §4.10 R6.11 — Halmos symbolic harness for top 3 invariants
**Effort:** M-L (not started in this recon; staged) **Why:**
External-audit prep. Top 3 invariants: (a) CustodyPolicy quorum
binding (no two custodians can install simultaneously), (b)
QuorumEnforcer payload-hash binding (no payload is accepted twice),
(c) AgentAccount `onlySelf` authority gate. Free; no Certora license.

---

## §5 R6 Wave Plan (recommended order)

| Order | Item | Effort | Defensive impact |
|---|---|---|---|
| 1 | **R6.2** PermissionlessSubregistry reentrancy | XS | Real Slither finding closed |
| 2 | **R6.5** AgentAccount pause wire-up | M | **HEADLINE** — biggest defensive gap |
| 3 | **R6.6** CustodyPolicy pause wire-up | S | Companion to R6.5 |
| 4 | **R6.8** Naming pause wire-up | S | Closes pause-coverage to 100% |
| 5 | **R6.7** Enforcer pause-check audit | S | Architectural invariant locked |
| 6 | **R6.3** Slither suppressions + Aderyn CI | S | Static-analysis hygiene |
| 7 | **R6.9** Per-contract coverage aggregator | M | Unblocks coverage threshold gate |
| 8 | **R6.10** Coverage push on 4 contracts | M | Closes shortlist gaps |
| 9 | **R6.11** Halmos symbolic harness | M-L | External-audit prep |

R6.2–R6.8 close the defensive gaps surfaced by this recon (5 PRs,
~2-3 days total). R6.9–R6.11 set the stage for the external audit
engagement.

---

## §6 What this recon did NOT cover

- **UUPS upgrade authority audit.** `_authorizeUpgrade` on `AgentAccount`
  is `onlySelf` — meaning the account itself must sign the upgrade.
  But "onlySelf" depends on the account's signer policy. Worth a
  dedicated review.
- **Aderyn output.** Not installed locally. CI integration is in R6.3.
- **Halmos / formal verification.** Staged for R6.11.
- **External-audit bundle assembly.** Staged for R6.12.
- **Gas-report baseline.** Staged for R6.13 (low priority post-pause).

---

## §7 Tooling notes for future recons

- `forge coverage --ir-minimum` is the only way to get coverage today,
  but it silently skips contracts that need viaIR. Need a per-contract
  script (R6.9).
- Slither runs in CI via `crytic/slither-action@v0.4.0` with
  `fail-on: high`. All current findings are `warning` — no CI failure.
- CodeQL surface includes Slither output; queryable via
  `gh api repos/.../code-scanning/alerts`.
- Aderyn is not in CI; consider adding alongside Slither (R6.3).
