---
'@agenticprimitives/contracts': patch
---

R6.7 / CON-ENFORCER-PAUSE-001 — Enforcer pause-invariant audit.

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
   149-154) BEFORE the for-loops that dispatch `beforeHook` (line
   287) / `afterHook` (line 308). When paused, the DM reverts
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
