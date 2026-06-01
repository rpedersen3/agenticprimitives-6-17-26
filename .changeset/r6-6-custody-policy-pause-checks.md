---
'@agenticprimitives/contracts': patch
---

R6.6 / CON-CustodyPolicy-005 — wire system-pause checks into
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

| Function | Reasoning |
|---|---|
| `scheduleCustodyChange` | Schedules an authority transfer |
| `applyCustodyChange` | Executes the authority transfer |

### 2 RECOVERY primitives left UNGUARDED

| Function | Reasoning |
|---|---|
| `cancelScheduledChange` | Defensive cancellation = recovery |
| `onUninstall` | Removing the custody module = recovery |

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
