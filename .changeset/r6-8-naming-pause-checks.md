---
'@agenticprimitives/contracts': minor
---

R6.8 / CON-NAMING-005 — wire system-pause checks into the naming
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
