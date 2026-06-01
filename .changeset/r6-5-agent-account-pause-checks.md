---
'@agenticprimitives/contracts': minor
---

R6.5 / CON-AgentAccount-005 — Wire system-pause checks into
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

| Function | Reasoning |
|---|---|
| `execute` | Asset movement |
| `executeBatch` | Asset movement |
| `executeFromModule` | Module-driven asset action |
| `installModule` | Adds attack surface |
| `executePendingUpgrade` | Could land malicious queued upgrade |
| `addCustodian` | Grants authority |

### 3 RECOVERY primitives deliberately left UNGUARDED

| Function | Reasoning |
|---|---|
| `uninstallModule` | Removing attack surface = recovery |
| `cancelPendingUpgrade` | Cancelling = recovery |
| `removeCustodian` | Revoking authority = recovery |

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
